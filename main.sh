bash ./scripts/preparation.sh

# Add source data for fishery potential to GeoJSON with district boundaries
csvcut -c ZS_ID,ArtFiMean source/p2Mozambique.csv > .tmp/fisheries.csv
cat .tmp/district_boundaries.geojson | ./node_modules/geojson-join/geojson-join --format=csv \
    .tmp/fisheries.csv \
    --againstField=ZS_ID \
    --geojsonField=ZS_ID > .tmp/district_boundaries-fish.geojson

# Calculate fishery potential for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries-fish.geojson ArtFiMean fish-potential

# Calculate poverty rate for each road segment
node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries.geojson POV_HCR poverty

# Attach indicators to RN
node ./scripts/merge-indicators/index.js

bash ./scripts/wrapup.sh