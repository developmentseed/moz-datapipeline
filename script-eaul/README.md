# EAUL

The EAUL script is different from the others since it isn't part of the pipeline when it runs. Calculating the EAUL is very computationally expensive, so this was built as a docker container that can run in several machines at once allowing distributed computation.

Information about the script that adds the results back into the road network can be found on the [merge-eaul README.md](../scripts/merge-eaul)

## Needed files
The script has some requirements regarding the structure of the files it uses.

**OSRM** - `osrm/roadnetwork.osrm*`  
OSRM files as produced by the `osrm-extract` and `osrm-constract` commands.

**OD Pairs** - `od.geojson`  
Must be a FeatureCollection of points with the following mandatory properties:
- OBJECTID

**Road Network** - `roadnetwork.osm`  
Must be in OSM XML format with positive ids and the following tags:
- length
- NAME
- AVG_COND
- RUC
- SURF_TYPE
- floods
- ROAD_CLASS

**Traffic data** - `traffic.json`  
Traffic data between OD pairs with the following structure:
```
{
  "origin": 1, // Must match the OBJECTID
  "destination": 2, // Must match the OBJECTID
  "dailyODCount": 100,
  "reverseODCount": 100
}
```

## Running locally
The script can be ran locally without docker. In this case run the node script directly bypassing the `eaul.sh`
Useful during development.
```
node script-eaul/ script-eaul/.tmp/ -l log/eaul -w 21926,22672

Usage: script-eaul [options] <source-dir>

  Calculate the eaul for each improvement on the given ways

  Options:

    -V, --version      output the version number
    -l <dir>           log directory. If not provided one will be created in the source dir
    -o <dir>           Results directory. If not provided one will be created in the source dir
    -w, --ways <ways>  Way ids comma separated (10,1,5,13). If none provided the whole list is used.
    -h, --help         output usage information
```

## Running with docker
When the script is ran inside the container it follows these steps:
- Downloads the RN, the OD pairs and traffic information
- Creates a way index file from the RN
- Creates the OSRM
- Runs the node eaul script
- Uploads the result of each way to S3 as an individual file (in case the eaul script stops midway we won’t lose what was already done)

It expects the following files to be available in the provided `S3_BUCKET` in a folder named `eaul/`:
- OD pairs - `od.geojson`
- Road network in osm xml - `roadnetwork.osm`
- Traffic data - `traffic.json`

The docker image expects some env vars to be set:
- `S3_BUCKET` - Bucket from where to download and upload files
- `AWS_ACCESS_KEY_ID` - Aws access key
- `AWS_SECRET_ACCESS_KEY` - Aws access secret
- `ROOT_DIR` - Root directory, usually `$(pwd)`. See below for an explanation.
- `WAY_IDS` - Way ids to process. Used to divide the processing into chunks.

Example run code:
```
docker run -it --rm \
  -v $(pwd)/script-eaul/.tmp:/var/pipeline/.tmp \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e S3_BUCKET=mozambique-road-planning \
  -e AWS_ACCESS_KEY_ID='code here' \
  -e AWS_SECRET_ACCESS_KEY='secret here' \
  -e ROOT_DIR=$(pwd)/script-eaul \
  -e WAY_IDS=21926,22672 \
  moz-eaul
```

The results will be uploaded to the provided s3 bucket under `eaul/results/`. This folder will also include a file with the unroutable pairs found during the processing.

## Building the image
To build the image we need to use the Dockerfile in `script-eaul/`, but it has to be built with the global context because it needs files that are in the root directory.

```
docker build -t moz-eaul -f script-eaul/Dockerfile .
```

#### ROOT_DIR (explanation)
When running docker in docker the volume bindings in the inner docker are always relative to the root because we're using the same socket.
Because of this whenever we need to access one of the root volumes, we need to use the full path. Since this is not naturally available inside the container we need to pass a variable.
This is basically the path to where the `.tmp` volume bind is.
If the volume bind is `$(pwd)/script-eaul/.tmp:/var/pipeline/.tmp` then `ROOT_DIR` will be `$(pwd)/script-eaul`.
