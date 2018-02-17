'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import length from '@turf/length';

import { tStart, tEnd, initLog } from '../utils/logging';

// Include additional properties on the Road Network:
// - Province the road runs through
// - Road length

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/additional-props');

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.geojson');
const BRIDGE_FILE = path.resolve(OUTPUT_DIR, 'bridges.geojson');
const BOUND_FILES = path.resolve(OUTPUT_DIR, 'prov_boundaries.geojson');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Loading province boundaries');
const provBoundaries = fs.readJsonSync(BOUND_FILES);
clog('Loading bridge and culvert data');
const bridgeData = fs.readJsonSync(BRIDGE_FILE);
clog('Loading road network');
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

function addBridgeInfo (way) {
  const wayBridges = bridgeData.features.filter(f => f.properties.roadSegmentID === way.properties.NAME);
  way.properties.bridgeLength = wayBridges
    .filter(f => f.properties.type === 'bridge')
    .reduce((a, b) => {
      a += b.properties.Over_Lengt;
      return a;
    }, 0);

  way.properties.bridgeAmount = wayBridges
    .filter(f => f.properties.type === 'bridge').length;

  way.properties.culvertAmount = wayBridges
    .filter(f => f.properties.type === 'culvert').length;
}

function run (rnData) {
  rnData.features.forEach(way => {
    addWayLength(way);
    addWayProvince(way);
    addBridgeInfo(way);
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
