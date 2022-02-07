# Road Planning data pipeline
This repository contains the data pipeline that prepares Vector Tiles for use by the [Road Planning Tool](https://github.com/developmentseed/moz-road-planning).

## Usage
Processing all the information on the pipeline requires multiple steps, which have to run in the order outlined below. Before running any of these steps, copy `.env.example` to a new file in the same folder named: `.env`.
Adjust the values in that file.

### 1. Base road network
Perform basic processing of the Shapefile generated by HIMS, and upload it to S3 so it can be used by subsequent steps of the pipeline.

Run with:

```
mkdir -p ./output
mkdir -p ./.tmp
mkdir -p ./source
docker-compose run --rm moz-datapipeline bash ./scripts/base-network.sh
```

When to run: **only** when road network is updated. If road network is not updated, go to step 3.

### 2. Flood calculation
The calculation of flood depths is a lengthy process that involves high volumes of data transfer. Since it only needs to run when the road network is updated, it's not part of the main processing script.

Run with:
```
```

When to run: **only** when road network is updated.

### 3. Preparation
This prepares the source data for use by the rest of the pipeline.

Run with:
```
docker-compose run --rm moz-datapipeline bash ./scripts/preparation.sh
```

When to run: when any of the following source datasets changes:

- road network
- bridges
- OD pairs
- traffic
- boundaries (district and province)
- agriculture potential

If the road network changed, make sure to run step 1 & 2 before running this step.

### 4. Script EAUL
Calculating the EAUL is computationally expensive, so this was built as a docker container that can run in several machines at once allowing distributed computation.
For this same reason it requires some files to be uploaded to a S3 bucket.
- OD pairs - `od.geojson`
- Road network in osm xml - `roadnetwork.osm`
- Traffic data - `traffic.json`

See the [EAUL script README.md](./scripts/eaul/README.md) for more information.

When to run: **only** when one of the input datasets changes (road network, OD and traffic). Make sure to run step 3 first.

### 5. Indicator pipeline
This script computes the prioritization indicators and generates the final Vector Tiles used by the application.
The vector tiles script uses the Road Network and the Bridges on the S3 folder and uploads the resulting vector tiles to the S3 bucket.

Run with:
```
docker-compose run --rm moz-datapipeline bash ./scripts/indicators.sh
```

When to run: when any of the source data changes. In that case, make sure to run the previous steps first.

-----

## Repository structure

- `/scripts` contains the scripts needed to produce the final Vector Tiles
- `/source` contains the input data for the pipeline

## Calculating indicators
The scripts to calculate the different indicators (poverty rate, agriculture potential, etc) are stored in the `/scripts` folder. The data pipeline is not opinionated about what language to use and depending on the indicator being calculated, scripts may be written in `node`, `python`, or `bash`. When developing new scripts, please use the following guidelines:

- the input data for the scripts is stored in the `./source` folder
- a script writes the final indicator to a CSV file in the `./.tmp` folder. The requirements for these files are:  
  - the file has to contain two columns: `way_id` and `score`, and can contain an optional `value`. Additional columns are ignored by the data pipeline.
  - the value for `score` should be on a scale from 0 - 100.
  - each file contains the score and value for one indicator. If the script calculates multiple indicators for each road segment, these need to be stored in separate files.
  - the CSV file needs to be named after the indicator. The data pipeline will use the basename of the CSV file (without extension) as the name of the attribute in the final Vector Tiles
- temporary data can be written to the `./.tmp` folder. This will be created on start of the data pipeline.
- individual scripts may fail, but should not fail the full pipeline. If a script fails, print a friendly error message to the user so they understand which indicator is not present in the final dataset.
