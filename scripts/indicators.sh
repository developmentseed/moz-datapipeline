#! /bin/bash
set -e

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

echo "Download road network data from S3..."
aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork.geojson $TMP_DIR/roadnetwork.geojson

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
# bash scripts/criticality/criticality.sh

# Backup RN before adding indicators
cp $TMP_DIR/roadnetwork.geojson $TMP_DIR/roadnetwork_no-indi.geojson

# Attach indicators to RN
node ./scripts/merge-indicators/index.js

# Copy RN to output folder
cp $TMP_DIR/roadnetwork.geojson ./output/roadnetwork.geojson

# Upload RN to S3
echo "Uploading road network with indicators to S3"
aws s3 cp $TMP_DIR/roadnetwork.geojson s3://$AWS_BUCKET/base_data/roadnetwork_with-ind.geojson --content-encoding gzip --acl public-read
