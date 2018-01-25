#! /bin/bash
# This script performs basic housekeeping and prepares the base data used by
# the scripts that calculate the indicators.

TMP_DIR=./.tmp

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

# Check for required files and directories
checkRequiredFile './source/road-network' '*.shp' RN_FILE
checkRequiredFile './source/admin-boundaries' '*.shp' AA_FILE

# Set up or clean the temp directory
if [ -d "$TMP_DIR" ]; then
  rm -rf $TMP_DIR
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
#       START_LOC (String) - Example: Fr. Mabalane
#       STA_POINT (String) - Example: Fr. Mabalane
#       END_LOC (String) - Example: Dindiza
#       END_POINT (String) - Example: Crz. R850/R441
#       ROAD_CLASS (String) - Example: Vicinal
#       SURF_TYPE (String) - Example: Unpaved
#       PAVE_WIDTH (String) - Example: 3.5m
#       AVG_COND (String) - Example: Fair
#       DISTRICT (String) - Example: Chigubo
#       PROVINCE (String) - Example: Gaza
#       AADT (Real) - average annual daily traffic Example: 70.000000
#   - reproject to EPSG:4326

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/roadnetwork.shp "$RN_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -overwrite $TMP_DIR/roadnetwork.shp $TMP_DIR/roadnetwork.shp \
  -sql "SELECT NAME, ROAD_NAME, START_LOC, STA_POINT, END_LOC, END_POINT, ROAD_CLASS, SURF_TYPE, PAVE_WIDTH, AVG_COND, DISTRICT, PROVINCE, AADT FROM roadnetwork" \
  -nln roadnetwork


###############################################################################
#
# 2. Generate base admin boundary data
#

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/boundaries.shp "$AA_FILE" \
  -t_srs "EPSG:4326"

# Filter features and fields
ogr2ogr -overwrite $TMP_DIR/boundaries.shp $TMP_DIR/boundaries.shp \
  -sql "SELECT \
    name, iso_3166_2, iso_a2, type \
    FROM boundaries \
    WHERE iso_a2='MZ'" \
  -nln boundaries

# Make sure the Maputo City (MZ-MPM) has the same ISO as the province (MZ-L)
ogrinfo boundaries.shp \
  -dialect sqlite -sql "UPDATE boundaries \
    SET iso_3166_2='MZ-L' \
    WHERE iso_3166_2='MZ-MPM'" \
  >/dev/null

# Merge Maputo the city and Maputo the province into one polygon
ogr2ogr -overwrite $TMP_DIR/boundaries.shp $TMP_DIR/boundaries.shp \
  -dialect sqlite -sql "SELECT ST_union(Geometry),* FROM boundaries GROUP BY iso_3166_2" \
  -nln boundaries
