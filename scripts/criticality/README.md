# Criticality

# Road network in OSM XML format (from root folder)
```
python libs/ogr2osm/ogr2osm.py output/roadnetwork.shp --split-ways 1 -t libs/ogr2osm/default_translation.py -o output/roadnetwork.osm -f
```

## Highway tag and ids (temp)
All ways need a highway tag and a positive id.
```
sed -ie 's/id="-/id="/g' output/roadnetwork.osm
sed -ie 's/ref="-/ref="/g' output/roadnetwork.osm
sed -ie 's/<\/way>/<tag k="highway" v="primary" \/><\/way>/g' output/roadnetwork.osm
```

# Create ways list
```
node extract-ways.js
```

# OD pairs
Get the source data `OD_all_MZ_v1.shp`
Convert to geojson `ogr2ogr -f "GeoJSON" output/od.geojson OD_all_MZ_v1.shp

# OSRM
```
mkdir output/osrm
docker run -t -v $(pwd):/data osrm/osrm-backend:v5.15.0 osrm-extract -p /data/libs/car.lua /data/output/roadnetwork.osm
docker run -t -v $(pwd):/data osrm/osrm-backend:v5.15.0 osrm-contract /data/roadnetwork.osrm
mv roadnetwork.osrm* output/osrm
```

------

# Run
```
node scripts/criticality
```

Use `--max_old_space_size=4096` in case there are memory problems