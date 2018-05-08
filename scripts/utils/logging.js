'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';
import nodeCleanup from 'node-cleanup';

export function initLog (logfilePath) {
  // File stream.
  const logfile = fs.createWriteStream(logfilePath);
  const clog = (...args) => {
    console.log(...args);
    const data = args.reduce((acc, arg) => {
      if (typeof arg === 'object') {
        arg = JSON.stringify(arg, null, '\t');
      }
      return acc + arg + ' ';
    }, '');

    logfile.write(data);
    logfile.write('\n');
  };
  // Close the stream
  nodeCleanup(function (exitCode, signal) {
    logfile.write(`Code: ${exitCode}\n`);
    logfile.end(`Signal ${signal}`);
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
