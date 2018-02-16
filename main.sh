bash ./scripts/preparation.sh

node ./scripts/indicator-from-areas/index.js .tmp/district_boundaries.geojson POV_HCR poverty

# bash ./scripts/wrapup.sh