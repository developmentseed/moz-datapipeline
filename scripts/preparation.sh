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

echo 'Basic housekeeping...'

# Check for required files and directories
checkRequiredFile './source/road-network' '*.shp' RN_FILE
checkRequiredFile './source/bridges' '*.shp' BRIDGE_FILE
checkRequiredFile './source/province-boundaries' '*.shp' PROVINCE_FILE
checkRequiredFile './source/district-boundaries' '*.shp' DISTRICT_FILE
checkRequiredFile './source/od-pairs' '*.shp' OD_FILE

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
#       ROAD_ID (String) - id of the road the segment belongs to. Example: R850
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
#       RUC (Real) - Road User Cost per kilometer. Example: 0.112476
#   - remove features that have no geometry
#   - reproject to EPSG:4326
#   - store it in GeoJSON format

echo "Prepare road network data..."

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/roadnetwork.shp "$RN_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -f "GeoJSON" $TMP_DIR/roadnetwork.geojson $TMP_DIR/roadnetwork.shp \
  -dialect sqlite \
  -sql "SELECT NAME, ROAD_NAME, ROAD_ID, START_LOC, STA_POINT, END_LOC, END_POINT, ROAD_CLASS, SURF_TYPE, PAVE_WIDTH, AVG_COND, DISTRICT, PROVINCE, AADT, RUC, geometry \
    FROM roadnetwork \
    WHERE geometry is not null" \
  -nln roadnetwork


###############################################################################
#
# 2. Generate base bridge and culvert data
#
# Ingest the Bridge shapefile and:
#   - perform a cleanup of the fields. Only keep:
#       Over_Lengt (Number) - length of the bridge. Example: 21.0
#       Num_Spans (Number) - Example: 10
#       Road_ID (String) - ID of the road the bridge/culvert is part of. Example: R0529
#       Mat_Type (String) - material type Example: STEL
#       Str_Desc (String) - Example: Bailey Bridge
#   - add/update the following properties:
#     - add ID of the closest road
#     - add a type (bridge / culvert) based on the name
#     - add length of 7 in case there is no data on length
#   - reproject to EPSG:4326
#   - store it in GeoJSON format

echo "Prepare bridge data..."

ogr2ogr $TMP_DIR/_bridges.shp "$BRIDGE_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -f "GeoJSON" $TMP_DIR/bridges.geojson $TMP_DIR/_bridges.shp \
  -dialect sqlite \
  -sql "SELECT Over_Lengt, Road_ID, Num_Spans, Clear_Soff, Clear_Widt, Mat_Type, Str_Desc, geometry \
    FROM _bridges" \
  -nln _bridges

node ./scripts/prep-bridge .tmp/bridges.geojson .tmp/roadnetwork.geojson

# clean up the intermediate shapefiles
rm $TMP_DIR/_bridges*


###############################################################################
#
# 3. Generate base boundary data for the provinces. This will mostly be used
# in the frontend for display.
#

echo "Prepare base boundary data for the provinces..."

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/prov_boundaries.shp "$PROVINCE_FILE" \
  -t_srs "EPSG:4326"

# Filter features and fields
ogr2ogr -overwrite $TMP_DIR/prov_boundaries.shp $TMP_DIR/prov_boundaries.shp \
  -sql "SELECT \
    name, iso_3166_2, iso_a2, type \
    FROM prov_boundaries \
    WHERE iso_a2='MZ'" \
  -nln prov_boundaries

# Make sure the Maputo City (MZ-MPM) has the same ISO as the province (MZ-L)
ogrinfo prov_boundaries.shp \
  -dialect sqlite -sql "UPDATE prov_boundaries \
    SET iso_3166_2='MZ-L' \
    WHERE iso_3166_2='MZ-MPM'" \
  >/dev/null

# Merge Maputo the city and Maputo the province into one polygon
ogr2ogr -overwrite $TMP_DIR/prov_boundaries.shp $TMP_DIR/prov_boundaries.shp \
  -dialect sqlite -sql "SELECT ST_union(Geometry),* FROM prov_boundaries GROUP BY iso_3166_2" \
  -nln prov_boundaries

# Create geoJSON of province boundaries
ogr2ogr -f "GeoJSON" $TMP_DIR/prov_boundaries.geojson $TMP_DIR/prov_boundaries.shp


###############################################################################
#
# 4. Generate base boundary data for the districts. This will mostly be used
# to generate the indicators on district level.
#

echo "Prepare base boundary data for the districts..."

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/district_boundaries.shp "$DISTRICT_FILE" \
  -t_srs "EPSG:4326"

# Filter features and fields
ogr2ogr -f "GeoJSON" $TMP_DIR/district_boundaries.geojson $TMP_DIR/district_boundaries.shp \
  -sql "SELECT \
    ZS_ID, SUBDIST, POV_HCR \
    FROM district_boundaries" \
  -nln district_boundaries

echo "All done preparing the base data."


###############################################################################
#
# 5. Generate OD pair data
#

echo "Preparing OD data..."

ogr2ogr -f "GeoJSON" $TMP_DIR/od.geojson $OD_FILE

echo "All done preparing the OD data."


###############################################################################
#
# 6. Add additional properties to each of the road segments:
#   - bridgeAmount - total number of bridges on segment
#   - bridgeLength - length of bridges on segment, in meters
#   - culvertAmount - total number of culverts
#   - length - length of the road
#   - provinceIso - ISO code of province the roads belongs to
#

echo "Add additional properties to road network..."

# Additional properties to be included in the roadnetwork geojson
node ./scripts/additional-props/index.js .tmp/
