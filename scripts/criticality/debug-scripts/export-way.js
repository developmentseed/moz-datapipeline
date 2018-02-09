'use-strict';
const fs = require('fs-extra');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const LOG_DIR = path.resolve(__dirname, '../../log/criticality');

const NODE_INDEX_FILE = path.resolve(OUTPUT_DIR, 'rn-nodes.index.json');
const WAYS_FILE = path.resolve(OUTPUT_DIR, 'roadnetwork-osm-ways.json');

const ways = JSON.parse(fs.readFileSync(WAYS_FILE, 'utf8'));
const nodes = JSON.parse(fs.readFileSync(NODE_INDEX_FILE, 'utf8'));

var [, , wayId] = process.argv;

const way = ways.find(way => way.id === wayId);

writeWayGeoJSON(way);

function writeWayGeoJSON (way) {
  const feat = {
    'type': 'FeatureCollection',
    'features': [
      {
        'type': 'Feature',
        'properties': {},
        'geometry': {
          'type': 'LineString',
          'coordinates': way.nodes.map(wn => {
            const node = nodes[wn];
            return [node.lon, node.lat];
          })
        }
      }
    ]
  };

  fs.writeFileSync(`${LOG_DIR}/way-${way.id}.geojson`, JSON.stringify(feat));
}
