Proximity script.

> Very much WIP. Will need to be integrated with the rest

Node v6

Modules needed:
```
npm i fs-extra bluebird node-cleanup @turf/buffer @turf/intersect @turf/bbox rbush
```

Road network in geojson format:

- Run the main scrip to get the road-network `docker-compose up`

Data:
Using the data form `spam2005v2r0_production_barl_maiz_pmil_rice_smil_sorg_whea_ocer_ofib_sugc_MOZ.shp`.
- `mkdir  src`
- Convert to geojson `ogr2ogr -f "GeoJSON" src/areas.geojson SRC`.

Run:
node index.js

Output:
Data is output to `run/`