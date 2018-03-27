'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import OSRM from 'osrm';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';
import { runCmd } from '../utils/utils';

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.resolve(__dirname, '../../.tmp/criticality');
const LOG_DIR = path.resolve(__dirname, '../../log/criticality');

const OD_FILE = path.resolve(OUTPUT_DIR, 'od.geojson');
const WAYS_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork-osm-ways.json');
const OSRM_FOLDER = path.resolve(OUTPUT_DIR, 'osrm');

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

  return jsonToFile(`${LOG_DIR}/criticality.json`)(result);
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

  await ignoreSegment(way, `${TMP_DIR}/${osrmFolder}`);

  tStart(`WAY ${way.id} osrm-table`)();
  const result = await osrmTable(`${TMP_DIR}/${osrmFolder}/roadnetwork.osrm`, {coordinates: coords}, way);
  tEnd(`WAY ${way.id} osrm-table`)();

  await jsonToFile(`${LOG_DIR}/ways-times/way-${way.id}-all.json`)(result);

  // We don't have to wait for files to be removed.
  fs.remove(`${TMP_DIR}/speed-${way.id}.csv`);
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
    unroutablePairs,
    impactedPairs
  };

  return jsonToFile(`${LOG_DIR}/ways-times/way-${way.id}.json`)(data);
}

/**
 * Ignores a segment from the RN network by setting the max travel speed
 * between all the nodes on that segment to 0.
 * Steps:
 * - Calls createSpeedProfile()
 * - Run osrm-contract on the osrm files using the created speed profile.
 *
 * @param  {object} way        Way being ignored.
 * @param  {string} osrmFolder Path to osrm folder
 *
 * @return {Promise}           Resolves with no data.
 */
async function ignoreSegment (way, osrmFolder) {
  const identifier = way.id;
  const speedProfileFile = `${TMP_DIR}/speed-${identifier}.csv`;
  const rootPath = path.resolve(__dirname, '../..');

  // Path relative to ../.. for docker
  const relativeOSRM = path.relative(rootPath, osrmFolder);
  const relativeSpeedProf = path.relative(rootPath, speedProfileFile);

  tStart(`WAY ${identifier} traffic profile`)();
  await createSpeedProfile(speedProfileFile, way);
  tEnd(`WAY ${identifier} traffic profile`)();

  tStart(`WAY ${identifier} osm-contract`)();
  await runCmd('docker', [
    'run',
    '--rm',
    '-t',
    '-v', `${rootPath}:/data`,
    'osrm/osrm-backend:v5.16.4',
    'osrm-contract',
    '--segment-speed-file', `/data/${relativeSpeedProf}`,
    `/data/${relativeOSRM}/roadnetwork.osrm`
  ], {}, `${LOG_DIR}/osm-contract-logs/way-${way.id}.log`);
  tEnd(`WAY ${identifier} osm-contract`)();
}

/**
 * Create a speed profile file with all the node pairs on the RN and the max
 * speed set to 0
 *
 * @param  {String} speedProfileFile Path to speed profile.
 * @param  {Object} way              Way to write profile for.
 *
 * @return Promise{}                 Resolves when file was written.
 */
function createSpeedProfile (speedProfileFile, way) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(speedProfileFile);

    file
      .on('open', () => {
        // Compute traffic profile.
        // https://github.com/Project-OSRM/osrm-backend/wiki/Traffic
        for (let i = 0; i < way.nodes.length - 2; i++) {
          if (i !== 0) { file.write('\n'); }

          const node = way.nodes[i];
          const nextNode = way.nodes[i + 1];

          file.write(`${node},${nextNode},0\n`);
          file.write(`${nextNode},${node},0`);
        }
        file.end();
      })
      .on('error', err => reject(err))
      .on('finish', () => resolve());
  });
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
  }
}());
