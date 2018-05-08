'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';
import { ignoreWays } from '../utils/utils';

const { ROOT_DIR } = process.env;

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/eaul');

const RN_FILE = path.resolve(TMP_DIR, 'roadnetwork.geojson');
const OD_FILE = path.resolve(TMP_DIR, 'od-mini.geojson');
const OSRM_FOLDER = path.resolve(TMP_DIR, 'osrm');
const WAYS_FILE = path.resolve(TMP_DIR, 'roadnetwork-osm-ways.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Using OD Pairs', OD_FILE);
clog('Using RN Ways', WAYS_FILE);
const odPairs = fs.readJsonSync(OD_FILE);
var waysList = fs.readJsonSync(WAYS_FILE);

tStart(`Create lookup tables`)();
// Create lookup tables.
var nodeWayLookup = {
  // nodeId: [wayId, wayId, ...]
};
var waysLookup = {
  // wayId: way
};
waysList.forEach(w => {
  waysLookup[w.id] = w;
  w.nodes.forEach(n => {
    if (nodeWayLookup[n]) {
      nodeWayLookup[n].push(w.id);
    } else {
      nodeWayLookup[n] = [w.id];
    }
  });
});
tEnd(`Create lookup tables`)();

const FLOOD_RETURN_PERIOD = [10, 20, 50, 100];
const FLOOD_REPAIR_TIME = {
  10: 10,
  20: 20,
  50: 50,
  100: 100
};

// jsonToFile(`${TMP_DIR}/node-ways.index.json`)(nodeWayLookup);

/**
 * Promise version of osrm.route()
 *
 * @param {osrm} osrm The OSRM instance.
 * @param {object} opts Options to pass to the route method
 */
function osrmRoute (osrm, opts) {
  return new Promise((resolve, reject) => {
    osrm.route(opts, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
}

async function getImpassableWays () {
  // TODO: Implement
  return waysList.slice(0, 100);
}

let floodOSRMFiles = {
  // event : osrm path
};
/**
 * Creates a osrm file for each return period ignoring the segments that
 * get flooded on that return period.
 *
 * @param {string} osrmFolder Path to the baseline OSRM
 *
 * @returns Promise, but caches the osrm file paths in var `floodOSRMFiles`
 */
async function prepareFloodOSRMFiles (osrmFolder) {
  return Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const impassableWays = await getImpassableWays(retPeriod);

    const osrmFolderName = `osrm-flood-${retPeriod}`;
    const osrmFolder = `${TMP_DIR}/${osrmFolderName}`;

    tStart(`[IGNORE WAYS] ${retPeriod} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    tEnd(`[IGNORE WAYS] ${retPeriod} clean`)();

    await ignoreWays(impassableWays, osrmFolder, retPeriod, {TMP_DIR, ROOT_DIR, LOG_DIR});
    floodOSRMFiles[retPeriod] = osrmFolder;
  }, {concurrency: 5});
}

/**
 * Return the osrm file path for a given return period.
 * @param {number} retPeriod Return period for which to get osrm file path.
 */
function getFloodOSRMFile (retPeriod) {
  if (!floodOSRMFiles[retPeriod]) {
    throw new Error(`Flood osrm file missing for return period ${retPeriod}. Have you run prepareFloodOSRMFiles()?`);
  }
  return floodOSRMFiles[retPeriod];
}

async function run (odPairs) {
  // OSRM file per flood return period.
  await prepareFloodOSRMFiles();

  // For each od api combination.
  let eaul = 0;
  const totalOD = odPairs.length;
  for (let oidx = 0; oidx <= totalOD - 2; oidx++) {
    const origin = odPairs[oidx];
    for (let didx = oidx + 1; didx < totalOD; didx++) {
      const destination = odPairs[didx];
      clog('origin', origin);
      clog('destination', destination);
      // Calculate EAUL (Expected Annual User Loss) for this OD pair.
      const odPairEaul = await calcEaul(origin, destination);
      clog('odPairEaul', odPairEaul);
      clog('--------');
      clog('');
      eaul += odPairEaul;
    }
  }
  clog('eaul', eaul);
}

async function calcEaul (origin, destination) {
  // Calculate baseline RUC for this OD pair.
  // Using road network with no disruptions.
  const odPairRUC = await calcRUC(OSRM_FOLDER, origin, destination);
  clog(`RUC ${origin.properties.Name} - ${destination.properties.Name}`, odPairRUC);

  // Calculate RUC on a flooded RN depending on the flood return period.
  const increaseUCost = await Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const floodOSRM = getFloodOSRMFile(retPeriod);
    const ruc = await calcRUC(floodOSRM, origin, destination);
    // TODO: Add od pair traffic.
    return FLOOD_REPAIR_TIME[retPeriod] * (ruc - odPairRUC) * 1;
  }, {concurrency: 5});

  clog('increased user cost', increaseUCost);

  // Calculate the EAUL from the increased user cost using the trapezoidal rule.
  let sum = 0;
  const t = FLOOD_RETURN_PERIOD;
  const u = increaseUCost;
  for (let i = 0; i <= t.length - 2; i++) {
    sum += (1 / t[i] - 1 / t[i + 1]) * (u[i] + u[i + 1]);
  }

  return sum ? sum / 2 : 0;
}

async function calcRUC (osrmFolder, origin, destination) {
  var osrm = new OSRM(`${osrmFolder}/roadnetwork.osrm`);
  const coordinates = [
    origin.geometry.coordinates,
    destination.geometry.coordinates
  ];

  const result = await osrmRoute(osrm, {coordinates, annotations: ['nodes']});
  // Through the osrm speed profile we set the speed to be 1/ruc.
  // By doing so, the total time (in hours) will be cost of the kms travelled.
  const ruc = result.routes[0].legs[0].duration / 3600;

  jsonToFile(`${LOG_DIR}/result-${origin.properties.Name}-${destination.properties.Name}.json`)(result);
  return ruc;
}

/**
 * Returns the ways used on a given route composed by the input nodes.
 * There must be a way connecting the nodes otherwise the route is not valid.
 *
 * @param {Array} nodes
 */
function getWaysForRoute (nodes) {
  // Ways that were used by this route.
  let usedWays = [];

  // A node may be shared between more than a way, but we only want to pick
  // a given way if it was used in the route. An easy way to know this is if
  // a way has 2 sequential nodes in use.
  // This index stores the index of a node for a given way so when we find
  // another node for the same way, we can know if it is sequential or not.
  let usedWaysIdx = {
    // wayId: {min node position, max node position}
  };

  tStart(`Node search`)();
  nodes.forEach(node => {
    node = node.toString();
    // Get the ways this node belongs to.
    const waysIdsOfNode = nodeWayLookup[node];
    if (!waysIdsOfNode.length) throw new Error(`No ways found for node: ${node}`);

    waysIdsOfNode.forEach(wid => {
      const way = waysLookup[wid];
      // Index of the current node in the way node list.
      const nodeIdxInWay = way.nodes.indexOf(node);
      // Previously store node index, if any.
      const prevNodeIdxInWay = usedWaysIdx[wid];

      if (prevNodeIdxInWay === undefined) {
        // First time way appears. Store node indexes.
        usedWaysIdx[way.id] = {min: nodeIdxInWay, max: nodeIdxInWay};
        return;
      }

      const { min, max } = usedWaysIdx[way.id];
      // There is a previous index stored. Check if the nodes are sequential.
      if (nodeIdxInWay === min - 1 || nodeIdxInWay === max + 1) {
        // Way is valid. If the nodes have the same value means that the way
        // was not stored yet.
        if (min === max) usedWays.push(way);
        // Update min and max.
        usedWaysIdx[way.id] = {
          min: Math.min(min, nodeIdxInWay),
          max: Math.max(max, nodeIdxInWay)
        };
      }
    });
  });
  tEnd(`Node search`)();

  clog(usedWaysIdx);
  clog(usedWays.map(w => w.id));

  return usedWays;
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(TMP_DIR),
      fs.ensureDir(LOG_DIR),
      fs.ensureDir(`${LOG_DIR}/osm-contract-logs`)
    ]);

    tStart(`Total run time`)();

    await run(odPairs.features);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}());
