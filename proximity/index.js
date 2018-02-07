const fs = require('fs-extra');
const Promise = require('bluebird');
const nodeCleanup = require('node-cleanup');
const buffer = require('@turf/buffer');
const intersect = require('@turf/intersect');
const bbox = require('@turf/bbox');
const rbush = require('rbush');

// File path for origin/destination pairs.
const POI_FILE = 'src/areas.geojson';
// Ways list.
const RN_FILE = '../output/roadnetwork.geojson';

// Store all the logs to write them to a file on exit.
var logData = [];
function clog (...args) {
  logData.push(args.join(' '));
  console.log(...args);
}
// Write logging to file.
nodeCleanup(function (exitCode, signal) {
  fs.writeFileSync(`run/log-${Date.now()}.txt`, logData.join('\n'));
});

clog('Load', POI_FILE);
var poiData = JSON.parse(fs.readFileSync(POI_FILE, 'utf8'));
clog('Load', RN_FILE);
var rnData = JSON.parse(fs.readFileSync(RN_FILE, 'utf8'));
const ways = rnData.features.filter(f => !!f.geometry);

clog('Create rbush tree');

var tree = rbush();
tree.load(poiData.features.map(f => {
  let b = bbox(f);
  return {
    minX: b[0],
    minY: b[1],
    maxX: b[2],
    maxY: b[3],
    feat: f
  }
}));

clog('Create rbush tree... done');

function run () {
  const out = ways.map((way, idx) => {
    const id = `${idx + 1}/${ways.length}`;
    clog(`Handling way ${id}`);
    const wayBuff = buffer(way, 5, { units: 'meters'});
    const wayBbox = bbox(wayBuff);

    tStart(`Way ${id} search`)()
    const featsInBbox = tree.search({
      minX: wayBbox[0],
      minY: wayBbox[1],
      maxX: wayBbox[2],
      maxY: wayBbox[3],
    }).map(r => r.feat);
    tEnd(`Way ${id} search`)()

    clog(`Way ${id}`, featsInBbox.length, 'feats in bbox');

    tStart(`Way ${id} intersect`)()
    const featsIntersect = featsInBbox.reduce((acc, area) => {
      return intersect(wayBuff, area) ? acc.concat(area) : acc;
    }, []);
    tEnd(`Way ${id} intersect`)()

    clog(`Way ${id}`, featsIntersect.length, 'feats intersect');

    return {
      wayId: way.properties.NAME,
      count: featsIntersect.length,
      ag: featsIntersect.reduce((acc, f) => {
        return acc + f.properties.ag_bykm * f.properties.area;
      }, 0)
    }
  });

  jsonToFile('run/proximity.geojson')(out);
}


// /////////////////////////////////////////////////////////////////////////////


function tStart (name) {
  return (data) => {
    console.time(name);
    return Promise.resolve(data);
  };
}

function tEnd (name) {
  return (data) => {
    console.timeEnd(name);
    return Promise.resolve(data);
  };
}

function jsonToFile (name) {
  return (data) => {
    fs.writeFileSync(name, JSON.stringify(data, null, '  '));
    return Promise.resolve(data);
  };
}

function tap (fn) {
  return (data) => {
    const res = fn();
    return res instanceof Promise
      ? res.then(() => data)
      : Promise.resolve(data);
  };
}

Promise.all([
  fs.ensureDir('run')
])
.then(tStart(`Total run time`))
.then(() => {
  run()
})
.then(tEnd(`Total run time`))
.catch(e => {
  console.log('e', e);
  throw e;
})