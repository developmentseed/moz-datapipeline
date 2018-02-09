'use strict';
import fs from 'fs-extra';
import Promise from 'bluebird';

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
