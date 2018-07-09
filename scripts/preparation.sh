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
checkRequiredFile './source/bridges' '*.csv' BRIDGE_FILE
checkRequiredFile './source/province-boundaries' '*.shp' PROVINCE_FILE
checkRequiredFile './source/district-boundaries' '*.shp' DISTRICT_FILE
checkRequiredFile './source/agriculture' '*.shp' AG_FILE
checkRequiredFile './source/od-pairs' '*.shp' OD_FILE
checkRequiredFile './source/od-pairs/' 'traffic_matrix.csv' OD_TRAFFIC_FILE

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
ogr2ogr $TMP_DIR/roadnetwork.shp "$RN_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -f "GeoJSON" $TMP_DIR/roadnetwork.geojson $TMP_DIR/roadnetwork.shp \
  -dialect sqlite \
  -sql "SELECT NAME, ROAD_NAME, ROAD_ID, ROAD_CLASS, SURF_TYPE, PAVE_WIDTH, AVG_COND, PROVINCE, AADT, RUC, geometry \
    FROM roadnetwork \
    WHERE geometry is not null" \
  -nln roadnetwork


###############################################################################
#
# 2. Generate base bridge and culvert data
#
# Ingest a CSV file with bridges and culverts and:
#   - store it in GeoJSON format
#   - perform a cleanup of the fields. Only keep:
#       Over_Length (Number) - length of the bridge. Example: 21.0
#       Num_Spans (Number) - Example: 10
#       Road_ID (String) - ID of the road the bridge/culvert is part of. Example: R0529
#       Mat_Type (String) - material type Example: STEL
#   - add/update the following properties:
#     - make sure Over_Length is a number
#     - add ID of the closest road
#     - add a type (bridge / culvert) based on the name
#     - add length of 7 in case there is no data on length

echo "Prepare bridge data..."

./node_modules/.bin/csv2geojson $BRIDGE_FILE --lat GPS_S --lon GPS_E > $TMP_DIR/bridges.geojson

node ./scripts/prep-bridge $TMP_DIR/bridges.geojson $TMP_DIR/roadnetwork.geojson
# Needed for the vector tiles.
cp $TMP_DIR/bridges.geojson ./output

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


###############################################################################
#
# 5. Prepare agricultural data from the SPAM project (IFPRI)
#

echo "Preparing SPAM data..."

# Write to temp file. This is a separate command so we know the layer name in subsequent ones
ogr2ogr $TMP_DIR/ag.shp "$AG_FILE" \
  -t_srs "EPSG:4326"

ogr2ogr -f "GeoJSON" $TMP_DIR/agriculture.geojson $TMP_DIR/ag.shp \
  -sql "SELECT alloc_key, ag_bykm \
    FROM ag"

# Generate an agriculture shapefile with the polygons centerpoints
ogr2ogr -f "GeoJSON" $TMP_DIR/agriculture-centroid.geojson $TMP_DIR/ag.shp \
  -dialect sqlite \
  -sql "SELECT ST_Centroid(geometry), ag_bykm FROM ag"

# Filter the centroids to the top 20%
node ./scripts/filter-percentile ./.tmp/agriculture-centroid.geojson ./.tmp/agriculture-potential.geojson ag_bykm 80


###############################################################################
#
# 6. Generate OD pair data
#     - convert the OD shapefile to GeoJSON
#     - convert a traffic matrix in CSV format to JSON records
#

echo "Preparing OD data..."

ogr2ogr -f "GeoJSON" $TMP_DIR/od.geojson $OD_FILE
node ./scripts/process-traffic ./source/od-pairs/traffic_matrix.csv
# Od pairs and traffic.json are needed as a output file for the EAUL script.
cp $TMP_DIR/od.geojson ./output/od.geojson
cp $TMP_DIR/traffic.json ./output/traffic.json

echo "All done preparing the OD data."


###############################################################################
#
# 7. Add additional properties to each of the road segments:
#   - bridges - an array with the bridges and culverts of the road
#   - flood_depths - an array with max water levels for the road
#   - flood_lengths - an array with percent of the road flooded
#   - length - length of the road
#   - provinceIso - ISO code of province the roads belongs to
#   - ruc - scale the RUC
#

echo "Add additional properties to road network..."

# Additional properties to be included in the roadnetwork geojson
node ./scripts/additional-props/index.js

echo "All done preparing the base data."

###############################################################################
#
# 8. Converting the geojson to osm xml
#

echo "Converting RN to osm..."
python ./libs/ogr2osm/ogr2osm.py .tmp/roadnetwork.geojson --split-ways 1 -t ./libs/ogr2osm/default_translation.py -o .tmp/roadnetwork.osm -f --positive-id
# OSM Road Network is needed as a output file for the EAUL script.
cp $TMP_DIR/roadnetwork.osm ./output/roadnetwork.osm
