'use strict';
const fs = require('fs-extra');
const path = require('path');
const Osm2Obj = require('osm2obj');
const through = require('through2');

// Extract they ways from the roadnetwork osm and store them as a
// json array. This will be used by the criticality script to look over
// the ways to remove.

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');

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
