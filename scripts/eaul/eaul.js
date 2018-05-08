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

const FLOOD_EVENTS = [10, 20, 50, 100];

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
  return [waysList[0]];
}

async function prepareFloodOSRMFiles (osrmFolder) {
  const floodOSRM = {
    // event : osrm path
  };

  await Promise.map(FLOOD_EVENTS, async (event) => {
    const impassableWays = await getImpassableWays(event);

    const osrmFolderName = `osrm-flood-${event}`;
    const osrmFolder = `${TMP_DIR}/${osrmFolderName}`;

    tStart(`[IGNORE WAYS] ${event} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    tEnd(`[IGNORE WAYS] ${event} clean`)();

    await ignoreWays(impassableWays, osrmFolder, event, {TMP_DIR, ROOT_DIR, LOG_DIR});
    floodOSRM[event] = osrmFolder;
  }, {concurrency: 5});

  return floodOSRM;
}

async function run (odPairs) {
  // OSRM file per flood event.
  // const floodOSRM = await prepareFloodOSRMFiles();

  // For each od api combination.
  const totalOD = odPairs.length;
  for (let oidx = 0; oidx <= totalOD - 2; oidx++) {
    const origin = odPairs[oidx];
    for (let didx = oidx + 1; didx < totalOD; didx++) {
      const destination = odPairs[didx];

      clog('origin', origin);
      clog('destination', destination);
      const odPairRUC = await calcRUC(OSRM_FOLDER, origin, destination);
      clog(`RUC ${origin.properties.Name} - ${destination.properties.Name}`, odPairRUC);

      // FLOOD_EVENTS.forEach(event => {
      //   const floodedODPairRUC = await calcRUC(floodOSRM[event], origin, destination);
      // })





      clog('--------');
      clog('');
    }
  }
}

async function calcRUC (osrmFolder, origin, destination) {
  var osrm = new OSRM(`${osrmFolder}/roadnetwork.osrm`);
  const coordinates = [
    origin.geometry.coordinates,
    destination.geometry.coordinates
  ];

  const result = await osrmRoute(osrm, {coordinates, annotations: ['nodes']});
  // Get the ways used by this route.
  const routeNodes = result.routes[0].legs[0].annotation.nodes;
  const usedWays = getWaysForRoute(routeNodes);
  jsonToFile(`${LOG_DIR}/result-${origin.properties.Name}-${destination.properties.Name}.json`)(result);
  jsonToFile(`${LOG_DIR}/usedWays-${origin.properties.Name}-${destination.properties.Name}.json`)(usedWays);

  const routeRUC = usedWays.reduce((acc, way) => {
    const ruc = parseFloat(way.tags.RUC);
    const kms = parseFloat(way.tags.Length) / 1000;
    return acc + ruc * kms;
  }, 0);

  return routeRUC;
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
    // wayId: node position
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
        // First time way appears. Store node index.
        usedWaysIdx[way.id] = nodeIdxInWay;
        return;
      }

      if (prevNodeIdxInWay === true) {
        // The way was already validated. Nothing to do.
        return;
      }

      // There is a previous Id. Check if the nodes are sequential.
      if (nodeIdxInWay === prevNodeIdxInWay - 1 || nodeIdxInWay === prevNodeIdxInWay + 1) {
        // Way is valid.
        usedWaysIdx[way.id] = true;
        usedWays.push(way);
      }
    });
  });
  tEnd(`Node search`)();

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
  }
}());
