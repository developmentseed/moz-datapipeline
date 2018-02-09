const fs = require('fs-extra');
const Promise = require('bluebird');
const nodeCleanup = require('node-cleanup');
const lineSplit = require('@turf/line-split');
const pointWithinPolygon = require('@turf/points-within-polygon')
const bbox = require('@turf/bbox');
const turf = require('@turf/helpers')
const length = require('@turf/length')
const rbush = require('rbush');

// File path for origin/destination pairs.
const POI_FILE = './poverty.geojson';
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
    const wayBbox = bbox(way);

    tStart(`Way ${id} search`)()
    // check which areas intersect with the bbox of the way
    const featsInBbox = tree.search({
      minX: wayBbox[0],
      minY: wayBbox[1],
      maxX: wayBbox[2],
      maxY: wayBbox[3],
    }).map(r => r.feat);
    tEnd(`Way ${id} search`)()

    clog(`Way ${id} intersects with`, featsInBbox.length, 'area bounding boxes.');

    tStart(`Way ${id} weigh indicator`)()

    const wayLength = length(way)

    // Calculate the weighted indicator for this way.
    const weightedIndicator = featsInBbox.reduce((acc, area) => {
      // Split the way by the area polygon. This results in a feature coll of
      // split lines.
      const splitWays = lineSplit(way, area)

      // If splitWays is empty, this means that the way is either fully inside
      // or fully outside the area
      if (!splitWays.features.length) {
        if (pointWithinPolygon(turf.point(way.geometry.coordinates[0]), area).features.length) {
          // If a way is fully within a single area, we don't have to weigh the
          // indicator
          return acc + area.properties.Pov_HeadCn
        } else {
          return acc
        }
      } else {
        // in theory, a way can have multiple separate segments within an area
        return acc + splitWays.features.reduce((accumulator, partialWay) => {
          // check if the middle coordinate of a way is within the area polygon
          const middleCoord = partialWay.geometry.coordinates[Math.floor(partialWay.geometry.coordinates.length / 2)]
          if (pointWithinPolygon(turf.point(middleCoord), area).features.length) {
            // when it does, weigh the indicator by the length of the partial segment
            return accumulator + (length(partialWay) * area.properties.Pov_HeadCn / wayLength)
          } else {
            return accumulator
          }
        }, 0)
      }
    }, 0)

    tEnd(`Way ${id} weigh indicator`)()

    return {
      wayId: way.properties.NAME,
      indicator: weightedIndicator
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