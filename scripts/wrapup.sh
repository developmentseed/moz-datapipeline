#! /bin/bash

TMP_DIR=/home/moz/.tmp

# Temporary. Will ultimately handle stitching the base road network + indicators together and the conversion to Vector Tiles.
cp $TMP_DIR/roadnetwork* ./output
cp $TMP_DIR/boundaries* ./output