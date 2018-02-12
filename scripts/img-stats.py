#!/usr/bin/env python
import os
import sys
import argparse
import boto3
from pyproj import Proj, transform
from copy import deepcopy
import rasterio
from rasterstats import zonal_stats
import json
import glob


def uri_parser(uri):
    """ Split S3 URI into bucket, key, filename """
    if uri[0:5] != 's3://':
        raise Exception('Invalid S3 uri %s' % uri)

    uri_obj = uri.replace('s3://', '').split('/')

    return {
        'bucket': uri_obj[0],
        'key': '/'.join(uri_obj[1:]),
        'filename': uri_obj[-1]
    }


def mkdirp(path):
    """ Recursively make directory """
    if not os.path.isdir(path):
        os.makedirs(path)
    return path


def copy_files(filenames, path='/tmp'):
    """ Copy files from s3 to local storage """
    fnames = filenames
    s3 = boto3.client('s3')
    fnames = []
    for f in filenames:
        if f[0:5] != 's3://':
            continue
        uri = uri_parser(f)
        fout = os.path.join(path, uri['key'])
        mkdirp(os.path.dirname(fout))
        if not os.path.exists(fout):
            print('downloading %s' % f)
            s3.download_file(uri['bucket'], uri['key'], fout)
        fnames.append(fout)
    return fnames


def s3_list(uri):
    """ Get list of objects within bucket and path """
    s3 = boto3.client('s3')
    s3_uri = uri_parser(uri)
    response = s3.list_objects_v2(Bucket=s3_uri['bucket'], Prefix=s3_uri['key'])

    filenames = []
    if 'Contents' in response.keys():
        for file in response['Contents']:
            filenames.append(os.path.join('s3://%s' % s3_uri['bucket'], file['Key']))
    return filenames


def convert_coordinates(coords, origin, dst):
    """ Convert coordinates from one crs to another """
    if isinstance(coords, list) or isinstance(coords, tuple):
        try:
            if isinstance(coords[0], list) or isinstance(coords[0], tuple):
                return [convert_coordinates(list(c), origin, dst) for c in coords]
            elif isinstance(coords[0], float):
                c = list(transform(origin, dst, *coords))
                return c

        except IndexError:
            pass

    return None


def get_stats(filenames, geom):
    """ Get stats under the geom from all of these files """
    stats = []
    origin = Proj(init='epsg:4326')
    _geojson = deepcopy(geom)

    origin_coords = geom['coordinates']

    for f in filenames:
        # convert polygon to image srs
        with rasterio.open(f) as src:
            dst = Proj(src.crs)
        _geojson['coordinates'] = convert_coordinates(origin_coords, origin, dst)

        # write to temporary geojson file
        pfilename = '/tmp/poly.geojson'
        with open(pfilename, 'w') as poly_f:
            poly_f.write(json.dumps(_geojson))

        # calculate stats
        stats.append(zonal_stats(pfilename, f, stats="count min mean max", nodata=-9999)[0])
    return stats


def find_files(inputdir, path='./'):
    if inputdir[0:5] == 's3://':
        filenames = [f for f in s3_list(inputdir) if os.path.splitext(f)[1] == '.tif']
    else:
        filenames = glob.glob(os.path.join(inputdir, '*.tif'))
    return filenames


def main(inputdir, aoi, path):
    filenames = find_files(inputdir)
    filenames = copy_files(filenames, path=path)
    with open(aoi, 'r') as f:
        gj = json.loads(f.read())
    header = 'RoadID, max'
    print(header)
    for feat in gj['features']:
        if feat['geometry'] is not None:
            stats = get_stats(filenames, feat['geometry'])
            maxval = max([s['max'] for s in stats])
            #if maxval == 999 or maxval == -9999:
            #    import pdb; pdb.set_trace()
            print('%s, %s' % (feat['properties']['NAME'], maxval))


def parse_args(args):
    dhf = argparse.ArgumentDefaultsHelpFormatter
    parser = argparse.ArgumentParser(description='Remote image stats', formatter_class=dhf)
    parser.add_argument('inputdir', help='Directory containing files (or S3 Bucket/prefix)')
    parser.add_argument('--aoi', help='GeoJSON filename')
    parser.add_argument('--path', help='Local path to save files')
    return vars(parser.parse_args(args))


def cli():
    args = parse_args(sys.argv[1:])
    main(**args)


if __name__ == '__main__':
    cli()
