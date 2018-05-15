'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';
import { createSpeedProfile, osrmContract } from '../utils/utils';

const { ROOT_DIR } = process.env;

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/eaul');

const OD_FILE = path.resolve(TMP_DIR, 'od-mini.geojson');
const OSRM_FOLDER = path.resolve(TMP_DIR, 'osrm');
const WAYS_FILE = path.resolve(TMP_DIR, 'roadnetwork-osm-ways.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Using OD Pairs', OD_FILE);
clog('Using RN Ways', WAYS_FILE);
const odPairs = fs.readJsonSync(OD_FILE);
var waysList = fs.readJsonSync(WAYS_FILE);

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
  return Math.round(1 / 0.4);
}

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
    tStart(`[IGNORE WAYS] ${retPeriod} ALL`)();
    const impassableWays = await getImpassableWays(retPeriod);

    const osrmFolderName = `osrm-flood-${retPeriod}`;
    const osrmFolder = `${TMP_DIR}/${osrmFolderName}`;

    // tStart(`[IGNORE WAYS] ${retPeriod} clean`)();
    await fs.copy(OSRM_FOLDER, osrmFolder);
    // tEnd(`[IGNORE WAYS] ${retPeriod} clean`)();

    const speedProfileFile = `${TMP_DIR}/speed-${retPeriod}.csv`;

    // tStart(`[IGNORE WAYS] ${retPeriod} traffic profile`)();
    await createSpeedProfile(speedProfileFile, impassableWays);
    // tEnd(`[IGNORE WAYS] ${retPeriod} traffic profile`)();

    // If there is a way to upgrade, update the speed profile accordingly.
    if (upgradeWay) {
      // tStart(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
      await createSpeedProfile(speedProfileFile, [upgradeWay], upgradeSpeed, true);
      // tEnd(`[IGNORE WAYS] ${retPeriod} traffic profile upgrade`)();
    }

    // tStart(`[IGNORE WAYS] ${retPeriod} osm-contract`)();
    await osrmContract(osrmFolder, speedProfileFile, retPeriod, {ROOT_DIR, LOG_DIR});
    // tEnd(`[IGNORE WAYS] ${retPeriod} osm-contract`)();

    // Speed profile file is no longer needed.
    fs.remove(speedProfileFile);

    floodOSRMFiles[retPeriod] = osrmFolder;
    tEnd(`[IGNORE WAYS] ${retPeriod} ALL`)();
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
 * Calculates the Expected Annual User Loss for all OD pairs.
 * To do this it uses a formula that relates the RUC of the baseline RN
 * and the RUC of the different flood return periods.
 *
 * @param {string} osrmFolder Path to the osrm folder to use.
 * @param {arra} odPairs OD Pairs to use.
 *
 * @uses getFloodOSRMFile()
 * @uses osrmTable()
 */
async function calcEaul (osrmFolder, odPairs, identifier = 'all') {
  // Extract all the coordinates for osrm
  const coords = odPairs.map(feat => feat.geometry.coordinates);

  var osrm = new OSRM(`${OSRM_FOLDER}/roadnetwork.osrm`);
  const baselineRuc = await osrmTable(osrm, {coordinates: coords});
  jsonToFile(`${LOG_DIR}/no-flood--${identifier}.json`)(baselineRuc);

  // Calculate RUC on a flooded RN depending on the flood return period.
  const increaseUCost = await Promise.map(FLOOD_RETURN_PERIOD, async (retPeriod) => {
    const floodOSRM = getFloodOSRMFile(retPeriod);
    var osrm = new OSRM(`${floodOSRM}/roadnetwork.osrm`);
    const result = await osrmTable(osrm, {coordinates: coords});
    // Calculate the increased user cost for each OD pair.
    const uCost = result.map((r, idx) => {
      // TODO: Add od pair traffic.
      const odTraffic = 1;
      return {
        ...r,
        increaseUCost: FLOOD_REPAIR_TIME[retPeriod] * (r.ruc - baselineRuc[idx].ruc) * odTraffic
      };
    });

    jsonToFile(`${LOG_DIR}/flood-${retPeriod}--${identifier}.json`)(uCost);

    return uCost;
  }, {concurrency: 5});

  // For each OD pair calculate the EAUL and sum everything.
  const eaul = baselineRuc.reduce((acc, odPair, idx) => {
    // Calculate the EAUL from the increased user cost using the trapezoidal rule.
    let sum = 0;
    const t = FLOOD_RETURN_PERIOD;
    const u = increaseUCost;
    for (let i = 0; i <= t.length - 2; i++) {
      // u[i][idx].increaseUCost --> increased user cost for the current od pair.
      sum += (1 / t[i] - 1 / t[i + 1]) * (u[i][idx].increaseUCost + u[i + 1][idx].increaseUCost);
    }
    return acc + sum;
  }, 0);

  return eaul;
}

//
//               (^.^)
// RUN function below - Main entry point.

async function run (odPairs) {
  // Prepare the OSRM files per flood return period.
  await prepareFloodOSRMFiles();

  tStart(`[baseline] calcEaul`)();
  const baselineEAUL = await calcEaul(OSRM_FOLDER, odPairs);
  tEnd(`[baseline] calcEaul`)();

  // Create an OSRM for upgrades.
  const osrmUpFolderName = 'osrm-upgrade';
  const osrmUpFolder = `${TMP_DIR}/${osrmUpFolderName}`;
  await fs.copy(OSRM_FOLDER, osrmUpFolder);

  // Upgrade way.
  for (const way of waysList.slice(300, 301)) {
    let wayResult = {
      id: way.id,
      eaul: {}
    };
    tStart(`[UPGRADE WAYS] ${way.id} FULL`)();
    for (const upgrade of ROAD_UPGRADES) {
      tStart(`[UPGRADE WAYS] ${way.id} UPGRADE`)();

      clog('[UPGRADE WAYS] id, upgrade:', way.id, upgrade);
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
      tStart(`[UPGRADE WAYS] ${way.id} calcEaul`)();
      const wayUpgradeEAUL = await calcEaul(osrmUpFolder, odPairs, `up-${way.id}-${upgrade}`);
      tEnd(`[UPGRADE WAYS] ${way.id} calcEaul`)();

      const finalEAUL = baselineEAUL - wayUpgradeEAUL;
      clog(`For way [${way.id}] with the upgrade [${upgrade}] the eaul is`, finalEAUL);

      wayResult.eaul[upgrade] = finalEAUL;

      tEnd(`[UPGRADE WAYS] ${way.id} UPGRADE`)();
    }
    jsonToFile(`${LOG_DIR}/result-${way.id}.json`)(wayResult);
    tEnd(`[UPGRADE WAYS] ${way.id} FULL`)();
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
