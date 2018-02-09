'use strict';
const fs = require('fs-extra');
const path = require('path');
const Osm2Obj = require('osm2obj');
const through = require('through2');

const OUTPUT_DIR = path.resolve(__dirname, '../../../output');

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.osm');
const NODE_INDEX_FILE = path.resolve(OUTPUT_DIR, 'rn-nodes.index.json');

var [, , input] = process.argv;

// Defaults.
input = input || RN_FILE;

const rnFile = fs.createReadStream(input);
const waysFile = fs.createWriteStream(NODE_INDEX_FILE);

let start = true;
function write (row, enc, next) {
  if (!start) {
    this.push(',\n');
  } else {
    start = false;
  }
  this.push(`"${row.id}": `);
  next(null, JSON.stringify(row, null, 2));
}

function end (next) {
  next(null, '}\n');
}

const stream = new Osm2Obj({ types: ['node'] });

const wayExtract = through.obj(write, end);
wayExtract.push('{\n');

rnFile
  .pipe(stream)
  .pipe(wayExtract)
  .pipe(waysFile);
