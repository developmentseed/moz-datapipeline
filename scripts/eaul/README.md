# EAUL


## Algorithms
According to the docs:

There are two pre-processing pipelines available:

- Contraction Hierarchies (CH) which best fits use-cases where query performance is key, especially for large distance matrices
- Multi-Level Dijkstra (MLD) which best fits use-cases where query performance still needs to be very good; and live-updates to the data need to be made e.g. for regular Traffic updates

### Contraction Hierarchies (CH)

```
export ROOT_DIR=$(pwd)
mkdir .tmp/osrm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osm-backend5.18-custom osrm-extract -p /data/.tmp/moz.lua /data/.tmp/roadnetwork.osm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osm-backend5.18-custom osrm-contract /data/.tmp/roadnetwork.osrm
mv .tmp/roadnetwork.osrm* .tmp/osrm
```
Speed updates are done with `osrm-contract --segment-speed-file`

### Multi-Level Dijkstra (MLD)

```
export ROOT_DIR=$(pwd)
mkdir .tmp/osrm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osm-backend5.18-custom osrm-extract -p /data/.tmp/moz.lua /data/.tmp/roadnetwork.osm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osm-backend5.18-custom osrm-partition /data/.tmp/roadnetwork.osrm
docker run -t -v $ROOT_DIR/.tmp:/data/.tmp osm-backend5.18-custom osrm-customize /data/.tmp/roadnetwork.osrm
mv .tmp/roadnetwork.osrm* .tmp/osrm
```
Speed updates are done with `osrm-customize --segment-speed-file`.
When using Dijkstra we need to specify the algorithm on `new OSRM({ path, algorithm: 'MLD' })`

#### Benchmark
The MLD is faster to update the graph with new speed values, but th CH is faster for the routing.

Tests so far didn't reveal much difference.
Once we have all the scenarios (Flood and upgrade combinations) run a proper test.
