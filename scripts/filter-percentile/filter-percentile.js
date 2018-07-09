'use strict';
import fs from 'fs-extra';
import path from 'path';
import { featureCollection } from '@turf/helpers';

import nodeCleanup from 'node-cleanup';

import { tStart, tEnd } from '../utils/logging';

/**
 * This script filters GeoJSON features by one of the properties and returns
 * those outside a percentile rank. (eg. all features which length is above the
 * 80th percentile).
 */

// This script requires 4 parameters.
const [, , SRC_FILE, TARGET_FILE, PROPERTY, PERCENTILE] = process.argv;

if (!SRC_FILE || !TARGET_FILE || !PROPERTY || !PERCENTILE) {
  console.log(`This script requires four parameters to run:
  1. path to a GeoJSON with input files;
  2. path to store the file with the filtered GeoJSON;
  3. the property on each GeoJSON feature. These need to be numeric. If the property is not present on a feature, 0 is assumed.
  4. the percentile rank to filter by. The script returns everything outside the percentile rank.
  
  Eg. $node ./scripts/filter-percentile .tmp/agriculture.geojson ag_bykm 80`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const LOG_DIR = path.resolve(__dirname, '../../log/filter-percentile');

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

clog('Loading source data');
const data = fs.readJsonSync(SRC_FILE);

/**
 * Calculates the percentile rank
 *
 * @param  {Object} data        GeoJSON FeatureCollection.
 * @param  {String} targetFile  Path of the exported file.
 * @param  {String} property    Property to calculate the percentile on.
 * @param  {Number} percentile  The percentile to filter by.
 *
 * @return Promise{}            Resolves when file was written.
 */
async function run (data, targetFile, property, percentile) {
  // List and sort the values. Assume '0' if the property is undefined.
  let valueList = data.features
    .map(f => f.properties[property] || 0)
    .sort((a, b) => a - b);

  // Determine the percentile value using the nearest-rank method.
  let ordinalRank = Math.round(percentile / 100 * (valueList.length - 1));
  let percentileValue = valueList[ordinalRank];

  // Filter the data and include everything outside the percentile rank
  let filteredFeatures = data.features.filter(f => f.properties[property] >= percentileValue);

  return fs.writeFile(targetFile, JSON.stringify(featureCollection(filteredFeatures)));
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    await run(data, TARGET_FILE, PROPERTY, PERCENTILE);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
