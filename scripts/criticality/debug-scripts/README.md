# Debug scripts for the RN
Not used in production.

# Create node index list (only needed for route.js - debug)
```
node index-nodes.js [input - optional]
```

# Export a way to geojson. (to view in geojson.io)

```
node export-way.js [wayId]
```

The way is exported to the log folder.

# Debug routes

- The `negative-time-[wayId].json`/`max-time-[wayId].json` file, contain the url for the frontend using the origin and destination coordinates.
If needs to be manually constructed use:

```
http://localhost:9966/?loc={LAT}%2C{LON}&loc={LAT}%2C{LON}
```

- Export the way in json format to view it on `http://geojson.io` using the `export-way.js`

- Run the script just for the problematic way to create the osrm files. (Comment the code that removes it)

- Start the frontend docker `docker run -p 9966:9966 osrm/osrm-frontend`

- Start the backend with the base osrm and then with the adapted.

- See the differences opening the url.

# Server and Frontend

docker run -t -i -p 5000:5000 -v $(pwd):/data osrm/osrm-backend:v5.15.0 osrm-routed /data/[osm-file]
docker run -p 9966:9966 osrm/osrm-frontend