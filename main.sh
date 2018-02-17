TMP_DIR=./.tmp

bash ./scripts/preparation.sh

# Add source data for fishery potential to GeoJSON with district boundaries
csvcut -c ZS_ID,ArtFiMean ./source/p2Mozambique.csv > $TMP_DIR/fisheries.csv
cat $TMP_DIR/district_boundaries.geojson | ./node_modules/geojson-join/geojson-join --format=csv \
    $TMP_DIR/fisheries.csv \
    --againstField=ZS_ID \
    --geojsonField=ZS_ID > $TMP_DIR/district_boundaries-fish.geojson

# Calculate fishery potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries-fish.geojson ArtFiMean fish-potential

# Calculate agriculture potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/agriculture.geojson ag_bykm agriculture-potential

# Calculate agriculture production for each road segment
# Add source data for agriculture production to GeoJSON with areas from SPAM
cat $TMP_DIR/agriculture.geojson | ./node_modules/geojson-join/geojson-join --format=csv \
    ./source/agriculture/v_all.csv \
    --againstField=ALLOC_KEY \
    --geojsonField=alloc_key > $TMP_DIR/agriculture-production.geojson
node ./scripts/indicator-from-areas/index.js .tmp/agriculture-production.geojson v_all agriculture-production

# Calculate poverty rate for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries.geojson POV_HCR poverty

bash ./scripts/wrapup.sh