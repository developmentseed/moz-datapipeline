#! /bin/bash

# Convert RN
echo "Converting road network"
python ./libs/ogr2osm/ogr2osm.py .tmp/roadnetwork.shp --split-ways 1 -t ./libs/ogr2osm/default_translation.py -o .tmp/roadnetwork.osm -f --positive-id

# Create ways index
echo "Creating way index"
node scripts/utils/extract-ways.js .tmp/

# Create base OSRM
echo "Running OSRM"
# Copy the profile file to a folder accessible by the docker.
cp scripts/utils/moz.lua .tmp/moz.lua
mkdir .tmp/osrm
# For an explanation about $ROOT_DIR see docker-compose.yml
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osrm/osrm-backend:v5.16.4 osrm-extract -p /data/.tmp/moz.lua /data/.tmp/roadnetwork.osm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osrm/osrm-backend:v5.16.4 osrm-contract /data/.tmp/roadnetwork.osrm
mv .tmp/roadnetwork.osrm* .tmp/osrm

# Run
echo "Calculating criticality"
node scripts/criticality/index.js .tmp/