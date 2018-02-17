'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import { spawn } from 'child_process';
import bbox from '@turf/bbox';
import rbush from 'rbush';

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
function prepTree (areas, indProperty) {
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
