'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import glob from 'glob';
import csv from 'csvtojson';
import camelcase from 'lodash.camelcase';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../.tmp');
const LOG_DIR = path.resolve(__dirname, '../../log/merge-indicators');

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.geojson');
const OUTPUT_RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork-indicators.geojson');

// Number of concurrent operations to run.
const CONCURR_OPS = 5;

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

// rnData will be modified by the functions.
var rnData = fs.readJsonSync(RN_FILE);

/**
 * Run function.
 */
async function run () {
  const files = await getIndicatorFiles();
  if (!files.length) {
    clog('No indicator files were found. Aborting');
    process.exit(1);
  }

  var i = 0;
  await Promise.map(files, async (file) => {
    clog('start for indicator', `${++i}/${files.length}`, `(${file})`);
    tStart(`Indicator ${file} total`)();
    await attachIndicatorToRN(file);
    tEnd(`Indicator ${file} total`)();
  }, {concurrency: CONCURR_OPS});

  await fs.writeFile(OUTPUT_RN_FILE, JSON.stringify(rnData));
}

/**
 * Gets a list of indicators in the output directory.
 * Files must be named: indicator-[name].csv
 *
 * @return Promise{Array} File paths
 */
function getIndicatorFiles () {
  return new Promise((resolve, reject) => {
    glob(`${OUTPUT_DIR}/indicator-*.csv`, function (err, files) {
      if (err) return reject(err);
      return resolve(files);
    });
  });
}

/**
 * Attaches the indicator value found in the file to the ways of the road
 * network. Modifies the rnData object
 * The property name will be derived from the file name. When the indicator
 * name has dashes it will be camelCased.
 *
 * @param  {String} filePath Path to the indicator.
 * @global {Object} rdData   Road Network
 *
 * @return Promise{} Resolves the promise when done.
 */
function attachIndicatorToRN (filePath) {
  return new Promise((resolve, reject) => {
    const [, indName] = filePath.match(/indicator-(.*).csv/);
    const indId = camelcase(indName);

    const readStream = fs.createReadStream(filePath);
    // Keep a list of visited features to list any missing.
    var visited = [];
    var nonExistent = [];
    csv()
      .fromStream(readStream)
      .on('json', json => {
        let feat = rnData.features.find(f => f.properties.NAME === json.way_id);
        if (!feat) {
          nonExistent.push(json.way_id);
          return;
        }

        feat.properties[indId] = json.score;
        visited.push(json.way_id);
      })
      .on('done', err => {
        if (err) return reject(err);

        clog(filePath, `Found information about ${visited.length}/${rnData.features.length} ways`);

        if (visited.length !== rnData.features.length) {
          // The missing indicators need to be filled with nulls.
          var missing = [];
          rnData.features.forEach(feat => {
            if (visited.indexOf(feat.properties.NAME) === -1) {
              missing.push(feat.properties.NAME);
              feat.properties[indId] = null;
            }
          });
          jsonToFile(`${LOG_DIR}/indicator-${indName}-missing.json`)(missing);
          clog(filePath, 'Missing WAY Ids written to file');
        }

        if (nonExistent.length) {
          jsonToFile(`${LOG_DIR}/indicator-${indName}-not-found.json`)(nonExistent);
          clog(filePath, `${nonExistent.length} WAY Ids not found in RN and written to file.`);
        }

        return resolve();
      });
  });
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    await run();
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
