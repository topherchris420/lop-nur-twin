#!/usr/bin/env python3
"""Import a downloaded OSM XML bbox export. No network access during import/build."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET

BBOX = [-77.104, 38.978, -77.089, 38.991]
root = ET.parse(sys.argv[1]).getroot()
nodes = {n.attrib['id']: n for n in root.findall('node')}
def tags(e): return {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}
def point(n): return [float(n.attrib['lon']), float(n.attrib['lat'])]
def inside(p): return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]
def properties(e, allowed):
    t = tags(e)
    return {'osmId': e.attrib['id'], 'version': int(e.attrib['version']), 'editedAt': e.attrib['timestamp'], **{k:t[k] for k in allowed if k in t}}
features = []
roads = {'primary','secondary','tertiary','residential','unclassified','primary_link','secondary_link','tertiary_link','service'}
paths = {'footway','pedestrian','cycleway','path'}
for w in root.findall('way'):
    t = tags(w)
    refs = [n.attrib['ref'] for n in w.findall('nd')]
    if any(n not in nodes for n in refs): continue
    coords = [point(nodes[n]) for n in refs]
    prop = properties(w, ['name','building','height','building:levels','building:material','roof:shape','highway','footway','oneway','lanes','width','surface','leisure','service'])
    for kind, match in [('building', bool(t.get('building')) and t['building'] != 'no'), ('park', t.get('leisure') in {'park','garden'})]:
        if match and len(coords) >= 4 and coords[0] == coords[-1] and all(inside(p) for p in coords):
            features.append({'type':'Feature','geometry':{'type':'Polygon','coordinates':[coords]},'properties':{**prop,'kind':kind}})
    if t.get('access') == 'private' or t.get('tunnel') == 'yes' or t.get('layer','0').startswith('-') or t.get('level','0').startswith('-'): continue
    highway = t.get('highway')
    kind = 'road' if highway in roads and t.get('service') not in {'driveway','parking_aisle'} else 'path' if highway in paths else None
    if not kind: continue
    runs, run = [], []
    for i,p in enumerate(coords):
        if inside(p): run.append(i)
        elif run: runs.append(run); run=[]
    if run: runs.append(run)
    for idx,run in enumerate(runs):
        if len(run) < 2: continue
        features.append({'type':'Feature','geometry':{'type':'LineString','coordinates':[coords[i] for i in run]},'properties':{**prop,'kind':kind,'part':idx,'nodeIds':[refs[i] for i in run]}})
for n in nodes.values():
    p, t = point(n), tags(n)
    if not inside(p): continue
    kind = 'signal' if t.get('highway') == 'traffic_signals' else 'crossing' if t.get('highway') == 'crossing' else 'metro' if t.get('railway') == 'subway_entrance' else 'rescue' if t.get('amenity') == 'fire_station' else 'landmark' if t.get('name') in {'Bethesda Row','Woodmont Triangle','Bethesda Theatre','Bethesda','Downtown Bethesda'} else None
    if kind: features.append({'type':'Feature','geometry':{'type':'Point','coordinates':p},'properties':{**properties(n,['name','highway','railway','amenity']),'kind':kind}})
features.sort(key=lambda f: (f['properties']['kind'], int(f['properties']['osmId']), f['properties'].get('part',0)))
folder = pathlib.Path(__file__).resolve().parents[1] / 'src/bethesda/data'
folder.mkdir(parents=True,exist_ok=True)
data = {'type':'FeatureCollection','bbox':BBOX,'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','features':features}
(folder/'osm.json').write_text(json.dumps(data,ensure_ascii=False))
subprocess.run([str(folder.parents[2]/'node_modules/.bin/prettier'),'--write',str(folder/'osm.json')],check=True)
counts = {k:sum(f['properties']['kind']==k for f in features) for k in sorted({f['properties']['kind'] for f in features})}
manifest = {'schema':'bethesda-source/v1','acquiredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':'https://api.openstreetmap.org/api/0.6/map?bbox=-77.104,38.978,-77.089,38.991','bbox':BBOX,'license':'ODbL-1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors','rawSha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest(),'snapshotSha256':hashlib.sha256((folder/'osm.json').read_bytes()).hexdigest(),'counts':counts,'notes':['Actual OSM geometry and topology; not a county survey.','Only complete simple polygon ways; multipolygon relations/courtyard holes excluded.','Mapper identities, contact details, underground/private paths and unrelated POIs removed.','Heights are community metadata where present; other elevations are inferred by the renderer.']}
(folder/'source.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(counts)
