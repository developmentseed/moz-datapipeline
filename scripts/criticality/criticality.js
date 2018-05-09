'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';
import { dataToCSV, createSpeedProfile, osrmContract } from '../utils/utils';

/**
 * Performs the criticality analysis outputting the indicator score.
 *
 * Required files:
 * - od.geojson
 * - roadnetwork-osm-ways.json
 * - osrm/
 *
 * Usage:
 *  $node ./scripts/criticality [source-dir]
 *
 */

const { ROOT_DIR } = process.env;

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/criticality');

const OD_FILE = path.resolve(TMP_DIR, 'od.geojson');
const WAYS_FILE = path.resolve(TMP_DIR, 'roadnetwork-osm-ways.json');
const OSRM_FOLDER = path.resolve(TMP_DIR, 'osrm');

const IND_NAME = 'criticality';
const OUTPUT_INDICATOR_FILE = path.resolve(OUTPUT_DIR, `indicator-${IND_NAME}.csv`);

// Number of concurrent operations to run.
const CONCURR_OPS = 5;

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

const odPairs = fs.readJsonSync(OD_FILE);
var ways = fs.readJsonSync(WAYS_FILE);

clog('Using OD Pairs', OD_FILE);

// Ways subset:
// ways = ways.slice(0, 5);
// Ways using nodes:
// ways = [ways.find(way => way.nodes.indexOf('1405957') !== -1)]
// Specific way:
// ways = [
//   ways.find(way => way.id === '2289499')
// ];

/**
 * Run the criticality analysis.
 * Steps:
 * - Computes the time it takes for each OD pair.
 * - For each way on the RN:
 *   - Removes it runs the analysis again.
 *   - Computes the time difference for each OD pair (compare to benchmark)
 *   - Stores the cumulative "time lost" for each way. (The additional time
 *     needed when that way is removed.)
 *
 * @param  {Array} ways     All the ways in the RN (as provided by extract-ways.js)
 * @param  {Array} odPairs  The OD pairs.
 */
async function run (ways, odPairs) {
  // Extract all the coordinates for osrm
  const coords = odPairs.features.map(feat => feat.geometry.coordinates);

  tStart('benchmark')();
  // Run the benchmark analysis
  const benchmark = await osrmTable(`${OSRM_FOLDER}/roadnetwork.osrm`, {coordinates: coords});
  tEnd('benchmark')();

  var i = 0;
  const result = await Promise.map(ways, async (way) => {
    clog('start for way', `${++i}/${ways.length}`, `(${way.id})`);
    tStart(`WAY ${way.id} total`)();
    // Calculate the "time lost" for a given way.
    const data = await calcTimePenaltyForWay(way, coords, benchmark);
    tEnd(`WAY ${way.id} total`);

    return data;
  }, {concurrency: CONCURR_OPS});

  clog('changes', result.filter(o => o.time > 0));
  clog('data length', result.length);

  // Calculate score (0 - 100)
  // maxtime: normalize values taking into account affected and unroutable pairs.
  // maxUnroutable: self describing.
  // Use same reduce to avoid additional loops.
  const { avgMaxTime, maxUnroutable } = result.reduce((acc, o) => ({
    avgMaxTime: Math.max(acc.avgMaxTime, (o.unroutablePairs + o.impactedPairs) * o.avgTimeNonZero),
    maxUnroutable: Math.max(acc.maxUnroutable, o.unroutablePairs)
  }), { avgMaxTime: 0, maxUnroutable: 0 });

  const scoredRes = result.map(segment => {
    const timeScore = ((segment.unroutablePairs + segment.impactedPairs) * segment.avgTimeNonZero) / avgMaxTime;
    const unroutableScore = segment.unroutablePairs / maxUnroutable;

    // Time is 40%, unroutable is 60%.
    // Then normalize to 0 - 100 scale.
    segment.score = ((timeScore || 0) * 0.4 + (unroutableScore || 0) * 0.6) * 100;

    return segment;
  });

  await jsonToFile(`${LOG_DIR}/criticality.json`)(scoredRes);

  const waysScore = scoredRes.map(o => ({
    way_id: o.name,
    score: o.score
  }));

  const csv = await dataToCSV(waysScore);
  return fs.writeFile(OUTPUT_INDICATOR_FILE, csv);
}

/**
 * Computes the time between every OD using the provided osrm file.
 *
 * @param  {string} file Path to the osrm file.
 * @param  {Object} opts Options for osrm-table.
 * @param  {object} way  Way being excluded.
 * @return {Promise}     Promise resolving with array of time between every
 *                       OD pairs.
 */
function osrmTable (file, opts, way) {
  return new Promise((resolve, reject) => {
    var osrm = new OSRM(file);
    osrm.table(opts, (err, response) => {
      if (err) return reject(err);

      // Create origin destination array.
      const table = response.durations;
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
              time: null
            });
          } else {
            result.push({
              oIdx: rn,
              dIdx: cn,
              routable: true,
              time: Math.max(ab, ba)
            });
          }
        }
      }

      return resolve(result);
    });
  });
}

/**
 * Calculate the "time lost" for a given way. By ignoring the way from the
 * road network we know how important it is when compared with the
 * benchmark analysis.
 *
 * @param  {Object} way      Way to ignore from the RN.
 * @param  {Array} coords    OD coordinates
 * @param  {Array} benchmark Benchmark analysis of th RN.
 *
 * @return {Object}          Way analysis
 *   {
 *      wayId: OSM id
 *      name: WAY name
 *      maxTime: Max time lost of all OD Pairs
 *      unroutablePairs: Number of OD pairs that became unroutable.
 *      impactedPairs: Number of OD pairs affected
 *   }
 */
async function calcTimePenaltyForWay (way, coords, benchmark) {
  const osrmFolder = `osrm-${way.id}`;

  tStart(`WAY ${way.id} clean`)();
  await fs.copy(OSRM_FOLDER, `${TMP_DIR}/${osrmFolder}`);
  tEnd(`WAY ${way.id} clean`)();

  const speedProfileFile = `${TMP_DIR}/speed-${way.id}.csv`;

  tStart(`[IGNORE WAYS] ${way.id} traffic profile`)();
  await createSpeedProfile(speedProfileFile, [way]);
  tEnd(`[IGNORE WAYS] ${way.id} traffic profile`)();

  tStart(`[IGNORE WAYS] ${way.id} osm-contract`)();
  await osrmContract(`${TMP_DIR}/${osrmFolder}`, speedProfileFile, way.id, {ROOT_DIR, LOG_DIR});
  tEnd(`[IGNORE WAYS] ${way.id} osm-contract`)();

  // Speed profile file is no longer needed.
  fs.remove(speedProfileFile);

  tStart(`WAY ${way.id} osrm-table`)();
  const result = await osrmTable(`${TMP_DIR}/${osrmFolder}/roadnetwork.osrm`, {coordinates: coords}, way);
  tEnd(`WAY ${way.id} osrm-table`)();

  await jsonToFile(`${LOG_DIR}/ways-times/way-${way.id}-all.json`)(result);

  // We don't have to wait for files to be removed.
  fs.remove(`${TMP_DIR}/${osrmFolder}`);

  // Start processing.

  // Debug vars
  var minTime = 0;
  var max = 0;

  var unroutablePairs = 0;
  var impactedPairs = 0;
  var timeDeltas = [];

  // Do all the processing in a single foreach to avoid multiple array loops.
  result.forEach(o => {
    if (!o.routable) {
      unroutablePairs++;
      return;
    }

    // Find benchmark item.
    const bMarkItem = benchmark.find(b => b.oIdx === o.oIdx && b.dIdx === o.dIdx);
    var deltaT = o.time - bMarkItem.time;

    if (deltaT >= 0) timeDeltas.push(deltaT);
    if (deltaT > 0) impactedPairs++;
    if (deltaT < 0) unroutablePairs++;

    // Done. Below is all debug info.

    // Debug: Log the max time for each way.
    if (max < deltaT) {
      max = deltaT;
      const orig = odPairs.features[o.oIdx];
      const dest = odPairs.features[o.dIdx];
      const dump = {
        wayId: way.id,
        time: deltaT,
        debugUrl: `http://localhost:9966/?loc=${orig.geometry.coordinates[1]}%2C${orig.geometry.coordinates[0]}&loc=${dest.geometry.coordinates[1]}%2C${dest.geometry.coordinates[0]}`,
        item: o,
        benchmark: bMarkItem,
        origin: orig,
        destination: dest
      };
      jsonToFile(`${LOG_DIR}/max-time-${way.id}.json`)(dump);
    }

    // Debug: Negative values.
    if (deltaT < -300) {
      clog('High negative time detected', `(${deltaT})`, `way ${way.id}`, 'dumping to file. Assuming unroutable');

      // Only log the highest negative.
      if (deltaT < minTime) {
        minTime = deltaT;
        const orig = odPairs.features[o.oIdx];
        const dest = odPairs.features[o.dIdx];
        const dump = {
          wayId: way.id,
          negativeTime: deltaT,
          debugUrl: `http://localhost:9966/?loc=${orig.geometry.coordinates[1]}%2C${orig.geometry.coordinates[0]}&loc=${dest.geometry.coordinates[1]}%2C${dest.geometry.coordinates[0]}`,
          item: o,
          benchmark: bMarkItem,
          origin: odPairs.features[o.oIdx],
          destination: odPairs.features[o.dIdx]
        };
        jsonToFile(`${LOG_DIR}/negative-time-${way.id}.json`)(dump);
      }
    } else if (deltaT < 0) {
      clog('Low negative time detected', `(${deltaT})`, `way ${way.id}`, 'Assuming unroutable');
    }
  });

  const data = {
    wayId: way.id,
    name: way.tags.NAME,
    maxTime: Math.max(...timeDeltas),
    avgTime: timeDeltas.reduce((a, b) => a + b) / timeDeltas.length,
    avgTimeNonZero: (timeDeltas.reduce((a, b) => a + b) / timeDeltas.reduce((acc, o) => acc + Number(!!o), 0)) || 0,
    unroutablePairs,
    impactedPairs
  };

  return jsonToFile(`${LOG_DIR}/ways-times/way-${way.id}.json`)(data);
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(TMP_DIR),
      fs.ensureDir(`${LOG_DIR}/ways-times`),
      fs.ensureDir(`${LOG_DIR}/osm-contract-logs`)
    ]);

    tStart(`Total run time`)();
    await run(ways, odPairs);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}());
