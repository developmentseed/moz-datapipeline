#! /bin/bash
set -e
# This script generates indicator data for the road network, generates Vector
# Tiles and uploads them to S3.

TMP_DIR=./.tmp

# Expects some env variables to be set:
# AWS_BUCKET
# AWS_ACCESS_KEY_ID
# AWS_SECRET_ACCESS_KEY

# Load environment variables set in .env file
export $(grep -v '^#' .env | xargs)

CONTROL=true
ENV_VARS="AWS_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY"

for v in $ENV_VARS; do
  if [ -z "${!v}" ]; then
      echo "Missing env variable: $v"
      CONTROL=false
  fi
done

if [ "$CONTROL" = false ]; then
 exit 1
fi

echo "Download base data from S3..."
aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork.geojson $TMP_DIR
aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork-osm-ways.json $TMP_DIR
aws s3 cp s3://$AWS_BUCKET/base_data/bridges.geojson $TMP_DIR
aws s3 cp s3://$AWS_BUCKET/base_data/agriculture.geojson $TMP_DIR
aws s3 cp s3://$AWS_BUCKET/base_data/agriculture-potential.geojson $TMP_DIR

# Add source data for fishery potential to GeoJSON with district boundaries
csvcut -c ZS_ID,ArtFiMean ./source/p2Mozambique.csv > $TMP_DIR/fisheries.csv
cat $TMP_DIR/district_boundaries.geojson | ./node_modules/geojson-join/geojson-join --format=csv \
    $TMP_DIR/fisheries.csv \
    --againstField=ZS_ID \
    --geojsonField=ZS_ID > $TMP_DIR/district_boundaries-fish.geojson

# Calculate fishery potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries-fish.geojson ArtFiMean fish-potential

# Calculate agriculture potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/agriculture.geojson ag_bykm ag-potential

# Calculate agriculture production for each road segment
# Add source data for agriculture production to GeoJSON with areas from SPAM
cat $TMP_DIR/agriculture.geojson | ./node_modules/geojson-join/geojson-join --format=csv \
    ./source/agriculture/v_all.csv \
    --againstField=ALLOC_KEY \
    --geojsonField=alloc_key > $TMP_DIR/agriculture-production.geojson
node ./scripts/indicator-from-areas/index.js .tmp/agriculture-production.geojson v_all ag-production

# Calculate poverty rate for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries.geojson POV_HCR poverty

# Add normalized AADT score for each segment
node ./scripts/indicator-from-prop/index.js AADT

# Calculate link criticality
bash ./scripts/criticality/criticality.sh

# Calculate the EAD on each segment
node ./scripts/vulnerability

# Backup RN before adding indicators
cp $TMP_DIR/roadnetwork.geojson $TMP_DIR/roadnetwork_no-indi.geojson

# Attach indicators to RN
node ./scripts/merge-indicators/index.js


###############################################################################
#
# Merge the EAUL results. These are stored on S3 in individual files.
#

mkdir .tmp/eaul-results

# Download RN and OD pairs
echo "Download EAUL results from S3"
aws s3 cp s3://$AWS_BUCKET/eaul/results/ $TMP_DIR/eaul-results --recursive --exclude "*" --include "result-*"

# Merge back into the rn
echo "Merging EAUL results"
node ./scripts/merge-eaul/ $TMP_DIR/eaul-results --rn $TMP_DIR/roadnetwork.geojson -o $TMP_DIR/roadnetwork.geojson


###############################################################################
#
# Generate vector tiles from the road network and upload the to S3.
#
# Create a bucket
# - Give public read access
# - Enable CORS (Remove comment)
#

echo "Uploading road network with indicators to S3"
aws s3 cp $TMP_DIR/roadnetwork.geojson s3://$AWS_BUCKET/base_data/roadnetwork_with-ind.geojson --content-encoding gzip --acl public-read

echo "Uploading final vector tiles to S3"
# Delete destination if it exists
rm -rf $TMP_DIR/roadnetwork-tiles

tippecanoe -e $TMP_DIR/roadnetwork-tiles -B 8 -z 13 -L roads:$TMP_DIR/roadnetwork.geojson -L bridges:$TMP_DIR/bridges.geojson

aws s3 sync $TMP_DIR/roadnetwork-tiles/ s3://$AWS_BUCKET/tiles/ --delete --content-encoding gzip --acl public-read
