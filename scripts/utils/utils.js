'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import { spawn } from 'child_process';
import bbox from '@turf/bbox';
import rbush from 'rbush';
import csvStringify from 'csv-stringify';

import { tStart, tEnd } from './logging';
/**
 * Tap into a promise and run the given function.
 * If the fn is a promise it will wait for it to resolve.
 * Any data passed into the function is passed out and can't be modified
 * by the function.
 *
 * @example
 * Promise.resolve('hello world')
 *   .then(tap(() => {
 *     console.log('foo');
 *     return 'bar'; // returned value is lost.
 *   }))
 *   .then(data => {
 *     console.log(data); // 'hello world'
 *   })
 *
 * @param  {Function} fn Function to execute.
 *
 * @return Promise{}     Promise resolved with input data.
 */
export function tap (fn) {
  return (data) => {
    const res = fn();
    return res instanceof Promise
      ? res.then(() => data)
      : Promise.resolve(data);
  };
}

/**
 * Run am external command
 *
 * @param  {String} cmd     Command to run
 * @param  {Array} args     Args for the command
 * @param  {Object} env     Env variables
 * @param  {String} logFile Path to the log file to use
 *
 * @return Promise{}        Resolves when command finishes running.
 */
export function runCmd (cmd, args, env = {}, logFile) {
  return new Promise((resolve, reject) => {
    let logFileStream = fs.createWriteStream(logFile, {flags: 'a'});
    let proc = spawn(cmd, args, { env: Object.assign({}, process.env, env) });
    let error;

    proc.stdout.on('data', (data) => {
      logFileStream.write(data.toString());
    });

    proc.stderr.on('data', (data) => {
      error = data.toString();
    });

    proc.on('close', (code) => {
      logFileStream.end();
      if (code === 0) {
        return resolve();
      } else {
        return reject(new Error(error || 'Unknown error. Code: ' + code));
      }
    });
  });
}

/**
 * Creates rbush tree form the bbox of input features.
 *
 * @param  {Object} areas       Input FeatureCollection.
 * @param  {String} indProperty Property of the indicator
 *
 * @return {Object}             Rbush tree.
 */
export function prepTree (areas, indProperty) {
  var tree = rbush();
  tree.load(areas.features
    .filter(f => f.properties[indProperty] > 0)
    .map(f => {
      let b = bbox(f);
      return {
        minX: b[0],
        minY: b[1],
        maxX: b[2],
        maxY: b[3],
        feat: f
      };
    }));
  return tree;
}

export function round (value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Converts given object to csv.
 *
 * @param  {Object} data       Data to convert to csv. Keys will be used
 *                             as headers.
 * @return {Promise}           Csv data stringified.
 */
export function dataToCSV (data) {
  return new Promise((resolve, reject) => {
    csvStringify(data, {header: true}, (err, output) => {
      if (err) return reject(err);
      return resolve(output);
    });
  });
}

/**
 * Adds a scaled score (0-100) to objects
 *
 * @param  {Array} data        Data to add the score to. Each object contains at least
 *
 * @example
 * // returns [{'value': 20, 'score': 40}, {'value': 50, 'score': 100}]
 * addScaledScore([{'value': 20}, {'value': 50}])
 *
 * @return {Array}             Array with scaled
 *
 */
export function addScaledScore (data) {
  const maxValue = Math.max(...data.map(w => w.value).filter(v => !isNaN(v)));

  // Scale values from 0-100
  return data.map(w => ({ ...w, score: round(w.value / maxValue * 100, 2) }));
}

// Sensible defaults for road properties
export function getRoadClass (road) {
  let roadClass = road.properties.ROAD_CLASS.toLowerCase();
  if (roadClass === 'n/a') return 'secondary';
  return roadClass;
}

export function getSurface (road) {
  let surfType = road.properties.SURF_TYPE.toLowerCase();
  if (surfType === 'paved' || surfType === 'unpaved') return surfType;
  return 'unpaved';
}

export function getRoadCondition (road) {
  let avgCond = road.properties.AVG_COND.toLowerCase();
  if (avgCond === 'very poor' || avgCond === 'n/a') return 'poor';
  return avgCond;
}

/**
 * Create a speed profile file with all the node pairs on the RN and the max
 * speed set to 0
 *
 * @param  {String} speedProfileFile Path to speed profile.
 * @param  {Array} ways              Ways to write profile for.
 *
 * @return Promise{}                 Resolves when file was written.
 */
export function createSpeedProfile (speedProfileFile, ways) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(speedProfileFile);

    file
      .on('open', () => {
        // Compute traffic profile.
        // https://github.com/Project-OSRM/osrm-backend/wiki/Traffic
        ways.forEach((way, idx) => {
          if (idx !== 0) { file.write('\n'); }
          for (let i = 0; i < way.nodes.length - 2; i++) {
            if (i !== 0) { file.write('\n'); }

            const node = way.nodes[i];
            const nextNode = way.nodes[i + 1];

            file.write(`${node},${nextNode},0\n`);
            file.write(`${nextNode},${node},0`);
          }
        });
        file.end();
      })
      .on('error', err => reject(err))
      .on('finish', () => resolve());
  });
}

/**
 * Ignores givem segments from the RN network by setting the max travel speed
 * between all the nodes on that segments to 0.
 * Steps:
 * - Calls createSpeedProfile()
 * - Run osrm-contract on the osrm files using the created speed profile.
 *
 * @uses createSpeedProfile()
 * @uses tStart()
 * @uses tEnd()
 *
 * @param  {object} ways        Way being ignored.
 * @param  {string} osrmFolder  Path to osrm folder
 * @param  {string} processId   Identifier for this process.
 * @param  {object} options     Additional options.
 *                                TMP_DIR: Path to the temporary folder.
 *                                ROOT_DIR: Path to the root folder. (optional)
 *                                LOG_DIR: Path to the log folder.
 *
 * @return {Promise}           Resolves with no data.
 */
export async function ignoreWays (ways, osrmFolder, processId, opts = {}) {
  const mandatoryOpts = ['TMP_DIR', 'LOG_DIR'];
  mandatoryOpts.forEach(o => {
    if (!opts[o]) throw new Error(`Missing option: ${o}`);
  });

  const { TMP_DIR, ROOT_DIR, LOG_DIR } = opts;
  const speedProfileFile = `${TMP_DIR}/speed-${processId}.csv`;
  await createSpeedProfile(speedProfileFile, ways);

  const rootPath = path.resolve(__dirname, '../..');
  // The dockerVolMount depends on whether we're running this from another docker
  // container or directly. See docker-compose.yml for an explanantion.
  const dockerVolMount = ROOT_DIR || rootPath;

  // Paths for the files depending from where this is being run.
  const pathOSRM = ROOT_DIR ? osrmFolder.replace(rootPath, ROOT_DIR) : osrmFolder;
  const pathSpeedProf = ROOT_DIR ? speedProfileFile.replace(rootPath, ROOT_DIR) : speedProfileFile;

  tStart(`[IGNORE WAYS] ${processId} traffic profile`)();
  await createSpeedProfile(speedProfileFile, ways);
  tEnd(`[IGNORE WAYS] ${processId} traffic profile`)();

  tStart(`[IGNORE WAYS] ${processId} osm-contract`)();
  await runCmd('docker', [
    'run',
    '--rm',
    '-t',
    '-v', `${dockerVolMount}:${dockerVolMount}`,
    'osrm/osrm-backend:v5.16.4',
    'osrm-contract',
    '--segment-speed-file', pathSpeedProf,
    `${pathOSRM}/roadnetwork.osrm`
  ], {}, `${LOG_DIR}/osm-contract-logs/${processId}.log`);
  tEnd(`[IGNORE WAYS] ${processId} osm-contract`)();

  // Speed profile file is no longer needed.
  fs.remove(speedProfileFile);
}
