'use strict';
import fetch from 'node-fetch';
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

// Flood depth file contains max flood depths for road segment
// Flood length file contains percent of road flooded
const FLOOD_DEPTH_FILE = path.resolve(SRC_DIR, 'roadnetwork_stats-max.json');
const FLOOD_LENGTH_FILE = path.resolve(SRC_DIR, 'roadnetwork_stats-percent.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Loading province boundaries');
const provBoundaries = fs.readJsonSync(BOUND_FILES);
clog('Loading bridge and culvert data');
const bridgeData = fs.readJsonSync(BRIDGE_FILE);

clog('Loading road network');
// rnData will be modified by the functions.
var rnData = fs.readJsonSync(RN_FILE);

clog('Loading flood data');
const floodDepths = fs.readJsonSync(FLOOD_DEPTH_FILE);
const floodLengths = fs.readJsonSync(FLOOD_LENGTH_FILE);

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

function addFloodInfo (way) {
  const wayFloodDepths = floodDepths[way.properties.NAME];
  const wayFloodLengths = floodLengths[way.properties.NAME];

  // The return periods of the flood data
  const returnPeriods = [ 5, 10, 20, 50, 75, 100, 200, 250, 500, 1000 ];

  way.properties['flood_depths'] = returnPeriods.map(r => round(wayFloodDepths[r]));
  way.properties['flood_lengths'] = returnPeriods.map(r => round(wayFloodLengths[r]));
}

function scaleRUC (way) {
  way.properties.RUC = 5.7762 * way.properties.RUC - 0.0334;
}

function run (rnData, floodDepths, floodLengths) {
  rnData.features.forEach(way => {
    addWayLength(way);
    addWayProvince(way);
    addBridgeInfo(way);
    addFloodInfo(way, floodDepths, floodLengths);
    scaleRUC(way);
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
    const data = run(rnData);

    fs.writeJsonSync(RN_FILE, data);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
