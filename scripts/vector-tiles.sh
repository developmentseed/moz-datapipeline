#! /bin/bash

# Generate vector tiles from the Road Network and upload the to S3.

# Create a bucket
# - Give public read access
# - Enable CORS (Remove comment)

TMP_DIR=./.tmp
OUTPUT_DIR=./output

AWS_BUCKET=$1

if [ -z "$AWS_BUCKET" ]; then
  echo "Bucket name not supplied"
  echo "Usage:"
  echo "  bash vector-tiles.sh [bucket]"
  exit 1
fi

: "${AWS_ACCESS_KEY_ID?Need to set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY?Need to set AWS_SECRET_ACCESS_KEY}"

# Check if the road network geojson exists.
if [ ! -f $OUTPUT_DIR/roadnetwork-indicators.geojson ]; then
  echo 'File roadnetwork-indicators.geojson not found in output directory.'
  exit 1
fi

# Delete destination if it exists
rm -rf $OUTPUT_DIR/roadnetwork-tiles

tippecanoe -e $OUTPUT_DIR/roadnetwork-tiles -l roads $OUTPUT_DIR/roadnetwork-indicators.geojson

aws s3 sync $OUTPUT_DIR/roadnetwork-tiles/ s3://$AWS_BUCKET/ --delete --content-encoding gzip --acl public-read
