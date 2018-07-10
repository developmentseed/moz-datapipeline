#! /bin/bash

# Expects some env variables to be set:
# AWS_BUCKET
# AWS_ACCESS_KEY_ID
# AWS_SECRET_ACCESS_KEY
# WAY_IDS
# ROOT_DIR

# Load environment variables set in .env file
export $(grep -v '^#' .env | xargs)

CONTROL=true
ENV_VARS="AWS_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY WAY_IDS ROOT_DIR"

for v in $ENV_VARS; do
  if [ -z "${!v}" ]; then
      echo "Missing env variable: $v"
      CONTROL=false
  fi
done

if [ "$CONTROL" = false ]; then
 exit 1
fi

# Clean and go into the workdir
# It has to be a mounted volume.
rm -rf /var/pipeline/.tmp/*
cd /var/pipeline/.tmp

# Download RN and OD pairs
echo "Download OD pairs file"
aws s3 cp s3://$AWS_BUCKET/base_data/od.geojson od.geojson

echo "Download RN file"
aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork.osm roadnetwork.osm

echo "Download file traffic information"
aws s3 cp s3://$AWS_BUCKET/base_data/traffic.json traffic.json

echo "Download OSM Ways file"
aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork-osm-ways.json roadnetwork-osm-ways.json

# Create base OSRM
echo "Running OSRM"
# Copy the profile file to a folder accessible by the docker.
cp /var/pipeline/scripts/utils/moz.lua /var/pipeline/.tmp
mkdir osrm
# For an explanation about $ROOT_DIR see docker-compose.yml
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp developmentseed/osrm-backend:5.18-b osrm-extract -p /data/.tmp/moz.lua /data/.tmp/roadnetwork.osm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp developmentseed/osrm-backend:5.18-b osrm-contract /data/.tmp/roadnetwork.osrm
mv roadnetwork.osrm* ./osrm

# Running eaul
echo "Calc eaul"
node --max_old_space_size=4096 /var/pipeline/scripts/eaul/ /var/pipeline/.tmp -o /var/pipeline/.tmp/results --ways $WAY_IDS

# Upload results
echo "Upload results"
aws s3 sync /var/pipeline/.tmp/results/ s3://$AWS_BUCKET/eaul/results/ --delete
