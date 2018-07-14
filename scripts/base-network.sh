#! /bin/bash
# Perform basic processing of the road network and upload it to S3

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

# Check if a required file exists and assign the full path to a variable.
#
# Parameters:
#   1. directory
#   2. pattern for filename, can have wildcards. In case multiple files match a pattern, only the first file is returned
#   3. variable name to assign the full path to
#
# Example:
#   checkRequiredFile './source/road-network' '*.shp' RN_FILE

function checkRequiredFile() {
  # Check if the source directory exists
  if [ ! -d "$1" ]; then
    echo 'The folder '$1' does not exist. Check the documentation to know more about the datasets required to run this script.'
    exit
  fi
  
  # Check if a file exists that matches the pattern and assign it to the variable
  # http://www.linuxjournal.com/content/return-values-bash-functions
  local __localvar=$3
  local firstFile=$(find $1 -name $2 | head -n 1)
  eval $__localvar="'$firstFile'"

  # Check if a file with valid filename was found in the directory
  if [ -z $firstFile ]; then
    echo 'The folder '$1' does not contain a file that matches '$2'. Check the documentation to know more about the datasets required to run this script.'
    exit
  fi
}


###############################################################################
#
# 0. Basic housekeeping

echo 'Basic housekeeping...'

# Check for required files and directories
checkRequiredFile './source/road-network' '*.shp' RN_FILE

# Set up or clean the temp directory
if [ -d "$TMP_DIR" ]; then
  rm -rf $TMP_DIR/*
fi
mkdir $TMP_DIR


###############################################################################
#
# 1. Generate base road network data
# 
# Ingest the ANE road network data and perform:
#   - a cleanup of the fields. Only keep:
#       NAME (String) - unique id of the road segment. Example: R850-T2150
#       ROAD_NAME (String) - name of the road. Example: Combomune -- Macandze
#       ROAD_ID (String) - id of the road the segment belongs to. Example: R850
#       ROAD_CLASS (String) - Example: Vicinal
#       SURF_TYPE (String) - Example: Unpaved
#       PAVE_WIDTH (String) - Example: 3.5m
#       AVG_COND (String) - Example: Fair
#       PROVINCE (String) - Example: Gaza
#       AADT (Real) - average annual daily traffic Example: 70.000000
#       RUC (Real) - Road User Cost per kilometer. Example: 0.112476
#   - remove features that have no geometry
#   - reproject to EPSG:4326
#   - store it in GeoJSON format

echo "Prepare road network data..."

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/basenetwork.shp "$RN_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -f "GeoJSON" $TMP_DIR/basenetwork.geojson $TMP_DIR/basenetwork.shp \
  -dialect sqlite \
  -sql "SELECT NAME, ROAD_NAME, ROAD_ID, ROAD_CLASS, SURF_TYPE, PAVE_WIDTH, AVG_COND, PROVINCE, AADT, RUC, geometry \
    FROM basenetwork \
    WHERE geometry is not null" \
  -nln basenetwork


###############################################################################
#
# 2. Upload road network data to S3
#
# Create a bucket
# - Give public read access

echo "Upload data to S3..."

aws s3 cp $TMP_DIR/basenetwork.geojson s3://$AWS_BUCKET/base_data/ --content-encoding gzip --acl public-read
