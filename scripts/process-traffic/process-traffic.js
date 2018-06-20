'use strict';
import fs from 'fs-extra';
import path from 'path';
import csv from 'csvtojson';

import {tStart, tEnd, initLog} from '../utils/logging';

/**
 * This script ingests an OD matrix with vehicles/day and transforms it into
 * a JSON with individual records with bi-directional counts.
 *
 * Usage:
 *  $node ./scripts/process-traffic ./source/od-pairs/traffic_matrix.csv
 *
 */

// This script requires 2 parameters.
const [, , TRAFFIC_FILE] = process.argv;

if (!TRAFFIC_FILE) {
  console.log(`This script requires two parameters to run:
  1. a CSV file with OD matrix
  
  Eg. $node ./scripts/prep-bridge ./source/od-pairs/traffic_matrix.csv`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const LOG_DIR = path.resolve(__dirname, '../../log/process-traffic');

const OUTPUT_FILE = path.resolve(OUTPUT_DIR, 'traffic.json');

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

/**
 * Turn CSV file with OD matrix into JSON with individual records.
 *
 * Structure of CSV file:
 *
 * [{
 *   '1': '0',
 *   '2': '120',
 *   from: '1'
 * },
 * { '1': '10',
 *   '2': '0',
 *   from: '2'
 * }]
 *
 * [
 *   {
 *     origin: 1,
 *     destination: 2,
 *     dailyODCount: 120,
 *     reverseODCount: 10
 *   }
 * ]
 *
 * @param  {Array} trafficFile    Path to CSV file with OD matrix
 *
 * @return Promise{}
 */
async function run (trafficFile) {
  return csv()
    .fromFile(trafficFile)
    .then(rows => rows
      .map(origin => Object.keys(origin)
        // Generate an OD object for each destination
        .map(dest => ({
          origin: parseInt(origin.from),
          destination: parseInt(dest),
          dailyODCount: parseInt(origin[dest])
        }))
        // Filter out odPairs without destination
        .filter(odPair => odPair.destination)
      )
      // Flatten the array
      .reduce((a, b) => a.concat(b))
      // Combine same OD & DO in one object
      .reduce((a, b) => {
        // Check if the accumulator already has an object for the reverse
        let match = a.findIndex(o => o.origin === b.destination && o.destination === b.origin);

        if (match === -1) {
          a.push(b);
        } else {
          a[match].reverseODCount = b.dailyODCount;
        }
        return a;
      }, [])
      // No traffic between same origin and destination, can filter these out
      .filter(od => od.origin !== od.destination)
    );
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    const trafficCounts = await run(TRAFFIC_FILE);
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(trafficCounts));
    clog(`Traffic counts generated for ${trafficCounts.length} OD/DO pairs.`);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
