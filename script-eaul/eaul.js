'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';
import program from 'commander';

import { tStart, tEnd, jsonToFile, initLog } from '../scripts/utils/logging';
import { createSpeedProfile, osrmContract } from '../scripts/utils/utils';

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
const FLOOD_DEPTH_FILE = path.resolve(SOURCE_DIR, 'flood-depths-current.json');

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
// How many flood return period eaul calculations to run simultaneously.
const CONCURRENCY_FLOOD_EAUL = 5;

const FLOOD_RETURN_PERIOD = [5, 10, 20, 50, 75, 100, 200, 250, 500, 1000];

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
};

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
function getImpassableWays (retPeriod, upgradeWay, upgrade) {
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
 * Returns the new speed for a way given an upgrade.
 * The speed is calculated with the formula: 1 / RUC
 *
 * @param {object} way  Way being upgraded.
 * @param {string} upgrade Upgrade to apply to the way.
 *                         Will be one of ROAD_UPGRADES
 *
 * @returns {number} New speed for way after the upgrade.
 */
function getUpgradeWaySpeed (way, upgrade) {
  return upgrade.speed;
}

/**
 * Computes the RUC between all combinations of OD pairs.
 *
 * @param {osrm} osrm The OSRM instance.
 * @param {object} opts Options to pass to the route method.
 *
 * @returns {object}
 * {
 *   oIdx: // origin index in the odPairs array.
 *   dIdx: // destination index in the odPairs array.
 *   routable: // Whether this pair is routable.
 *   ruc: // RUC of pair if it is routable, otherwise null.
 * }
 */
function osrmTable (osrm, opts) {
  return new Promise((resolve, reject) => {
    osrm.table(opts, (err, res) => {
      if (err) return reject(err);

      // Create origin destination array.
      const table = res.durations;
      const len = table.length;
      var result = [];

      // For loops, not as pretty but fast.
      for (let rn = 0; rn < len - 1; rn++) {
        for (let cn = rn + 1; cn < len; cn++) {
          // Going from A to B may yield a different value than going from
          // B to A. For some reason if the starting point is near a road that
          // is ignored (with the speed profile) it will be marked and
          // unroutable and null is returned.
          let ab = table[rn][cn];
          let ba = table[cn][rn];

          // When the closest segment to A or B is the one ignored, the route
          // should be considered unroutable. This will solve the cases
          // outlined in https://github.com/developmentseed/moz-datapipeline/issues/7#issuecomment-363153755
          if (ab === null || ba === null) {
            result.push({
              oIdx: rn,
              dIdx: cn,
              routable: false,
              ruc: null
            });
          } else {
            result.push({
              oIdx: rn,
              dIdx: cn,
              routable: true,
              ruc: Math.max(ab, ba) / 3600
            });
          }
        }
      }
      return resolve(result);
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
    const osrmFolderName = `osrm-flood-${retPeriod}`;
    const osrmFolder = `${wdir}/${osrmFolderName}`;
    floodOSRMFiles[retPeriod] = osrmFolder;

    // DEV check.
    // if (await fs.exists(osrmFolder)) return;

    tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} ALL`)();
    const impassableWays = getImpassableWays(retPeriod, upgradeWay, upgrade);

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} clean`)();

    const speedProfileFile = `${wdir}/speed-${retPeriod}.csv`;

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile`)();
    await createSpeedProfile(speedProfileFile, impassableWays);
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile`)();

    // If there is a way to upgrade, update the speed profile accordingly.
    if (upgradeWay) {
      // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile upgrade`)();
      const speed = getUpgradeWaySpeed(upgradeWay, upgrade);
      await createSpeedProfile(speedProfileFile, [upgradeWay], speed, true);
      // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} traffic profile upgrade`)();
    }

    // tStart(`[IGNORE WAYS] ${identifier} ${retPeriod} osm-contract`)();
    await osrmContract(osrmFolder, speedProfileFile, retPeriod, {ROOT_DIR, LOG_DIR});
    // tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} osm-contract`)();

    // Speed profile file is no longer needed.
    fs.remove(speedProfileFile);

    tEnd(`[IGNORE WAYS] ${identifier} ${retPeriod} ALL`)();
  }, {concurrency: CONCURRENCY_FLOOD_OSRM});

  return floodOSRMFiles;
}

/**
 * Calculates the repair time given a flood return period.
 *
 * @param {number} retPeriod Flood return period.
 *
 * @returns {number} The repair time.
 */
function calcFloorRepairTime (retPeriod) {
  // TODO:
  // Calculate flood repair time `r`.
  // Get the impassable ways for this flood return period.
  // Calculate the repair time for each one and get the max.
  const impassableWays = getImpassableWays(retPeriod);
  return impassableWays.length;
}

/**
 * Calculates the traffic between the origin and destination.
 *
 * @param {object} origin Origin point.
 * @param {object} destination Destination point.
 *
 * @returns {number} OD pair traffic.
 */
function getODPairTraffic (origin, destination) {
  // TODO: Implement
  return 10;
}

/**
 * Calculates the increased user cost for a given return period using
 * the formula:
 * Ui = ri * SUM od pairs (RUC ODi - RUC ODbase) * tOD
 *
 * @param {number} retPeriod Flood return period
 * @param {array} odPairs List of OD Pairs
 * @param {array} baselineRUC RUC for all odPairs without disruption.
 * @param {array} odPairsFloodRUC RUC for all odPairs with flooded network.
 *
 * @returns {number} Increased user cost
 */
function calcIncreasedUserCost (retPeriod, odPairs, baselineRUC, odPairsFloodRUC) {
  // Flood repair time.
  const r = calcFloorRepairTime(retPeriod);
  const sum = odPairsFloodRUC.reduce((acc, odPairRUC, idx) => {
    const origin = odPairs[odPairRUC.oIdx];
    const destination = odPairs[odPairRUC.dIdx];
    return (odPairRUC.ruc - baselineRUC[idx].ruc) * getODPairTraffic(origin, destination);
  }, 0);

  return r * sum;
}

let unroutableFloodedPairs = {};
/**
 * Calculates the Expected Annual User Loss for all OD pairs.
 * To do this it uses a formula that relates the RUC of the baseline RN
 * and the RUC of the different flood return periods.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {array} odPairs OD Pairs to use.
 *
 * @uses getFloodOSRMFile()
 * @uses osrmTable()
 * @uses {object} unroutableFloodedPairs
 */
async function calcEaul (osrmFolder, odPairs, floodOSRMFiles, identifier = 'all') {
  // Extract all the coordinates for osrm
  const coords = odPairs.map(feat => feat.geometry.coordinates);

  var osrm = new OSRM({ path: `${OSRM_FOLDER}/roadnetwork.osrm`, algorithm: 'CH' });
  const baselineRUC = await osrmTable(osrm, {coordinates: coords});
  jsonToFile(`${LOG_DIR}/no-flood--${identifier}.json`)(baselineRUC);

  // Flooding the network will make some OD pairs unroutable. When we run the
  // eaul calculation for the 1st time we need to store which pairs become
  // unroutable and disregard them on the subsequent calculations.
  // It is not enough to check the routable flag because the pair may be
  // routable on one of the flood return periods but not on the other.
  // It is enough for one return period to be unroutable to have the pair
  // removed from all calculations.
  // The unroutableFloodedPairs variable is stored as a global since it has to
  // mutated by the first run which we identify by the 'all' identifier param.
  let unroutablePairs = [];

  // Calculate RUC on a flooded RN depending on the flood return period.
  // The calculation of the RUC  need to be separate from the rest because we
  // need to have all the unroutable pairs so we know which ones to exclude when
  // applying the formula:
  const odPairsFloodsRUC = await Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const floodOSRM = floodOSRMFiles[retPeriod];
    var osrm = new OSRM({ path: `${floodOSRM}/roadnetwork.osrm`, algorithm: 'CH' });
    const result = await osrmTable(osrm, {coordinates: coords});

    // Global run.
    if (identifier === 'all') {
      const pairs = result.filter(o => !o.routable).map(o => `${o.oIdx}-${o.dIdx}`);
      unroutablePairs = unroutablePairs.concat(pairs);
    }
    return result;
  }, {concurrency: CONCURRENCY_FLOOD_EAUL});

  // Create the unroutable pairs index.
  // NOTE: mutating global variable. See above.
  if (identifier === 'all') {
    clog('Computing unroutable pairs');
    unroutablePairs.forEach(o => { unroutableFloodedPairs[o] = true; });
    // Dump unroutable pairs to file.
    const dump = Object.keys(unroutableFloodedPairs).map(o => {
      const [oIdx, dIdx] = o.split('-');
      return [ odPairs[oIdx], odPairs[dIdx] ];
    });
    jsonToFile(`${RESULTS_DIR}/unroutable-pairs.json`)(dump);
  }

  // Filter unroutable pairs from the odPairsFloodsRUC list.
  const odPairsFloodRUCFiltered = odPairsFloodsRUC.map(floodRUCData => {
    // Filter if is on the index.
    return floodRUCData.filter(odPair => !unroutableFloodedPairs[`${odPair.oIdx}-${odPair.dIdx}`]);
  });
  // Filter unroutable pairs from the baseline ruc list as well.
  const baselineRUCFiltered = baselineRUC.filter(odPair => !unroutableFloodedPairs[`${odPair.oIdx}-${odPair.dIdx}`]);

  // EAUL formula. (page 15 of paper):
  // EUAL = 1/2 * SUM flood period[i=1 -> n] (1 / Ti - 1/Ti+1) (Ui + Ui+1)
  // Where i is an integer between 1 and 10, Ti is the ith return period
  // and Ui is the increased user cost corresponding to Ti.
  // Ui is defined as:
  // Ui = ri * SUM od pairs[i=1 -> n] (RUC ODi - RUC ODbase) * tOD
  // Where RUCODi is the road user cost for the OD pair under flood i
  // RUCODbase is the road user cost for the same OD pair in the absence of
  // disruption, ri is the repair time after flood i, and tOD is traffic
  // on this OD pair.
  const t = FLOOD_RETURN_PERIOD;
  let floodSum = 0;
  for (let i = 0; i <= t.length - 2; i++) {
    // Increased User Cost of `i`.
    const ui = calcIncreasedUserCost(t[i], odPairs, baselineRUCFiltered, odPairsFloodRUCFiltered[i]);
    // Increased User Cost of `i + 1`.
    const ui1 = calcIncreasedUserCost(t[i + 1], odPairs, baselineRUCFiltered, odPairsFloodRUCFiltered[i + 1]);
    floodSum += (1 / t[i] - 1 / t[i + 1]) * (ui + ui1);
  }

  const eaul = 1 / 2 * floodSum;

  return eaul;
}

//
//               (^.^)
// RUN function below - Main entry point.

async function run (odPairs) {
  // Prepare the OSRM files per flood return period.
  clog('[baseline] Prepare OSRM flood');
  let floodOSRMFiles = await prepareFloodOSRMFiles();

  clog('[baseline] Calculate EAUL');
  tStart(`[baseline] calcEaul`)();
  const baselineEAUL = await calcEaul(OSRM_FOLDER, odPairs, floodOSRMFiles);
  tEnd(`[baseline] calcEaul`)();
  clog('[baseline] EAUL', baselineEAUL);

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
      // Get new speeds for this upgraded way.
      const speed = getUpgradeWaySpeed(way, upgrade);

      // Create a speed profile for the baseline.
      const speedProfileFile = `${workdir}/speed-upgrade-${way.id}.csv`;
      tStart(`[UPGRADE WAYS] ${way.id} traffic profile`)();
      await createSpeedProfile(speedProfileFile, [way], speed);
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

      // Calculate the EAUL of all OD pairs for this way-upgrade combination.
      clog(`[UPGRADE WAYS] ${way.id} Calculate EAUL`);
      tStart(`[UPGRADE WAYS] ${way.id} calcEaul`)();
      const wayUpgradeEAUL = await calcEaul(osrmUpFolder, odPairs, floodOSRMFiles, `up-${way.id}-${upgrade.id}`);
      tEnd(`[UPGRADE WAYS] ${way.id} calcEaul`)();
      clog(`[UPGRADE WAYS] ${way.id} EAUL`, wayUpgradeEAUL);

      const finalEAUL = baselineEAUL - wayUpgradeEAUL;
      clog(`For way [${way.id}] (${way.tags.NAME}) with the upgrade [${upgrade.id}] the eaul is`, finalEAUL);

      wayResult.eaul[upgrade.id] = finalEAUL;

      tEnd(`[UPGRADE WAYS] ${way.id} UPGRADE`)();
    }
    await jsonToFile(`${RESULTS_DIR}/result--${way.tags.NAME}.json`)(wayResult);
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
