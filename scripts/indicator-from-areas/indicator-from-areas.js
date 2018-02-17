'use strict';
import fs from 'fs-extra';
import path from 'path';
import Promise from 'bluebird';
import nodeCleanup from 'node-cleanup';
import bbox from '@turf/bbox';
import lineSplit from '@turf/line-split';
import pointWithinPolygon from '@turf/points-within-polygon';
import { point } from '@turf/helpers';
import length from '@turf/length';
import csvStringify from 'csv-stringify';

import {prepTree} from '../utils/utils';
import {tStart, tEnd} from '../utils/logging';

/**
 * This script derives indicators for road segments from underlying polygons.
 * It requires two files:
 *   1. a GeoJSON with polygons that contain indicator data (eg. poverty rate
 *      per district) - provided as input
 *   2. a GeoJSON with road network data - hardcoded
 *
 * For each of the road segments, it checks the polygons it intersects with and
 * calculate a weighted average.
 *
 * Usage:
 *  $node ./scripts/indicator-from-areas.js .tmp/district-boundaries.geojson POV_HCR poverty
 *
 */

// This script requires 3 parameters.
const [, , AREAS_FILE, PROPERTY, IND_NAME] = process.argv;

if (!AREAS_FILE || !PROPERTY || !IND_NAME) {
  console.log(`This script requires three parameters to run:
  1. a GeoJSON with polygons; and
  2. the property on each GeoJSON feature that contains the indicator data
  3. the name of the indicator that will be used to name the file with results
  
  Eg. $node ./scripts/indicator-from-areas .tmp/district-boundaries.geojson POV_HCR poverty`);

  process.exit(1);
}

// //////////////////////////////////////////////////////////
// Config Vars

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const LOG_DIR = path.resolve(__dirname, '../../log/indicator-from-areas');

const RN_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork.geojson');
const OUTPUT_INDICATOR_FILE = path.resolve(OUTPUT_DIR, `indicator-${IND_NAME}.csv`);

// Store all the logs to write them to a file on exit.
var logData = [];
function clog (...args) {
  logData.push(args.join(' '));
  console.log(...args);
}
// Write logging to file.
nodeCleanup(function (exitCode, signal) {
  fs.writeFileSync(`${LOG_DIR}/log-${Date.now()}.txt`, logData.join('\n'));
});

clog('Loading Road Network');
const ways = fs.readJsonSync(RN_FILE).features;
clog('Loading Source Data');
const areasData = fs.readJsonSync(AREAS_FILE);

function dataToCSV (data) {
  return new Promise((resolve, reject) => {
    csvStringify(data, {header: true}, (err, output) => {
      if (err) return reject(err);
      return resolve(output);
    });
  });
}

/**
 * Runs the analysis, calculating a weighted score for each way.
 *
 * @param  {Array} ways         Road netowrk ways.
 * @param  {Object} tree        Rbush tree.
 * @param  {String} indProperty Property to get value from.
 *
 * @return Promise{}            Resolves when file was written.
 */
async function run (ways, tree, indProperty) {
  const waysScore = ways.map((way, idx) => {
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
        if (pointWithinPolygon(point(way.geometry.coordinates[0]), area).features.length) {
          // If a way is fully within a single area, we don't have to weigh the
          // indicator.
          return acc + area.properties[indProperty];
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
          if (pointWithinPolygon(point(coords), area).features.length) {
            // Weigh the indicator by the length of the partial segment.
            return accumulator + (length(partialWay) * area.properties[indProperty] / wayLength);
          } else {
            return accumulator;
          }
        }, 0);
      }
    }, 0);
    tEnd(`Way ${id} weigh indicator`)();

    return {
      way_id: way.properties.NAME,
      score: weightedIndicator
    };
  });

  const csv = await dataToCSV(waysScore);
  return fs.writeFile(OUTPUT_INDICATOR_FILE, csv);
}

(async function main () {
  try {
    await Promise.all([
      fs.ensureDir(OUTPUT_DIR),
      fs.ensureDir(LOG_DIR)
    ]);

    tStart(`Total run time`)();

    clog('Create rbush tree');
    const tree = prepTree(areasData, PROPERTY);
    clog('Create rbush tree... done');

    await run(ways, tree, PROPERTY);
    tEnd(`Total run time`)();
  } catch (e) {
    console.log(e);
  }
}());
