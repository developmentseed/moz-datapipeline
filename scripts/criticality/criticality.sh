#! /bin/bash

# Create ways index
echo "Creating way index"
node scripts/utils/extract-ways.js .tmp/

# Create base OSRM
echo "Running OSRM"
# Copy the profile file to a folder accessible by the docker.
cp scripts/utils/moz.lua .tmp/moz.lua
mkdir .tmp/osrm
# For an explanation about $ROOT_DIR see docker-compose.yml
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp developmentseed/osrm-backend:5.18-b osrm-extract -p /data/.tmp/moz.lua /data/.tmp/roadnetwork.osm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp developmentseed/osrm-backend:5.18-b osrm-contract /data/.tmp/roadnetwork.osrm
mv .tmp/roadnetwork.osrm* .tmp/osrm

# Run
echo "Calculating criticality"
node --max_old_space_size=4096 scripts/criticality/index.js .tmp/