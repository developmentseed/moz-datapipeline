'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';

import { dataToCSV } from '../utils/utils';
import { tStart, tEnd, initLog } from '../utils/logging';

/**
 * This script normalizes an indicator from the road network file
 *
 * It requires the GeoJSON with road network data - hardcoded
 *
 *
 * Usage:
 *  $node ./scripts/indicator-from-prop.js AADT
 *
 */

// This script requires 1 parameters.
const [, , PROPERTY] = process.argv;

if (!PROPERTY) {
  console.log(`This script requires one parameter to run:
  1. the property of the road segment to generate the normalized score from
  
  Eg. $ node ./scripts/indicator-from-prop.js AADT`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const TMP_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/indicator-from-prop');

const indName = `${PROPERTY.toLowerCase()}`;

const RN_FILE = path.resolve(TMP_DIR, 'roadnetwork.geojson');
const OUTPUT_INDICATOR_FILE = path.resolve(TMP_DIR, `indicator-${indName}.csv`);

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

clog('Loading Road Network');
const ways = fs.readJsonSync(RN_FILE).features;

/**
 * Generate a normalized score for a property on each way
 *
 * @param  {Array} ways         Road network ways.
 * @param  {String} indProperty Property to get value from.
 *
 * @return Promise{}            Resolves when file was written.
 */
async function run (ways, indProperty) {
  const maxScore = Math.max(...ways.map(way => way.properties[indProperty]));

  const waysScore = ways.map(way => ({
    way_id: way.properties.NAME,
    value: way.properties[indProperty],
    score: Math.round(way.properties[indProperty] / maxScore * 100)
  }));

  const csv = await dataToCSV(waysScore);
  return fs.writeFile(OUTPUT_INDICATOR_FILE, csv);
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(TMP_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();

    await run(ways, PROPERTY);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
