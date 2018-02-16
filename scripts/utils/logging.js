'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import nodeCleanup from 'node-cleanup';

export function initLog (logfile) {
  // Store all the logs to write them to a file on exit.
  var logData = [];
  const clog = (...args) => {
    logData.push(args.join(' '));
    console.log(...args);
  };
  // Write logging to file.
  nodeCleanup(function (exitCode, signal) {
    fs.writeFileSync(logfile, logData.join('\n'));
  });

  return clog;
}

export function tStart (name) {
  return (data) => {
    console.time(name);
    return Promise.resolve(data);
  };
}

export function tEnd (name) {
  return (data) => {
    console.timeEnd(name);
    return Promise.resolve(data);
  };
}

export function jsonToFile (name) {
  return (data) => {
    fs.writeFileSync(name, JSON.stringify(data, null, '  '));
    return Promise.resolve(data);
  };
}
