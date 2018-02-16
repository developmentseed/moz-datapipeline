'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import nodeCleanup from 'node-cleanup';
import length from '@turf/length';

import { tStart, tEnd } from '../utils/logging';

// Include additional properties on the Road Network:
// - Province the road runs through
// - Road length

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const LOG_DIR = path.resolve(__dirname, '../../log/additional-props');

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.geojson');
const BOUND_FILES = path.resolve(OUTPUT_DIR, 'prov_boundaries.geojson');

// Store all the logs to write them to a file on exit.
var logData = [];
function clog (...args) {
  logData.push(args.join(' '));
  console.log(...args);
}
// Write logging to file.
nodeCleanup(function (exitCode, signal) {
  fs.writeFileSync(`${LOG_DIR}/log-${Date.now()}.txt`, logData.join('\n'));
});

clog('Loading province boundaries');
const provBoundaries = fs.readJsonSync(BOUND_FILES);
clog('Loading Road Network');
// rnData will be modified by the functions.
var rnData = fs.readJsonSync(RN_FILE);

function addWayLength (way) {
  // Add length
  way.properties.length = length(way);
}

function addWayProvince (way) {
  const { PROVINCE } = way.properties;
  const prov = provBoundaries.features.find(p => p.properties.name.toLowerCase() === PROVINCE.toLowerCase());
  way.properties.provinceIso = prov.properties.iso_3166_2;
}

function run (rnData, tree) {
  rnData.features.forEach(way => {
    addWayLength(way);
    addWayProvince(way, tree);
  });

  return rnData;
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    const data = run(rnData);

    fs.writeJsonSync(RN_FILE, data);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
