'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import length from '@turf/length';

import { tStart, tEnd, initLog } from '../utils/logging';
import { round } from '../utils/utils';

/**
 * Include additional properties on the Road Network:
 * - Province the road runs through
 * - Road length
 * - Bridges and culverts
 *
 * Required files:
 * - roadnetwork.geojson
 * - bridges.geojson
 * - prov_boundaries.geojson
 *
 * Usage:
 *  $node ./scripts/additional-props
 *
 */

// //////////////////////////////////////////////////////////
// Config Vars

const SRC_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/additional-props');

const RN_FILE = path.resolve(SRC_DIR, 'roadnetwork.geojson');
const BRIDGE_FILE = path.resolve(SRC_DIR, 'bridges.geojson');
const BOUND_FILES = path.resolve(SRC_DIR, 'prov_boundaries.geojson');
const FLOOD_FILE = path.resolve(SRC_DIR, 'flood-depths-current.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Loading province boundaries');
const provBoundaries = fs.readJsonSync(BOUND_FILES);
clog('Loading bridge and culvert data');
const bridgeData = fs.readJsonSync(BRIDGE_FILE);
clog('Loading flood data');
const floodData = fs.readJsonSync(FLOOD_FILE);

clog('Loading road network');
// rnData will be modified by the functions.
var rnData = fs.readJsonSync(RN_FILE);

function addWayLength (way) {
  // Add length
  way.properties.length = round(length(way));
}

function addWayProvince (way) {
  const { PROVINCE } = way.properties;
  const prov = provBoundaries.features.find(p => p.properties.name.toLowerCase() === PROVINCE.toLowerCase());
  way.properties.provinceIso = prov.properties.iso_3166_2;
}

function addBridgeInfo (way) {
  const wayBridges = bridgeData.features.filter(f => f.properties.roadSegmentID === way.properties.NAME);

  way.properties.bridges = wayBridges
    .map(f => ({
      'type': f.properties.type,
      'length': f.properties.Over_Length
    }));
}

function addFloodInfo (way, floods) {
  const wayFloods = floods[way.properties.NAME];

  // The return periods of the flood data
  const returnPeriods = [ 5, 10, 20, 50, 75, 100, 200, 250, 500, 1000 ];

  way.properties.floods = returnPeriods.map(r => round(wayFloods[r]));
}

function run (rnData, floods) {
  rnData.features.forEach(way => {
    addWayLength(way);
    addWayProvince(way);
    addBridgeInfo(way);
    addFloodInfo(way, floods);
  });

  return rnData;
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(SRC_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    const data = run(rnData, floodData);

    fs.writeJsonSync(RN_FILE, data);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
