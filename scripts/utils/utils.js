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
  // If there's a properties object use that, otherwise assume it's root.
  const props = road.properties || road;
  let roadClass = props.ROAD_CLASS.toLowerCase();
  if (roadClass === 'n/a') return 'secondary';
  return roadClass;
}

export function getSurface (road) {
  // If there's a properties object use that, otherwise assume it's root.
  const props = road.properties || road;
  let surfType = props.SURF_TYPE.toLowerCase();
  if (surfType === 'paved' || surfType === 'unpaved') return surfType;
  return 'unpaved';
}

export function getRoadCondition (road) {
  // If there's a properties object use that, otherwise assume it's root.
  const props = road.properties || road;
  let avgCond = props.AVG_COND.toLowerCase();
  if (avgCond === 'very poor' || avgCond === 'n/a') return 'poor';
  return avgCond;
}

/**
 * Creates or updates a speed profile file with all the node pairs of the given
 * ways set to speed.
 *
 * @param  {String} speedProfileFile Path to speed profile.
 * @param  {Array} ways              Ways to write profile for.
 * @param  {number} speed            The speed to set for the node pair.
 * @param  {boolean} append          Whether the data is going to be appended
 *                                   to the file. Used to ensure that a line
 *                                   break is added to the file.
 *
 * @return Promise{}                 Resolves when file was written.
 */
export function createSpeedProfile (speedProfileFile, ways, speed = 0, append = false) {
  return new Promise((resolve, reject) => {
    const opts = append ? {flags: 'a'} : {};
    const file = fs.createWriteStream(speedProfileFile, opts);

    // Check if the file is empty.
    // If it is we don't need to add a new line at the beginning.
    const onOpen = async () => {
      const stats = await fs.fstat(file.fd);
      append = !!stats.size;
      processWays();
    };

    // The stream cannot process data as fast as the for loop prepares it
    // so as soon as the buffer fills up the stream starts tp write into
    // userspace memory. We need to check when file.write() returns false,
    // and listen for the 'drain' event on the stream before continuing to
    // write again in order to prevent all the process's memory from
    // being used up. https://nodejs.org/api/stream.html#stream_event_drain
    const processWays = (startIdx = 0) => {
      // Compute traffic profile.
      // https://github.com/Project-OSRM/osrm-backend/wiki/Traffic
      for (let wIdx = startIdx; wIdx < ways.length; wIdx++) {
        const way = ways[wIdx];
        let contents = '';

        if (wIdx !== 0 || append) { contents += '\n'; }
        for (let i = 0; i < way.nodes.length - 1; i++) {
          // Add line break unless it's first iteration.
          if (i !== 0) { contents += '\n'; }

          const node = way.nodes[i];
          const nextNode = way.nodes[i + 1];
          const rate = speed * 1000;

          contents += `${node},${nextNode},${speed},${rate}\n`;
          contents += `${nextNode},${node},${speed},${rate}`;
        }

        if (!file.write(contents)) {
          file.once('drain', processWays.bind(null, wIdx + 1));
          return;
        }
      }
      file.end();
    };

    file
      .on('open', () => onOpen())
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

  const { TMP_DIR } = opts;
  const speedProfileFile = `${TMP_DIR}/speed-${processId}.csv`;

  tStart(`[IGNORE WAYS] ${processId} traffic profile`)();
  await createSpeedProfile(speedProfileFile, ways);
  tEnd(`[IGNORE WAYS] ${processId} traffic profile`)();

  tStart(`[IGNORE WAYS] ${processId} osm-contract`)();
  await osrmContract(osrmFolder, speedProfileFile, processId, opts);
  tEnd(`[IGNORE WAYS] ${processId} osm-contract`)();

  // Speed profile file is no longer needed.
  fs.remove(speedProfileFile);
}

export async function osrmContract (osrmFolder, speedProfileFile, processId, opts = {}) {
  const { ROOT_DIR, LOG_DIR } = opts;
  const rootPath = path.resolve(__dirname, '../..');
  // The dockerVolMount depends on whether we're running this from another docker
  // container or directly. See docker-compose.yml for an explanantion.
  const dockerVolMount = ROOT_DIR || rootPath;

  // Paths for the files depending from where this is being run.
  const pathOSRM = ROOT_DIR ? osrmFolder.replace(rootPath, ROOT_DIR) : osrmFolder;
  const pathSpeedProf = ROOT_DIR ? speedProfileFile.replace(rootPath, ROOT_DIR) : speedProfileFile;

  await runCmd('docker', [
    'run',
    '--rm',
    '-v', `${dockerVolMount}:${dockerVolMount}`,
    // 'osrm/osrm-backend:v5.16.4',
    'developmentseed/osrm-backend:5.18-b',
    'osrm-contract',
    '--segment-speed-file', pathSpeedProf,
    `${pathOSRM}/roadnetwork.osrm`
  ], {}, `${LOG_DIR}/osm-contract-logs/${processId}.log`);
}

/**
 * Loops over the given array executing the callback for every combination of
 * array values. Example:
 * [1,2,3,4] would result in:
 *   1,2 | 1,3 | 1,4 | 2,3 | 2,4 | 3,4
 * The number of executions is given by:
 *   Array length * (Array length - 1) / 2
 *
 * Returning false from the callback will stop the execution.
 *
 * @param {array} array The array over which to iterate.
 * @param {function} fn Callback function to execute on every iteration.
 *                      Signature is cb(valA:mixed, valB:mixed, idxA:int, idxB:int, all:array)
 */
export async function forEachArrayCombination (array, fn, concurrency = 1) {
  let tasks = [];
  const len = array.length;
  // Build options array.
  for (let aidx = 0; aidx <= len - 2; aidx++) {
    const a = array[aidx];
    for (let bidx = aidx + 1; bidx < len; bidx++) {
      const b = array[bidx];
      tasks.push([a, b, aidx, bidx, array]);
    }
  }

  // Bluebird's Promise.map does not ensure execution order. It starts the
  // "concurrency num" of items from the start of the array, then continues
  // from the end in decreasing order.
  // The following code ensure that the start order of the promise follows
  // the input order. It's mostly useful for debug.
  let a = tasks.slice(0, concurrency);
  let b = tasks.slice(concurrency);
  b.reverse();
  tasks = a.concat(b);

  // Execute
  await Promise.map(tasks, async (args) => {
    const res = await fn(...args);
    // A false return value stops execution.
    if (res === false) throw new Error('stop');
  }, {concurrency})
    .catch(e => {
      // If stop was on purpose do not throw.
      if (e.message !== 'stop') throw e;
    });
}
