'use strict';
import fs from 'fs-extra';
import path from 'path';
import { featureCollection } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';

import {tStart, tEnd, initLog} from '../utils/logging';

/**
 * This script checks which way a bridge or culvert belongs to.
 * It requires four inputs:
 *   1. a GeoJSON with points (eg. bridges)
 *   2. a GeoJSON with line data (eg. road segment)
 *
 * Usage:
 *  $node ./scripts/prep-bridge .tmp/bridges.geojson .tmp/roadnetwork.geojson
 *
 */

// This script requires 2 parameters.
const [, , BRIDGE_FILE, RN_FILE] = process.argv;

if (!BRIDGE_FILE || !RN_FILE) {
  console.log(`This script requires two parameters to run:
  1. a GeoJSON with point data for the bridges and culverts;
  2. a GeoJSON with line data for the road network.
  
  Eg. $node ./scripts/prep-bridge .tmp/bridges.geojson .tmp/roadnetwork.geojson`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/prep-bridge');

const OUTPUT_FILE = path.resolve(TMP_DIR, 'bridges.geojson');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Loading point data');
// Load GeoJSON and filter it to point features and clean up the road IDs
const bridgeFeatures = fs.readJsonSync(BRIDGE_FILE).features
  .filter(f => f.geometry.type === 'Point')
  .map(f => {
    // Extract ID of the road from the Link_ID. For example:
    //   N000201:0003.2 -> N2
    //   R100504:0066.2 -> R1005
    let regexRoadId = /([A-Z])0*([1-9][0-9]*)/;
    let matchRoadId = f.properties.Link_ID
      .substring(0,5)
      .match(regexRoadId);
    f.properties.roadID = `${matchRoadId[1]}${matchRoadId[2]}`;

    // Add indication of structure type.
    f.properties.type = f.properties.Des_Type === 'CULV' ? 'culvert' : 'bridge';

    // Remove decimal markers from string and turn Length into a number
    f.properties.Over_Length = Number(f.properties.Over_Length.replace(',', ''))

    // When bridge length is unknown, assume it is 7 meters
    f.properties.Over_Length = f.properties.Over_Length === 0 ? 7 : f.properties.Over_Length;

    return f;
  });

clog('Loading line data');
// Load GeoJSON and filter it to line features
const wayFeatures = fs.readJsonSync(RN_FILE).features
  .filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');

/**
 * Check the road segment that is closest to the bridge / culvert, add the ID
 * of the road segment to the bridge feature, and write the GeoJSON.
 * Since bridges only have a reference to the Road ID (N1) and not the ID of
 * the road segment (N1-T2102), this function relies on @turf/distance to look
 * the closest segment.
 *
 * @param  {Array} bridgeFeatures An array of GeoJSON point features
 * @param  {Array} wayFeatures    An array of GeoJSON line features
 *
 * @return Promise{}              Resolves when file was written.
 */
async function run (bridgeFeatures, wayFeatures) {
  bridgeFeatures.map((bridge, i) => {
    const id = `${i + 1}/${bridgeFeatures.length}`;

    // Check what road segments match the Road ID of the bridge.
    let matchingRoadSegments = wayFeatures.filter(way => way.properties.ROAD_ID === bridge.properties.roadID);

    // Check the closest road segment to the bridge
    tStart(`Check line closest to point ${id}`)();
    if (matchingRoadSegments.length === 1) {
      bridge.properties.roadSegmentID = matchingRoadSegments[0].properties.NAME;
    } else {
      let closest = matchingRoadSegments.reduce((a, b) => {
        let distance = pointToLineDistance(bridge, b);
        if (!a.properties.distance || a.properties.distance > distance) {
          b.properties.distance = distance;
          return b;
        } else {
          return a;
        }
      }, matchingRoadSegments[0]);

      bridge.properties.roadSegmentID = closest.properties.NAME || null;
    }
    tEnd(`Check line closest to point ${id}`)();
    return bridge;
  });

  return fs.writeFile(OUTPUT_FILE, JSON.stringify(featureCollection(bridgeFeatures)));
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(TMP_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    await run(bridgeFeatures, wayFeatures);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
