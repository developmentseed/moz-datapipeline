# EAUL
This is the part of the eaul script that handles the results.
It downloads the results of the processing from S3 and adds the values to the road network.
See the [EAUL readme](../../scripts/eaul) for more information about how the processing works.

It expects the following env variables:
- `AWS_BUCKET` - Bucket from where to download and upload files
- `AWS_ACCESS_KEY_ID` - Aws access key
- `AWS_SECRET_ACCESS_KEY` - Aws access secret
