bash ./scripts/preparation.sh

# Add source data for fishery potential to GeoJSON with district boundaries
csvcut -c ZS_ID,ArtFiMean source/p2Mozambique.csv > .tmp/fisheries.csv
cat .tmp/district_boundaries.geojson | geojson-join --format=csv \
    .tmp/fisheries.csv \
    --againstField=ZS_ID \
    --geojsonField=ZS_ID > .tmp/district_boundaries-fish.geojson

# Calculate fishery potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries-fish.geojson ArtFiMean fisheries-potential

# Calculate poverty rate for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries.geojson POV_HCR poverty

bash ./scripts/wrapup.sh