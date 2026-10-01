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
# Preserve complete multipolygon rings, including courtyard voids. Join only
# exact shared node IDs; missing or ambiguous topology is never guessed.
way_index = {w.attrib['id']: w for w in root.findall('way')}
def joined_rings(member_refs):
    pending = []
    for ref in member_refs:
        w = way_index.get(ref)
        if w is None: return None
        ids = [n.attrib['ref'] for n in w.findall('nd')]
        if len(ids) < 2 or any(n not in nodes for n in ids): return None
        pending.append(ids)
    result = []
    while pending:
        chain = pending.pop(0)
        while chain[0] != chain[-1]:
            matches = [(i,part) for i,part in enumerate(pending) if chain[-1] in (part[0],part[-1])]
            if len(matches) != 1: return None  # missing or ambiguous topology
            i,part = matches[0]
            pending.pop(i)
            if part[-1] == chain[-1]: part = list(reversed(part))
            chain.extend(part[1:])
        coords = [point(nodes[n]) for n in chain]
        if len(coords) < 4 or not all(inside(p) for p in coords): return None
        result.append(coords)
    return result
def ring_contains(p, ring):
    result = False
    for a,b in zip(ring,ring[1:]):
        if (a[1]>p[1]) != (b[1]>p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]: result = not result
    return result
for relation in root.findall('relation'):
    t = tags(relation)
    if t.get('type') != 'multipolygon' or not t.get('building') or t['building'] == 'no': continue
    members = [m for m in relation.findall('member') if m.get('type') == 'way' and m.get('role') in {'outer','inner'}]
    outers = joined_rings([m.get('ref') for m in members if m.get('role') == 'outer'])
    inners = joined_rings([m.get('ref') for m in members if m.get('role') == 'inner'])
    if not outers or inners is None: continue
    if any(not any(all(ring_contains(p,outer) for p in hole[:-1]) for outer in outers) for hole in inners): continue
    # Relation owns the building; prevent an outer way being extruded twice.
    member_ids = {m.get('ref') for m in members}
    features = [f for f in features if not (f['properties']['kind']=='building' and f['properties']['osmId'] in member_ids)]
    prop = properties(relation,['name','building','height','building:levels','building:material','roof:shape'])
    for idx,outer in enumerate(outers):
        holes = [hole for hole in inners if ring_contains(hole[0],outer)]
        features.append({'type':'Feature','geometry':{'type':'Polygon','coordinates':[outer,*holes]},'properties':{**prop,'kind':'building','osmType':'relation','part':idx,'memberWays':sorted(member_ids)}})
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
raw_hash = hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()
previous = json.loads((folder/'source.json').read_text()) if (folder/'source.json').exists() else {}
acquired = previous.get('acquiredAt') if previous.get('rawSha256') == raw_hash else datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest = {'schema':'bethesda-source/v1','acquiredAt':acquired,'importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':'https://api.openstreetmap.org/api/0.6/map?bbox=-77.104,38.978,-77.089,38.991','bbox':BBOX,'license':'ODbL-1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors','rawSha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest(),'snapshotSha256':hashlib.sha256((folder/'osm.json').read_bytes()).hexdigest(),'counts':counts,'notes':['Actual OSM geometry and topology; not a county survey.','Complete polygon ways and building multipolygons with courtyard holes; joined at exact shared OSM node IDs. Incomplete or ambiguous relations omitted.','Mapper identities, contact details, underground/private paths and unrelated POIs removed.','Heights are community metadata where present; other elevations are inferred by the renderer.']}
(folder/'source.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(counts)
