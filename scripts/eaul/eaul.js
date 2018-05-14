'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';
import tLen from '@turf/length';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';
import { createSpeedProfile, osrmContract, forEachArrayCombination } from '../utils/utils';

const { ROOT_DIR } = process.env;

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/eaul');

const OD_FILE = path.resolve(TMP_DIR, 'od-mini.geojson');
const OSRM_FOLDER = path.resolve(TMP_DIR, 'osrm');
const WAYS_FILE = path.resolve(TMP_DIR, 'roadnetwork-osm-ways.json');
const NODES_FILE = path.resolve(TMP_DIR, 'rn-nodes.index.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Using OD Pairs', OD_FILE);
clog('Using RN Ways', WAYS_FILE);
const odPairs = fs.readJsonSync(OD_FILE);
var waysList = fs.readJsonSync(WAYS_FILE);
var nodesList = fs.readJsonSync(NODES_FILE);

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

/**
 * Returns the ways used on a given route composed by the input nodes.
 * There must be a way connecting the nodes otherwise the route is not valid.
 *
 * @param {Array} nodes
 */
function getWaysForRoute (usedNodes) {
  // This index stores the sequential nodes used for each way. This will be used
  // to calculate how much of the way was actually used.
  let usedWaysIdx = {
  // wayId: {
  //   id
  //   segments: []
  // }
  };

  tStart(`Node search`)();
  for (let usedNodeIdx = 0; usedNodeIdx < usedNodes.length; usedNodeIdx++) {
    const node = usedNodes[usedNodeIdx].toString();

    const waysForNode = nodeWayLookup[node];

    // A node may belong to several ways, but only one way will have multiple
    // nodes that make up the route. This way will update the usedNodeIdx to
    // continue the search, but we need the original value for all the cycle
    // iteraions.
    let usedNodeIdxUpdate = usedNodeIdx;
    waysForNode.forEach(wayId => {
      const way = waysLookup[wayId];

      // Where is this node in the way?
      let currNodeIdx = way.nodes.indexOf(node);

      // See the direction of the routing. If needed, reverse the way nodes.
      // Use the next node to check this.
      const nextNode = (usedNodes[usedNodeIdx + 1] || '').toString();
      const nextWayNode = way.nodes[currNodeIdx + 1];
      const prevWayNode = way.nodes[currNodeIdx - 1];

      const wayNodesCopy = [...way.nodes];
      let reversed = false;
      if (nextNode !== nextWayNode && nextNode !== prevWayNode) {
        // Nothing to do.
        return;
      } else if (nextNode === prevWayNode) {
        // Reverse way nodes, to loop.
        wayNodesCopy.reverse();
        currNodeIdx = wayNodesCopy.indexOf(node);
        reversed = true;
      }

      let nodesInWay = [node];
      // Since the nodes are sequential see which ones belong.
      let nextNodeIdx = usedNodeIdx + 1;
      for (nextNodeIdx; nextNodeIdx < usedNodes.length; nextNodeIdx++) {
        const nextNode = usedNodes[nextNodeIdx].toString();

        if (wayNodesCopy[++currNodeIdx] === nextNode) {
          nodesInWay.push(nextNode);
        } else {
          // Way was interrupted. Stop.
          break;
        }
      }
      // Once the last node was found, continue from the previous one
      // because the ways share the connected nodes. We need to subtract 2
      // because the loop will advance the index.
      usedNodeIdxUpdate = nextNodeIdx - 2;

      if (reversed) nodesInWay.reverse();

      if (!usedWaysIdx[wayId]) {
        usedWaysIdx[wayId] = {
          id: wayId,
          segments: [
            nodesInWay
          ]
        };
      } else {
        usedWaysIdx[wayId].segments.push(nodesInWay);
      }
    });

    // Update with new value.
    usedNodeIdx = usedNodeIdxUpdate;
  }
  tEnd(`Node search`)();

  tStart(`len calc`)();
  for (const wayId in usedWaysIdx) {
    const segments = usedWaysIdx[wayId].segments;

    const usedLength = segments.reduce((acc, nodes) => {
      let feat = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: nodes.map(nid => ([
            nodesList[nid].lon,
            nodesList[nid].lat
          ]))
        }
      };
      return acc + tLen(feat);
    }, 0);

    usedWaysIdx[wayId].usedLength = usedLength;
  }
  tEnd(`len calc`)();

  return usedWaysIdx;
}

const FLOOD_RETURN_PERIOD = [10, 20, 50, 100];
const FLOOD_REPAIR_TIME = {
  10: 10,
  20: 20,
  50: 50,
  100: 100
};

const ROAD_UPGRADES = [
  'one',
  'two',
  'three'
];

async function getImpassableWays () {
  // TODO: Implement
  return waysList.slice(0, 100);
}

async function getUpgradeWaySpeed () {
  // TODO: Implement
  return Math.round(1 / 0.004 * 10000);
}

/**
 * Promise version of osrm.route()
 *
 * @param {osrm} osrm The OSRM instance.
 * @param {object} opts Options to pass to the route method.
 */
function osrmRoute (osrm, opts) {
  return new Promise((resolve, reject) => {
    osrm.route(opts, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
}

}

let floodOSRMFiles = {
  // event: osrm path
};
/**
 * Creates a osrm file for each return period ignoring the segments that
 * get flooded on that return period. To ignore the segments the speed between
 * nodes is set to 0.
 * If an upgradeWay is provided, the given speed is added to the profile file
 * for the nodes in that way.
 *
 * @param {string} osrmFolder Path to the baseline OSRM
 * @param {object} upgradeWay Way that is going to be upgraded.
 * @param {number} upgradeSpeed Speed to use for the upgraded way.
 *
 * @returns Promise, but caches the osrm file paths in var `floodOSRMFiles`
 */
async function prepareFloodOSRMFiles (upgradeWay, upgradeSpeed) {
  return Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const impassableWays = await getImpassableWays(retPeriod);

    const osrmFolderName = `osrm-flood-${retPeriod}`;
    const osrmFolder = `${TMP_DIR}/${osrmFolderName}`;

    tStart(`[IGNORE WAYS] ${retPeriod} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    tEnd(`[IGNORE WAYS] ${retPeriod} clean`)();

    const speedProfileFile = `${TMP_DIR}/speed-${retPeriod}.csv`;

    tStart(`[IGNORE WAYS] ${retPeriod} traffic profile`)();
    await createSpeedProfile(speedProfileFile, impassableWays);
    tEnd(`[IGNORE WAYS] ${retPeriod} traffic profile`)();

    // If there is a way to upgrade, update the speed profile accordingly.
    if (upgradeWay) {
      tStart(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
      await createSpeedProfile(speedProfileFile, [upgradeWay], upgradeSpeed, true);
      tEnd(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
    }

    tStart(`[IGNORE WAYS] ${retPeriod} osm-contract`)();
    await osrmContract(osrmFolder, speedProfileFile, retPeriod, {ROOT_DIR, LOG_DIR});
    tEnd(`[IGNORE WAYS] ${retPeriod} osm-contract`)();

    // Speed profile file is no longer needed.
    fs.remove(speedProfileFile);

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

/**
 * Calculates the Expected Annual User Loss for an OD pair.
 * To do this it uses a formula that relates the RUC of the baseline RN
 * and the RUC of the different flood return periods.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {object} origin Origin for the route.
 * @param {object} destination Destination for the route.
 *
 * @uses calcRUC()
 * @uses getFloodOSRMFile()
 */
async function calcEaul (osrmFolder, origin, destination) {
  // Calculate baseline RUC for this OD pair.
  // Using road network with no disruptions.
  const odPairRUC = await calcRUC(osrmFolder, origin, destination);
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

/**
 * Calculates the Road User Cost for an OD pair.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {object} origin Origin for the route.
 * @param {object} destination Destination for the route.
 *
 * @uses osrmRoute()
 */
async function calcRUC (osrmFolder, origin, destination) {
  var osrm = new OSRM(`${osrmFolder}/roadnetwork.osrm`);
  const coordinates = [
    origin.geometry.coordinates,
    destination.geometry.coordinates
  ];

  const result = await osrmRoute(osrm, {coordinates, annotations: ['nodes']});
  // Through the osrm speed profile we set the speed to be 1/ruc.
  // By doing so, the total time (in hours) will be cost of the kms travelled.
  const ruc = result.routes[0].legs[0].duration / 3600 * 10000;

  jsonToFile(`${LOG_DIR}/result-${origin.properties.Name}-${destination.properties.Name}.json`)(result);
  return ruc;
}

//
//               (^.^)
// RUN function below - Main entry point.

async function run (odPairs) {
  // Prepare the OSRM files per flood return period.
  await prepareFloodOSRMFiles();

  // Calculate the baseline EAUL for the RN.
  let baselineEAUL = 0;
  // For each od api combination.
  await forEachArrayCombination(odPairs, async (origin, destination) => {
    clog('origin', origin);
    clog('destination', destination);
    tStart('EAUL od pair')();
    // Calculate EAUL (Expected Annual User Loss) for this OD pair.
    const odPairEaul = await calcEaul(OSRM_FOLDER, origin, destination);
    tEnd('EAUL od pair')();
    clog('odPairEaul', odPairEaul);
    clog('--------');
    clog('');
    baselineEAUL += odPairEaul;
  });
  clog('baselineEAUL', baselineEAUL);

  // Create an OSRM for upgrades.
  const osrmUpFolderName = 'osrm-upgrade';
  const osrmUpFolder = `${TMP_DIR}/${osrmUpFolderName}`;
  await fs.copy(OSRM_FOLDER, osrmUpFolder);

  // Upgrade way.
  for (const way of waysList.slice(300, 301)) {
    for (const upgrade of ROAD_UPGRADES) {
      clog('[UPGRADE WAYS] id, upgrade', way.id, upgrade);
      // Get new speeds for this upgraded way.
      const speed = await getUpgradeWaySpeed(way, upgrade);

      // Create a speed profile for the baseline.
      const speedProfileFile = `${TMP_DIR}/speed-upgrade-${way.id}.csv`;
      tStart(`[UPGRADE WAYS] ${way.id} traffic profile`)();
      await createSpeedProfile(speedProfileFile, [way], speed);
      tEnd(`[UPGRADE WAYS] ${way.id} traffic profile`)();

      tStart(`[UPGRADE WAYS] ${way.id} osm-contract`)();
      await osrmContract(osrmUpFolder, speedProfileFile, way.id, {ROOT_DIR, LOG_DIR});
      tEnd(`[UPGRADE WAYS] ${way.id} osm-contract`)();

      // Speed profile file is no longer needed.
      fs.remove(speedProfileFile);

      // Prepare flood files for this way.
      await prepareFloodOSRMFiles(way, speed);

      // Calculate the EAUL of all OD pairs for this way-upgrade combination.
      let wayUpgradeEAUL = 0;
      // For each od api combination.
      await forEachArrayCombination(odPairs, async (origin, destination) => {
        // Calculate EAUL (Expected Annual User Loss) for this OD pair.
        const odPairEaul = await calcEaul(osrmUpFolder, origin, destination);
        clog('[UPGRADE WAYS] id, eaul:', way.id, odPairEaul);
        wayUpgradeEAUL += odPairEaul;
      });
      clog('[UPGRADE WAYS] wayUpgradeEAUL:', wayUpgradeEAUL);

      const finalEAUL = baselineEAUL - wayUpgradeEAUL;
      clog(`For way [${way.id}] with the upgrade [${upgrade}] the eaul is`, finalEAUL);
    }
  }
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
