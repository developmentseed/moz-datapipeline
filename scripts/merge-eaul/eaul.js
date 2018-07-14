'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import program from 'commander';

import { tStart, tEnd, jsonToFile, initLog } from '../utils/logging';

/**
 * Adds values from the eaul processing to each way of the road network.
 *
 * Usage:
 *  $node ./scripts/merge-eaul -h
 *
 */

program.version('0.1.0')
  .option('--rn <file>', 'Mandatory. Road network file in geojson format')
  .option('-o <file>', 'Output file. If not provided one will be created in the source dir')
  .option('-l <dir>', 'log directory. If not provided one will be created in the source dir')
  .description('Adds the eaul values to the roadnetwork')
  .usage('[options] <source-dir>')
  .parse(process.argv);

if (program.args.length !== 1 || !program.rn) {
  program.help();
  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const SOURCE_DIR = program.args[0];
const LOG_DIR = program.L || path.resolve(SOURCE_DIR, 'logs');

const RN_FILE = program.rn;
const OUTPUT_RN_FILE = program.O || path.resolve(SOURCE_DIR, 'roadnetwork-eaul.geojson');

// Number of concurrent operations to run.
const CONCURR_OPS = 5;

const clog = initLog(`${LOG_DIR}/log-${Date.now()}.txt`);

// rnData will be modified by the functions.
var rnData = fs.readJsonSync(RN_FILE);

/**
 * Run function.
 */
async function run () {
  var nonExistent = [];
  await Promise.map(rnData.features, async (feature) => {
    const name = feature.properties.NAME;
    let eaulData;
    try {
      eaulData = await fs.readJson(path.resolve(SOURCE_DIR, `result--${name}.json`));
    } catch (e) {
      nonExistent.push(name);
      return;
    }

    for (const key in eaulData.eaul) {
      feature.properties[`eaul-${key}`] = eaulData.eaul[key];
    }
  }, {concurrency: CONCURR_OPS});

  if (nonExistent.length) {
    jsonToFile(`${LOG_DIR}/eaul-merge-not-found.json`)(nonExistent);
    clog(`${nonExistent.length} of ${rnData.features.length} results not found in source folder. Missing written to file.`);
  }

  await fs.writeFile(OUTPUT_RN_FILE, JSON.stringify(rnData));
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();
    await run();
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
