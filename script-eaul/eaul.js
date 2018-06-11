'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';
import program from 'commander';

import { tStart, tEnd, jsonToFile, initLog } from '../scripts/utils/logging';
import { createSpeedProfile, osrmContract, forEachArrayCombination } from '../scripts/utils/utils';

const { ROOT_DIR } = process.env;

/**
 * Calculate the eaul for each improvement on the given ways
 *
 * Usage:
 *  $node ./script-eaul/ [options] <source-dir>
 *
 */

const createWaysIndexObj = (string) => {
  let obj = {};
  string.split(',').forEach(w => { obj[w] = true; });
  return obj;
};

program.version('0.1.0')
  .option('-l <dir>', 'log directory. If not provided one will be created in the source dir')
  .option('-o <dir>', 'Results directory. If not provided one will be created in the source dir')
  .option('-w, --ways <ways>', 'Way ids comma separated (10,1,5,13). If none provided the whole list is used.', createWaysIndexObj)
  .description('Calculate the eaul for each improvement on the given ways')
  .usage('[options] <source-dir>')
  .parse(process.argv);

if (program.args.length !== 1) {
  program.help();
  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const SOURCE_DIR = program.args[0];
const TMP_DIR = path.resolve(SOURCE_DIR, 'workdir');
const LOG_DIR = program.L || path.resolve(TMP_DIR, 'logs');
const RESULTS_DIR = program.O || path.resolve(TMP_DIR, 'results');

const OD_FILE = path.resolve(SOURCE_DIR, 'od.geojson');
const OSRM_FOLDER = path.resolve(SOURCE_DIR, 'osrm');
const WAYS_FILE = path.resolve(SOURCE_DIR, 'roadnetwork-osm-ways.json');
const FLOOD_DEPTH_FILE = path.resolve(SOURCE_DIR, 'flood-depths-current.json')

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Using OD Pairs', OD_FILE);
clog('Using RN Ways', WAYS_FILE);
clog('Using Flood depth', FLOOD_DEPTH_FILE);
const odPairs = fs.readJsonSync(OD_FILE);
var allWaysList = fs.readJsonSync(WAYS_FILE);
const floodDepth = fs.readJsonSync(FLOOD_DEPTH_FILE);

// Filter ways according to input.
var waysList = program.ways ? allWaysList.filter(w => program.ways[w.id]) : allWaysList;

if (!waysList.length) {
  // waysList = waysList.slice(300, 301);
  throw new Error('Way list is empty');
}

// Concurrency control.
// Note that the flood osrm and eaul are computed inside the way processing
// so the number being calculated can reach CONCURRENCY_WAYS x CONCURRENCY_FLOOD_OSRM
// How many ways to process simultaneously.
const CONCURRENCY_WAYS = 5;
// How many osrm flood return period files to process simultaneously.
const CONCURRENCY_FLOOD_OSRM = 5;
// How many OD Pair eaul calculations to run simultaneously.
const CONCURRENCY_OD_PAIRS = 5;

const FLOOD_RETURN_PERIOD = [5, 10, 20, 50, 75, 100, 200, 250, 500, 1000];

// TMP. To be replaced by FLOOD_REPAIRTIME based on road props
const FLOOD_REPAIR_TIME = {
  5: 5,
  10: 10,
  20: 20,
  50: 50,
  75: 75,
  100: 100,
  200: 200,
  250: 250,
  500: 500,
  1000: 1000
};

// Flood repair time depends on three factors:
//  - type of road (primary, secondary, tertiary, vicinal)
//  - surface type (paved, unpaved)
//  - severity of the flood (low, medium, high)
const FLOOD_REPAIRTIME = {
  'low': {
    'paved': {
      'primary': 168,
      'secondary': 168,
      'tertiary': 168,
      'vicinal': 168
    },
    'unpaved': {
      'primary': 1440,
      'secondary': 1440,
      'tertiary': 1440,
      'vicinal': 1440
    }
  },
  'medium': {
    'paved': {
      'primary': 336,
      'secondary': 336,
      'tertiary': 336,
      'vicinal': 336
    },
    'unpaved': {
      'primary': 2160,
      'secondary': 2160,
      'tertiary': 2160,
      'vicinal': 2160
    }
  },
  'high': {
    'paved': {
      'primary': 1056,
      'secondary': 1056,
      'tertiary': 1056,
      'vicinal': 1056
    },
    'unpaved': {
      'primary': 4320,
      'secondary': 4320,
      'tertiary': 4320,
      'vicinal': 4320
    }
  }
};

// The return period roads are designed for
const ROAD_DESIGNSTANDARD = 20;

// New RUC
const newRuc = {
  'asphalt': 0.23,
  'gravel': 0.27,
  'earth': 0.3
}

// Road upgrades to calculate EAUL for.
// These do not directly translate to road upgrade options available on the
// frontend. Since rehab of asphalt and upgrade to asphalt result in the exact
// same road, it's not necessary calculate this twice.
const ROAD_UPGRADES = [
  {
    id: 'upgrade-rehab-asphalt',
    ruc: newRuc['asphalt'],
    speed: 1 / newRuc['asphalt'],
    drainageCapacity: 1,
    conditionRate: 1,
    surface: 'paved',
    condition: 'good'
  },
  {
    id: 'upgrade-rehab-gravel',
    ruc: newRuc['gravel'],
    speed: 1 / newRuc['gravel'],
    drainageCapacity: 1,
    conditionRate: 1,
    surface: 'unpaved',
    condition: 'good'
  },
  {
    id: 'rehab-earth',
    ruc: newRuc['earth'],
    speed: 1 / newRuc['earth'],
    drainageCapacity: 1,
    conditionRate: 1,
    surface: 'unpaved',
    condition: 'good'
  }
];

tStart(`Create lookup tables`)();
// Create lookup tables.
// These are neded to quickly find what ways are being used in a route using
// the nodes returned by osrm.route()
var nodeWayLookup = {
  // nodeId: [wayId, wayId, ...]
};
var waysLookup = {
  // wayId: way
};
allWaysList.forEach(w => {
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
 * Returns the ways that become impassable for a given flood return period.
 * A way is considered impassable if (WLcc - WLd * Dc) > 0.5
 *
 *  WLcc = water level for a given return period
 *  WLd = water level design standard
 *  Dc = drainage capacity rate
 *
 * Note:
 * getImpassableWays() uses the global allWaysList to figure out what ways
 * become impassable with a flood. Once a way is upgraded it may become passable
 * so this function accepts the way being upgraded and the upgrade to perform
 * the necessary calculations.
 *
 * @param {number} retPeriod  Flood return period.
 *                            Will be one of FLOOD_RETURN_PERIOD
 * @param {object} upgradeWay Way that is going to be upgraded.
 * @param {object} upgrade    Object with impact of road upgrade.
 *
 * @uses floodDepth   Object with flood depths per road per return period
 *                    {"N1-T8083": {"10": 2.06, "20": 2.29}, "R441-T5116": {"10": 0.26, "20": 0.41}}
 * @uses allWaysList  List with all the ways.
 *
 * @returns {array} List of ways that are impassable.
 */
async function getImpassableWays (retPeriod, upgradeWay, upgrade) {
  return allWaysList.filter(way => {
    // Get Wlcc for this way, for the return period.
    let wlcc = floodDepth[way.tags.NAME][retPeriod];

    // Get Water Level that this road was designed for.
    let wld = floodDepth[way.tags.NAME][ROAD_DESIGNSTANDARD];

    // Default drainage capacity is 0.7, unless road is upgraded
    let dc = upgradeWay && way.id === upgradeWay.id ? upgrade.drainageCapacity : 0.7;

    return (wlcc - wld * dc) > 0.5;
  });
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

/**
 * Creates a osrm file for each return period ignoring the segments that
 * get flooded on that return period. To ignore the segments the speed between
 * nodes is set to 0.
 * If an upgradeWay is provided, the given speed is added to the profile file
 * for the nodes in that way.
 *
 * @param {string} wdir Working directory. Defaults to TMP_DIR
 * @param {string} osrmFolder Path to the baseline OSRM
 * @param {object} upgradeWay Way that is going to be upgraded.
 * @param {object} upgrade Object with impact of road upgrade.
 *
 * @returns OSRM file paths for flood files.
 */

async function prepareFloodOSRMFiles (wdir = TMP_DIR, upgradeWay, upgrade) {
  let floodOSRMFiles = {};
  const identifier = upgradeWay ? upgradeWay.id : '';

  await Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} ALL`)();
    const impassableWays = await getImpassableWays(retPeriod, upgradeWay, upgrade);

    const osrmFolderName = `osrm-flood-${retPeriod}`;
    const osrmFolder = `${wdir}/${osrmFolderName}`;

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} clean`)();

    const speedProfileFile = `${wdir}/speed-${retPeriod}.csv`;

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile`)();
    await createSpeedProfile(speedProfileFile, impassableWays);
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile`)();

    // If there is a way to upgrade, update the speed profile accordingly.
    if (upgradeWay) {
      // tStart(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
      await createSpeedProfile(speedProfileFile, [upgradeWay], upgrade.speed, true);
      // tEnd(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
    }

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} osm-contract`)();
    await osrmContract(osrmFolder, speedProfileFile, retPeriod, {ROOT_DIR, LOG_DIR});
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} osm-contract`)();

    // Speed profile file is no longer needed.
    fs.remove(speedProfileFile);

    floodOSRMFiles[retPeriod] = osrmFolder;
    tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} ALL`)();
  }, {concurrency: CONCURRENCY_FLOOD_OSRM});

  return floodOSRMFiles;
}

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

  // tStart(`Node search`)();
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
  // tEnd(`Node search`)();

  return usedWaysIdx;
}

/**
 * Calculates the Expected Annual User Loss for an OD pair.
 * To do this it uses a formula that relates the RUC of the baseline RN
 * and the RUC of the different flood return periods.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {object} origin Origin for the route.
 * @param {object} destination Destination for the route.
 * @param {object} floodOSRMFiles Paths to the flood OSRM files to use
 *
 * @uses calcRoute()
 */
async function calcEaul (osrmFolder, origin, destination, floodOSRMFiles) {
  // Calculate baseline RUC for this OD pair.
  // Using road network with no disruptions.
  const odPairRes = await calcRoute(osrmFolder, origin, destination);
  clog(`RUC ${origin.properties.Name}.${origin.properties.OBJECTID} - ${destination.properties.Name}.${origin.properties.OBJECTID}`, odPairRes.ruc);

  // Calculate RUC on a flooded RN depending on the flood return period.
  const increaseUCost = await Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const floodOSRM = floodOSRMFiles[retPeriod];
    const {ruc, ways} = await calcRoute(floodOSRM, origin, destination);
    // TODO: Add od pair traffic.
    return FLOOD_REPAIR_TIME[retPeriod] * (ruc - odPairRes.ruc) * 1;
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
 * Calculates the route for an OD pair, including the RUC and the ways.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {object} origin Origin for the route.
 * @param {object} destination Destination for the route.
 *
 * @uses osrmRoute()
 */
async function calcRoute (osrmFolder, origin, destination) {
  var osrm = new OSRM(`${osrmFolder}/roadnetwork.osrm`);
  const coordinates = [
    origin.geometry.coordinates,
    destination.geometry.coordinates
  ];

  let result;
  try {
    result = await osrmRoute(osrm, {coordinates, annotations: ['nodes']});
  } catch (e) {
    if (e.message === 'NoSegment' || e.message === 'NoRoute') {
      const error = new Error('Unroutable OD Pair');
      error.origin = origin;
      error.destination = destination;
      throw error;
    }
  }

  // Through the osrm speed profile we set the speed to be 1/ruc.
  // By doing so, the total time (in hours) will be cost of the kms travelled.
  const ruc = result.routes[0].legs[0].duration / 3600;

  const ways = getWaysForRoute(result.routes[0].legs[0].annotation.nodes);
  jsonToFile(`${LOG_DIR}/ways-${origin.properties.Name}.${origin.properties.OBJECTID}-${destination.properties.Name}in.properties.OBJECTID}.json`)(ways);

  jsonToFile(`${LOG_DIR}/result-${origin.properties.Name}.${origin.properties.OBJECTID}-${destination.properties.Name}in.properties.OBJECTID}.json`)(result);
  return {ruc, ways};
}

//
//               (^.^)
// RUN function below - Main entry point.

async function run (odPairs) {
  // Prepare the OSRM files per flood return period.
  clog('[baseline] Prepare OSRM flood');
  let floodOSRMFiles = await prepareFloodOSRMFiles();

  // Create the unroutable pairs index.
  // Unroutable pairs will be stored like [oIdx-dIdx] = true because it
  // will be very fast to find the values.
  // https://github.com/developmentseed/moz-datapipeline/issues/26#issuecomment-389957802
  let unroutableFloodedPairs = {};

  // Calculate the baseline EAUL for the RN.
  let baselineEAUL = 0;
  // For each od api combination.
  await forEachArrayCombination(odPairs, async (origin, destination, oIdx, dIdx) => {
    clog('[baseline] Origin', origin.properties.Name);
    clog('[baseline] Destination', destination.properties.Name);
    tStart(`[baseline] ${oIdx}-${dIdx} EAUL od pair`)();
    // Calculate EAUL (Expected Annual User Loss) for this OD pair.
    let odPairEaul;
    try {
      odPairEaul = await calcEaul(OSRM_FOLDER, origin, destination, floodOSRMFiles);
    } catch (e) {
      if (e.message === 'Unroutable OD Pair') {
        clog('[baseline] Found unroutable OD Pair');
        unroutableFloodedPairs[`${oIdx}-${dIdx}`] = true;
        odPairEaul = 0; // 0 and continue.
      }
    }
    tEnd(`[baseline] ${oIdx}-${dIdx} EAUL od pair`)();
    clog(`[baseline] ${oIdx}-${dIdx} EAUL`, odPairEaul);
    clog('');
    baselineEAUL += odPairEaul;
  }, CONCURRENCY_OD_PAIRS);
  clog('[baseline] EAUL', baselineEAUL);
  clog('Unroutable pairs found:', Object.keys(unroutableFloodedPairs).length);

  // Dump unroutable pairs to file.
  const dump = Object.keys(unroutableFloodedPairs).map(o => {
    const [oIdx, dIdx] = o.split('-');
    return {
      // Indexes on the original OD Pair list.
      arrayIdx: [oIdx, dIdx],
      pairs: [odPairs[oIdx], odPairs[dIdx]]
    };
  });
  jsonToFile(`${RESULTS_DIR}/unroutable-pairs.json`)(dump);

  // Upgrade way.
  await Promise.map(waysList, async (way) => {
    // Create working directory.
    const workdir = `${TMP_DIR}/eaul-work-${way.id}`;
    await fs.ensureDir(workdir);

    // Create an OSRM for upgrades.
    const osrmUpFolderName = 'osrm';
    const osrmUpFolder = `${workdir}/${osrmUpFolderName}`;
    await fs.copy(OSRM_FOLDER, osrmUpFolder);

    let wayResult = {
      id: way.id,
      name: way.tags.NAME,
      eaul: {}
    };
    tStart(`[UPGRADE WAYS] ${way.id} FULL`)();
    for (const upgrade of ROAD_UPGRADES) {
      tStart(`[UPGRADE WAYS] ${way.id} UPGRADE`)();

      clog('[UPGRADE WAYS] id, upgrade:', way.id, upgrade.id);

      // Create a speed profile for the baseline.
      const speedProfileFile = `${workdir}/speed-upgrade-${way.id}.csv`;
      tStart(`[UPGRADE WAYS] ${way.id} traffic profile`)();
      await createSpeedProfile(speedProfileFile, [way], upgrade.speed);
      tEnd(`[UPGRADE WAYS] ${way.id} traffic profile`)();

      clog(`[UPGRADE WAYS] ${way.id} OSRM contract`);
      tStart(`[UPGRADE WAYS] ${way.id} osm-contract`)();
      await osrmContract(osrmUpFolder, speedProfileFile, way.id, {ROOT_DIR, LOG_DIR});
      tEnd(`[UPGRADE WAYS] ${way.id} osm-contract`)();

      // Speed profile file is no longer needed.
      fs.remove(speedProfileFile);

      // Prepare flood files for this way.
      clog(`[UPGRADE WAYS] ${way.id} Prepare OSRM flood`);
      let floodOSRMFiles = await prepareFloodOSRMFiles(workdir, way, upgrade);

      clog(`[UPGRADE WAYS] ${way.id} Calculate EAUL`);

      // Calculate the baseline EAUL for the RN.
      let wayUpgradeEAUL = 0;
      // For each od api combination.
      await forEachArrayCombination(odPairs, async (origin, destination, oIdx, dIdx) => {
        if (unroutableFloodedPairs[`${oIdx}-${dIdx}`]) {
          clog(`[UPGRADE WAYS] ${way.id} ${oIdx}-${dIdx} Skipping unroutable ${origin.properties.Name}.${origin.properties.OBJECTID} - ${destination.properties.Name}.${origin.properties.OBJECTID}`);
          return true; // Continue.
        }

        clog(`[UPGRADE WAYS] ${way.id} ${oIdx}-${dIdx} OD pair ${origin.properties.Name}.${origin.properties.OBJECTID} - ${destination.properties.Name}.${origin.properties.OBJECTID}`);
        tStart(`[UPGRADE WAYS] ${way.id} ${oIdx}-${dIdx} calcEaul`)();
        // Calculate EAUL (Expected Annual User Loss) for this OD pair.
        const odPairEaul = await calcEaul(osrmUpFolder, origin, destination, floodOSRMFiles);
        tEnd(`[UPGRADE WAYS] ${way.id} ${oIdx}-${dIdx} calcEaul`)();
        clog(`[UPGRADE WAYS] ${way.id} ${oIdx}-${dIdx} EAUL`, odPairEaul);
        clog('');
        wayUpgradeEAUL += odPairEaul;
      }, CONCURRENCY_OD_PAIRS);

      const finalEAUL = baselineEAUL - wayUpgradeEAUL;
      clog(`For way [${way.id}] (${way.tags.NAME}) with the upgrade [${upgrade.id}] the eaul is`, finalEAUL);

      wayResult.eaul[upgrade.id] = finalEAUL;

      tEnd(`[UPGRADE WAYS] ${way.id} UPGRADE`)();
    }
    jsonToFile(`${RESULTS_DIR}/result--${way.tags.NAME}.json`)(wayResult);
    tEnd(`[UPGRADE WAYS] ${way.id} FULL`)();
  }, {concurrency: CONCURRENCY_WAYS});
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(TMP_DIR),
      fs.ensureDir(RESULTS_DIR),
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
