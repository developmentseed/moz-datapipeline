import sys
import argparse
from pyproj import Proj, transform
from copy import deepcopy
import numpy
import rasterio
from rasterstats import zonal_stats
import json


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


def get_stats(filenames, geojson):
    """ Get stats for polygon from files and add to database """
    stats = []

    origin = Proj(init='epsg:4326')
    _geojson = deepcopy(geojson)
    origin_coords = geojson['coordinates']

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
        stats.append(zonal_stats(pfilename, f, stats="count mean sum std"))
    # NOTE - this aggregated mean assumes no overlap betweeen rasters
    # always s[0] since it is one polygon
    total = float(sum([s[0]['count'] for s in stats]))
    mean = 0
    variance = 0
    stddev = 0
    if total > 0:
        for s in stats:
            weight = s[0]['count'] / total
            if s[0]['count'] > 0:
                mean = mean + s[0]['mean'] * weight
                variance = variance + (s[0]['std']**2 * weight)
        stddev = numpy.sqrt(variance)
    # assume gain of 0.0001
    mean = mean / 10000.0
    stddev = stddev / 10000.0
    if total == 0:
        mean = None
        stddev = None
    return {
        'count': total,
        'mean': mean,
        'stddev': stddev
    }


def parse_args(args):
    dhf = argparse.ArgumentDefaultsHelpFormatter
    parser = argparse.ArgumentParser(description='Remote image stats', formatter_class=dhf)
    parser.add_argument('filenames', nargs='*', help='Raster filenames')
    parser.add_argument('--aoi', help='GeoJSON filename')
    return vars(parser.parse_args(args))


def cli():
    stats = get_stats(parse_args(sys.argv[1:]))
    print(stats)


if __name__ == '__main__':
    cli()