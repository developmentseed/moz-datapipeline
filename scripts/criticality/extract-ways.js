'use strict';
const fs = require('fs-extra');
const path = require('path');
const Osm2Obj = require('osm2obj');
const through = require('through2');

/**
 * Extract they ways from the roadnetwork osm and store them as a
 * json array. This will be used by the criticality script to look over
 * the ways to remove.
 *
 * Usage:
 *  $node ./scripts/criticality/extract-ways [source-dir]
 *
 */

// This script requires 1 parameters.
const [, , OUTPUT_DIR] = process.argv;

if (!OUTPUT_DIR) {
  console.log(`This script requires one parameters to run:
  1. Directory where the source files are.

  Required files:
  - roadnetwork.osm

  The resulting ways index will be saves as roadnetwork-osm-ways.json.
  
  Eg. $node ./scripts/criticality/extract-ways .tmp/`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.osm');
const OUTPUT_WAYS = path.resolve(OUTPUT_DIR, 'roadnetwork-osm-ways.json');

const rnFile = fs.createReadStream(RN_FILE);
const waysFile = fs.createWriteStream(OUTPUT_WAYS);

let start = true;
function write (row, enc, next) {
  if (!start) {
    this.push(',\n');
  } else {
    start = false;
  }
  next(null, JSON.stringify(row));
}

function end (next) {
  next(null, ']\n');
}

const stream = new Osm2Obj({ types: ['way'] });
const wayExtract = through.obj(write, end);
wayExtract.push('[');

rnFile
  .pipe(stream)
  .pipe(wayExtract)
  .pipe(waysFile);
