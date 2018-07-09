#! /bin/bash

# Expects some env variables to be set:
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

# Generate vector tiles from the Road Network and upload the to S3.

# Create a bucket
# - Give public read access
# - Enable CORS (Remove comment)

TMP_DIR=./.tmp

aws s3 cp s3://$AWS_BUCKET/base_data/roadnetwork_with-ind.geojson $TMP_DIR/
aws s3 cp s3://$AWS_BUCKET/base_data/bridges.geojson $TMP_DIR/

# Delete destination if it exists
rm -rf $TMP_DIR/roadnetwork-tiles

tippecanoe -e $TMP_DIR/roadnetwork-tiles -B 8 -z 13 -L roads:$TMP/roadnetwork_with-ind.geojson -L bridges:$TMP_DIR/bridges.geojson

aws s3 sync $TMP_DIR/roadnetwork-tiles/ s3://$AWS_BUCKET/tiles/ --delete --content-encoding gzip --acl public-read
