#! /bin/bash

# Expects some env variables to be set:
# S3_BUCKET
# AWS_ACCESS_KEY_ID
# AWS_SECRET_ACCESS_KEY

CONTROL=true
ENV_VARS="S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY"

for v in $ENV_VARS; do
  if [ -z ${!v} ]; then
      echo "Missing env variable: $v"
      CONTROL=false
  fi
done

if [ "$CONTROL" = false ]; then
 exit 1
fi

mkdir .tmp/eaul-results

# Download RN and OD pairs
echo "Download results"
aws s3 cp s3://$S3_BUCKET/eaul/results/ .tmp/eaul-results --recursive --exclude "*" --include "result-*"

# Merge back into the rn
echo "Merging eaul results"
node scripts/merge-eaul/ .tmp/eaul-results --rn .tmp/roadnetwork.geojson -o .tmp/roadnetwork-indicators.geojson
