#!/usr/bin/env python3
"""Import the presentation/transit streetscape layer from a downloaded OSM XML bbox export.

This is a second, separate derivative of the same bounding box as osm.json. It
holds what makes the place recognisable rather than what the pedestrian/road
graph is built from: named storefronts, public art and monuments, fountains,
mapped trees/lamps/benches, bus stops and ordered bus-route node chains, Purple
Line construction and per-building colour/material tags.

Keeping it separate means osm.json (and therefore every simulation replay hash)
does not change when this layer is refreshed. No network access during
import/build; download the manifest's URL first.

    python scripts/import-bethesda-streetscape.py export.osm
"""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET

BBOX = [-77.104, 38.978, -77.089, 38.991]
URL = 'https://api.openstreetmap.org/api/0.6/map?bbox=-77.104,38.978,-77.089,38.991'
source_path = pathlib.Path(sys.argv[1])
root = ET.parse(source_path).getroot()
nodes = {n.attrib['id']: n for n in root.findall('node')}
ways = {w.attrib['id']: w for w in root.findall('way')}


def tags(e):
    return {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}


def point(n):
    return [float(n.attrib['lon']), float(n.attrib['lat'])]


def inside(p):
    return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]


def base(e, keep=()):
    t = tags(e)
    return {'osmId': e.attrib['id'], 'version': int(e.attrib['version']),
            'editedAt': e.attrib['timestamp'], **{k: t[k] for k in keep if k in t}}


# Contact details, opening hours, websites and mapper identities are never copied.
STOREFRONT_AMENITY = {'restaurant', 'cafe', 'fast_food', 'bank', 'bar', 'pub', 'ice_cream',
                      'pharmacy', 'theatre', 'cinema', 'library', 'post_office', 'dentist',
                      'doctors', 'clinic', 'marketplace', 'fuel'}
pois, monuments, trees, lamps, benches, stops, bikeshare = [], [], [], [], [], [], []
for n in nodes.values():
    p, t = point(n), tags(n)
    if not t or not inside(p):
        continue
    if t.get('name') and (t.get('shop') or t.get('amenity') in STOREFRONT_AMENITY
                          or t.get('tourism') in {'gallery', 'museum'} or t.get('office')):
        category = t.get('shop') or t.get('amenity') or t.get('tourism') or 'office'
        pois.append({**base(n, ['name', 'addr:street']), 'category': category, 'point': p})
    if t.get('tourism') == 'artwork' or t.get('historic') in {'monument', 'memorial'} \
            or t.get('amenity') == 'fountain':
        kind = 'fountain' if t.get('amenity') == 'fountain' else t.get('historic') or 'artwork'
        monuments.append({**base(n, ['name', 'artist_name', 'artwork_type', 'material',
                                     'inscription', 'wikidata', 'wikipedia']),
                          'kind': kind, 'point': p})
    if t.get('natural') == 'tree':
        trees.append({**base(n), 'point': p})
    if t.get('highway') == 'street_lamp':
        lamps.append({**base(n), 'point': p})
    if t.get('amenity') == 'bench' or t.get('leisure') == 'picnic_table':
        benches.append({**base(n), 'kind': t.get('amenity') or t.get('leisure'), 'point': p})
    if t.get('highway') == 'bus_stop':
        stops.append({**base(n, ['name', 'shelter', 'bench']), 'point': p})
    if t.get('amenity') == 'bicycle_rental':
        bikeshare.append({**base(n, ['name', 'network', 'capacity']), 'point': p})

construction = []
for w in ways.values():
    t = tags(w)
    refs = [n.attrib['ref'] for n in w.findall('nd')]
    if any(r not in nodes for r in refs):
        continue
    coords = [point(nodes[r]) for r in refs]
    kind = None
    if t.get('railway') == 'construction' or t.get('construction') in {'light_rail', 'rail'}:
        kind = 'rail'
    elif t.get('landuse') == 'construction' or t.get('building') == 'construction':
        kind = 'site'
    if not kind:
        continue
    # Keep contiguous in-bounds runs only; never invent a boundary vertex.
    runs, run = [], []
    for c in coords:
        if inside(c):
            run.append(c)
        elif run:
            runs.append(run)
            run = []
    if run:
        runs.append(run)
    for i, r in enumerate(runs):
        if kind == 'site' and (len(r) != len(coords) or coords[0] != coords[-1]):
            continue  # partial polygons are rejected rather than closed by guesswork
        if len(r) >= 2:
            construction.append({**base(w, ['name', 'railway', 'construction', 'landuse',
                                            'tunnel', 'layer']),
                                 'kind': kind, 'part': i, 'coordinates': r})

# Bus routes: orient each member way so it continues from the previous one. A
# member that is absent from the bbox export, or cannot be joined at a shared
# node, ends the current chain; chains are never bridged across a gap.
routes = []
for r in root.findall('relation'):
    t = tags(r)
    if t.get('type') != 'route' or t.get('route') != 'bus':
        continue
    chains, chain, single = [], [], False
    for m in r.findall('member'):
        if m.attrib['type'] != 'way' or m.attrib['role'] not in {'', 'forward', 'backward'}:
            continue
        w = ways.get(m.attrib['ref'])
        ids = [n.attrib['ref'] for n in w.findall('nd')] if w is not None else None
        if not ids or any(i not in nodes for i in ids):
            if len(chain) > 1:
                chains.append(chain)
            chain = []
            continue
        if single and chain[0] in (ids[0], ids[-1]):
            # The chain's only way was stored against the direction of travel.
            chain.reverse()
        single = False
        if not chain:
            chain, single = list(ids), True
        elif chain[-1] == ids[0]:
            chain.extend(ids[1:])
        elif chain[-1] == ids[-1]:
            chain.extend(reversed(ids[:-1]))
        else:
            if len(chain) > 1:
                chains.append(chain)
            chain, single = list(ids), True
    if len(chain) > 1:
        chains.append(chain)
    # Only node IDs inside the box are kept; a chain is split where it leaves it.
    kept = []
    for c in chains:
        run = []
        for i in c:
            if inside(point(nodes[i])):
                run.append(i)
            elif run:
                kept.append(run)
                run = []
        if run:
            kept.append(run)
    kept = [c for c in kept if len(c) >= 2]
    route_stops = []
    for m in r.findall('member'):
        if m.attrib['type'] == 'node' and m.attrib['role'].startswith(('stop', 'platform')):
            n = nodes.get(m.attrib['ref'])
            if n is not None and inside(point(n)):
                route_stops.append({'osmId': n.attrib['id'], 'name': tags(n).get('name', ''),
                                    'point': point(n)})
    if kept:
        routes.append({**base(r, ['name', 'ref', 'operator', 'network', 'colour']),
                       'chains': kept, 'stops': route_stops})

# Per-building attributes join to osm.json by ID *and* version: a newer edit may
# describe different geometry, so a version mismatch is not joined.
snapshot = json.loads((pathlib.Path(__file__).resolve().parents[1] /
                       'src/bethesda/data/osm.json').read_text())
versions = {f['properties']['osmId']: f['properties']['version'] for f in snapshot['features']
            if f['properties']['kind'] == 'building'}
attributes = []
for e in [*ways.values(), *root.findall('relation')]:
    t = tags(e)
    if e.attrib['id'] not in versions or versions[e.attrib['id']] != int(e.attrib['version']):
        continue
    keep = {k: t[k] for k in ['building:colour', 'roof:colour', 'building:material',
                              'roof:material', 'roof:shape', 'building:min_level', 'start_date']
            if k in t}
    if keep:
        attributes.append({'osmId': e.attrib['id'], 'version': int(e.attrib['version']), **keep})

for group in (pois, monuments, trees, lamps, benches, stops, bikeshare, construction, routes,
              attributes):
    group.sort(key=lambda f: (int(f['osmId']), f.get('part', 0)))
folder = pathlib.Path(__file__).resolve().parents[1] / 'src/bethesda/data'
data = {'type': 'bethesda-streetscape/v1', 'bbox': BBOX, 'license': 'ODbL-1.0',
        'attribution': '© OpenStreetMap contributors', 'storefronts': pois,
        'monuments': monuments, 'trees': trees, 'lamps': lamps, 'benches': benches,
        'busStops': stops, 'bikeshare': bikeshare, 'construction': construction,
        'busRoutes': routes, 'buildingAttributes': attributes}
out = folder / 'streetscape.json'
out.write_text(json.dumps(data, ensure_ascii=False))
subprocess.run([str(folder.parents[2] / 'node_modules/.bin/prettier'), '--write', str(out)],
               check=True)
counts = {k: len(v) for k, v in data.items() if isinstance(v, list) and k != 'bbox'}
raw_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
manifest_path = folder / 'streetscape-source.json'
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
acquired = previous.get('acquiredAt') if previous.get('rawSha256') == raw_hash else \
    (sys.argv[2] if len(sys.argv) > 2 else now)
manifest = {
    'schema': 'bethesda-streetscape-source/v1', 'acquiredAt': acquired, 'importedAt': now,
    'url': URL, 'bbox': BBOX, 'license': 'ODbL-1.0',
    'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/',
    'attribution': '© OpenStreetMap contributors', 'rawSha256': raw_hash,
    'snapshotSha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'counts': counts,
    'notes': [
        'Presentation and transit layer only; the pedestrian/road graph is osm.json.',
        'Separate acquisition from osm.json: a later download, so features may postdate it.',
        'Storefront names are OSM name tags rendered as plain text; no logos, trade dress, contact details or opening hours.',
        'Building attributes join to osm.json only where the OSM ID and version both match.',
        'Bus routes are ordered OSM way members cut to the bounding box; gaps are never bridged.',
    ],
}
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(counts)
