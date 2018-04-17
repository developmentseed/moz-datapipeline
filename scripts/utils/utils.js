'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import { spawn } from 'child_process';
import bbox from '@turf/bbox';
import rbush from 'rbush';
import csvStringify from 'csv-stringify';
import csvParse from 'csv-parse';

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
 * Parses csv file into an array of objects (row)
 *
 * @param  {Object} data       CSV data to parse. Keys will be derived from
                               column names.
 * @return {Promise}           Parsed CSV
 */
export function dataFromCSV (data) {
  return new Promise((resolve, reject) => {
    csvParse(data, {columns: true}, (err, output) => {
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
  return data.map(w => ({ ...w, score: w.value / maxValue * 100 }));
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
