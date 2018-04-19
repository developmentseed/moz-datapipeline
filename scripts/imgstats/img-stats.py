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


def upload(filename, uri, extra={}):
    """ Upload object to S3 uri (bucket + prefix), keeping same base filename """
    s3 = boto3.client('s3')
    s3_uri = uri_parser(uri)
    bname = os.path.basename(filename)
    uri_out = 's3://%s' % os.path.join(s3_uri['bucket'], os.path.join(s3_uri['key'], bname))
    key = os.path.join(s3_uri['key'], bname)
    with open(filename, 'rb') as f:
        #s3.upload_fileobj(f, s3_uri['bucket'], key, ExtraArgs=extra)
        s3.put_object(Bucket=s3_uri['bucket'], Key=key, Body=f, ACL='public-read', ContentType='application/json')
    return uri_out


def mkdirp(path):
    """ Recursively make directory """
    if not os.path.isdir(path):
        os.makedirs(path)
    return path


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
        stats.append(zonal_stats(pfilename, f, stats="count min max", nodata=999)[0])
    return stats


def find_files(inputdir, ext='tif', path='./'):
    if inputdir[0:5] == 's3://':
        filenames = [f for f in s3_list(inputdir) if os.path.splitext(f)[1] == '.%s' % ext]
    else:
        filenames = glob.glob(os.path.join(inputdir, '*.%s' % ext))
    return filenames


def copy_files(filenames, path='/tmp'):
    """ Copy files from s3 to local storage """
    fnames = filenames
    s3 = boto3.client('s3')
    fnames = []
    for f in filenames:
        if f[0:5] != 's3://':
            continue
        uri = uri_parser(f)
        fout = os.path.join(path, uri['filename'])
        mkdirp(os.path.dirname(fout))
        if not os.path.exists(fout):
            print('downloading %s' % f)
            s3.download_file(uri['bucket'], uri['key'], fout)
        fnames.append(fout)
    return fnames


def main(inputdir, aoi, path, id_property='NAME'):
    filenames = copy_files(find_files(inputdir), path=path)
    #copy_files(find_files(inputdir, ext='csv'), path=path)
    fout = os.path.join(path, os.path.splitext(os.path.basename(aoi))[0] + '_stats.json')
    if not os.path.exists(fout):
        # calculate stats
        with open(str(aoi), 'r') as f:
            gj = json.loads(f.read())
        numfeatures = len(gj['features'])

        stats = {}
        print('Saving output to %s' % fout)
        for i, feat in enumerate(gj['features']):
            if feat['geometry'] is not None:
                fid = feat['properties'][id_property]
                print('Calculating stats for fid %s (%s of %s)' % (fid, i+1, numfeatures))
                _stats = []
                for s in get_stats(filenames, feat['geometry']):
                    if s['max'] == -9999 or s['max'] is None:
                        _stats.append(0)
                    else:
                        _stats.append(s['max'])
                keys = [os.path.basename(f).split('_')[3][3:] for f in filenames]
                stats[fid] = dict(zip(keys, _stats))
                #if maxval == 999 or maxval == -9999:
                #    import pdb; pdb.set_trace()
        with open(fout, 'w') as f:
            f.write(json.dumps(stats))
        # upload to s3
        if inputdir[0:5] == 's3://':
            upload(fout, inputdir)


def parse_args(args):
    dhf = argparse.ArgumentDefaultsHelpFormatter
    parser = argparse.ArgumentParser(description='Remote image stats', formatter_class=dhf)
    parser.add_argument('inputdir', help='Directory containing files (or S3 Bucket/prefix)')
    parser.add_argument('--aoi', help='GeoJSON filename')
    parser.add_argument('--path', help='Local path to save files', default='./')
    return vars(parser.parse_args(args))


def cli():
    args = parse_args(sys.argv[1:])
    main(**args)


if __name__ == '__main__':
    cli()
