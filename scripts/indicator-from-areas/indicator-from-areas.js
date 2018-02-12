'use strict';
const fs = require('fs-extra');
const nodeCleanup = require('node-cleanup');
const lineSplit = require('@turf/line-split');
const pointWithinPolygon = require('@turf/points-within-polygon');
const bbox = require('@turf/bbox');
const turf = require('@turf/helpers');
const length = require('@turf/length');
const rbush = require('rbush');
const csvStringify = require('csv-stringify');

// This script derives indicators for road segments from underlying polygons.
// It requires two files:
//   1. a GeoJSON with polygons that contain indicator data (eg. poverty rate
//      per district)
//   2. a GeoJSON with road network data
//
// For each of the road segments, it checks the polygons it intersects with and
// calculate a weighted average.
//
// Usage:
//  $node ./scripts/indicator-from-areas.js .tmp/district-boundaries.geojson POV_HCR poverty

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

function loadFile (fn) {
  clog('Load', fn);
  return JSON.parse(fs.readFileSync(fn, 'utf8'));
}

function prepTree (data) {
  clog('Create rbush tree');

  var tree = rbush();
  tree.load(data[0].features.map(f => {
    let b = bbox(f);
    return {
      minX: b[0],
      minY: b[1],
      maxX: b[2],
      maxY: b[3],
      feat: f
    };
  }));
  data.push(tree);
  clog('Create rbush tree... done');
  return data;
}

function run (data, indicator) {
  const ways = data[1].features;
  const tree = data[2];

  const out = ways.map((way, idx) => {
    const id = `${idx + 1}/${ways.length}`;
    clog(`Handling way ${id}`);
    const wayBbox = bbox(way);

    tStart(`Way ${id} search`)();
    // Check which areas intersect with the bbox of the way.
    const featsInBbox = tree.search({
      minX: wayBbox[0],
      minY: wayBbox[1],
      maxX: wayBbox[2],
      maxY: wayBbox[3]
    }).map(r => r.feat);
    tEnd(`Way ${id} search`)();

    clog(`Way ${id} intersects with`, featsInBbox.length, 'area bounding boxes.');

    tStart(`Way ${id} weigh indicator`)();

    const wayLength = length(way);

    // Calculate the weighted indicator for this way.
    const weightedIndicator = featsInBbox.reduce((acc, area) => {
      // Split the way by the area polygon. This results in a feature coll of
      // split lines.
      const splitWays = lineSplit(way, area);

      // If splitWays is empty, this means that the way is either fully inside
      // or fully outside the area.
      if (!splitWays.features.length) {
        if (pointWithinPolygon(turf.point(way.geometry.coordinates[0]), area).features.length) {
          // If a way is fully within a single area, we don't have to weigh the
          // indicator.
          return acc + area.properties[indicator];
        } else {
          return acc;
        }
      } else {
        // A way can have multiple separate segments within an area, which is
        // why a second reduce is necessary.
        return acc + splitWays.features.reduce((accumulator, partialWay) => {
          // Get a point between the first and second point of the way.
          // pointWithinPolygon doesn't return points that are on the edge of
          // the polygon, which is why we don't rely on first or last.
          let coords = [
            (partialWay.geometry.coordinates[0][0] + partialWay.geometry.coordinates[1][0]) / 2,
            (partialWay.geometry.coordinates[0][1] + partialWay.geometry.coordinates[1][1]) / 2
          ];

          // Check if the partialWay is within the area polygon.
          if (pointWithinPolygon(turf.point(coords), area).features.length) {
            // Weigh the indicator by the length of the partial segment.
            return accumulator + (length(partialWay) * area.properties[indicator] / wayLength);
          } else {
            return accumulator;
          }
        }, 0);
      }
    }, 0);
    tEnd(`Way ${id} weigh indicator`)();

    return {
      wayId: way.properties.NAME,
      indicator: weightedIndicator
    };
  });

  dataToFile(`.tmp/indicator/${process.argv[4]}.csv`)(out);
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

function dataToFile (name) {
  return (data) => {
    csvStringify(data, {header: true}, function (err, output) {
      fs.writeFileSync(name, output);
    });
    return Promise.resolve(data);
  };
}

// This script requires 3 parameters
if (process.argv.length !== 5) {
  clog(`This script requires three parameters to run:\n
  1. a GeoJSON with polygons; and
  2. the property on each GeoJSON feature that contains the indicator data\n
  3. the name of the indicator that will be used to name the file with results\n
Eg. $node ./scripts/indicator-from-areas.js .tmp/district-boundaries.geojson POV_HCR poverty`);
  process.exit(1);
} else {
  Promise.all([
    fs.ensureDir('run')
  ])
  .then(tStart(`Total run time`))
  .then(() => {
    return Promise.all([
      loadFile(process.argv[2]),
      loadFile('.tmp/roadnetwork.geojson')
    ]);
  })
  .then((data) => prepTree(data))
  .then((data) => run(data, process.argv[3]))
  .then(tEnd(`Total run time`))
  .catch(e => {
    console.log('e', e);
    throw e;
  });
}
