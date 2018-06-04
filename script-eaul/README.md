# EAUL

The EAUL script is different from the others since it isn't part of the pipeline when it runs. Calculating the EAUL is very computationally expensive, so this was built as a docker container that can run in several machines at once allowing distributed computation.

Information about the script that adds the results back into the road network can be found on the [merge-eaul README.md](../scripts/merge-eaul)

## Running locally
The script can be ran locally without docker. In this case run the node script directly bypassing the `eaul.sh`
Useful during development.
```
node script-eaul/ .tmp/ -l log/eaul -w 21926,22672

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
- Downloads the RN and the OD pairs
- Creates a way index file from the RN
- Creates the OSRM
- Runs the node eaul script
- Uploads the result of each way to S3 as an individual file (in case the eaul script stops midway we won’t lose what was already done)

It expects the files `od.geojson` and `roadnetwork.osm` to be available in the provided `S3_BUCKET` in a folder named `eaul/`

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
