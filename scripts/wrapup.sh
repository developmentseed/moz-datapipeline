#! /bin/bash

TMP_DIR=./.tmp

# Temporary. Will ultimately handle stitching the base road network + indicators together and the conversion to Vector Tiles.
cp $TMP_DIR/roadnetwork* ./output
cp $TMP_DIR/prov_boundaries* ./output
cp $TMP_DIR/district_boundaries.geojson ./output
cp $TMP_DIR/indicator* ./output