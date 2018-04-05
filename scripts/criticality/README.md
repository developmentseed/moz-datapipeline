# Criticality

Requirements:
- output/roadnetwork.shp
- output/od.geojson

To generate these files, run the `main.sh` script.

# Road network in OSM XML format (from root folder)
```
python libs/ogr2osm/ogr2osm.py output/roadnetwork.shp --split-ways 1 -t libs/ogr2osm/default_translation.py -o output/roadnetwork.osm -f --positive-id
```

# Create ways list
```
node scripts/criticality/extract-ways.js
```

# OSRM
```
mkdir output/osrm
docker run -t -v $(pwd):/data osrm/osrm-backend:v5.16.4 osrm-extract -p /data/scripts/criticality/moz.lua /data/output/roadnetwork.osm
docker run -t -v $(pwd):/data osrm/osrm-backend:v5.16.4 osrm-contract /data/output/roadnetwork.osrm
mv output/roadnetwork.osrm* output/osrm
```

# Run
```
node scripts/criticality
```

Use `--max_old_space_size=4096` in case there are memory problems