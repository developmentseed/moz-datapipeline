# img-stats

The img-stats.py script takes in an input directory (either local or on s3) of geospatial raster (GeoTIFF) files, along with a GeoJSON file. For each feature in the file stats are calculated across all of the input raster files and output to a CSV file.

Currently only the maximum value is included in the output, although other stats could easily be added.

### Installing img-stats
img-stats requires [python-rasterstats](https://github.com/perrygeo/python-rasterstats) and [pyproj](https://pypi.python.org/pypi/pyproj), along with the GDAL system library. These are all included in the Docker image in this repository, however it could be run separately using the Dockerfile in this directory, if desired.

```
$ docker build . -t imgstats
```

Input files may be local, or located on s3. If on s3 they will be downloaded to a local directory. In both cases you'll want to mount a volume when you run the docker image that contains the GeoJSON file and either the raster files or as a place to store the raster files.

- Create a data directory in this directory containing the GeoJSON file and optionally, data files
- Create a .env file to contain AWS credentials:

```
# .env file
AWS_ACCESS_KEY_ID=XXXXXXX
AWS_SECRET_ACCESS_KEY=XXXXXXXX
```

Then run the docker image which will call the img-stats script.

```
# Print help
$ docker run --env-file .env -v $PWD/data:/work/data -it imgstats -h

usage: img-stats.py [-h] [--aoi AOI] [--path PATH] inputdir

Remote image stats

positional arguments:
  inputdir     Directory containing files (or S3 Bucket/prefix)

optional arguments:
  -h, --help   show this help message and exit
  --aoi AOI    GeoJSON filename (default: None)
  --path PATH  Local path to save files (default: ./)
```

### Running img-stats

Now pass in the directory or s3 URI to a directory of raster files, along with the AOI. If the input directory is on s3, the final stats output file will be uploaded there.

```
$ docker run --env-file .env -v $PWD/data:/work/data -it imgstats s3:/mozambique-road-planning/fluvial-pluvial/current --aoi data/roadnetwork.geojson --path data/
```

The output stats file is named after the AOI. In this case it will be roadnetwork_stats.geojson

