#!/usr/bin/env python3
"""Offline conversion of the small Montgomery Planning DTM export. Requires Pillow.

See docs/BETHESDA_ANOMALY.md for the exact export request. No network in this importer.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("raster", type=Path)
parser.add_argument("export_metadata", type=Path)
parser.add_argument("service_metadata", type=Path)
parser.add_argument("item_metadata", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / "src/bethesda/data"
export = json.loads(args.export_metadata.read_text())
service = json.loads(args.service_metadata.read_text())
item = json.loads(args.item_metadata.read_text())
im = Image.open(args.raster)
if im.mode != "F" or im.size != (65, 65) or service["pixelType"] != "F32":
    raise ValueError("Expected single-band floating-point 65 × 65 DTM")
values = list(im.getdata())
if not all(math.isfinite(v) and 250 < v < 450 for v in values):
    raise ValueError("Unexpected Bethesda elevation / nodata; do not fill missing samples")
extent = export["extent"]
if extent["spatialReference"]["wkid"] != 4326:
    raise ValueError("Expected WGS84 export extent")
if "NAVD88 height - Geoid12B (ftUS)" not in service["extent"]["spatialReference"]["wkt2"]:
    raise ValueError("Vertical datum or units changed")
license_html = item.get("licenseInfo", "")
if "You can copy, modify, distribute" not in license_html:
    raise ValueError("Redistribution terms missing")
grid = {
    "schema": "bethesda-dtm/v1",
    "width": 65,
    "height": 65,
    "bbox": [extent[k] for k in ["xmin", "ymin", "xmax", "ymax"]],
    "sampleLocation": "pixel centres; row 0 north, column 0 west",
    "units": "metres NAVD88 (Geoid12B), converted from US survey feet",
    "elevations": [round(v * 1200 / 3937, 4) for v in values],
}
grid_path = root / "terrain.json"
grid_path.write_text(json.dumps(grid, indent=2) + "\n")
manifest = {
    "publisher": "Montgomery County Planning Department, MNCPPC",
    "attribution": "© Montgomery County Planning Department, MNCPPC",
    "service": "https://montgomeryplans.org/server9/rest/services/Elevation/countywide_dtm/ImageServer",
    "item": "https://www.arcgis.com/sharing/rest/content/items/" + service["serviceItemId"] + "?f=json",
    "reference": "https://montgomeryplanning.org/tools/gis-and-mapping/elevation-data/",
    "acquiredAt": datetime.fromtimestamp(args.raster.stat().st_mtime, timezone.utc).isoformat(),
    "sourceRasterSha256": hashlib.sha256(args.raster.read_bytes()).hexdigest(),
    "snapshotSha256": hashlib.sha256(grid_path.read_bytes()).hexdigest(),
    "license": "Publisher permission to copy, modify, distribute and analyze, including commercially, with attribution",
    "licenseText": "You can copy, modify, distribute, and perform analysis on the data, even for commercial purposes, all without asking permission, but please provide attribution to the Montgomery County Planning Department. The Planning Department makes no warranties about the data, and disclaims liability for all uses of the data, to the fullest extent permitted by applicable law.",
    "export": {
        "bbox": ",".join(str(v) for v in grid["bbox"]),
        "bboxSR": 4326, "imageSR": 4326, "size": "65,65", "format": "tiff",
        "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation",
        "renderingRule": {"rasterFunction": "None"}, "adjustAspectRatio": False,
    },
    "limitations": [
        "65 × 65 bilinear export of publisher's one-foot DTM; about 20 × 22 metres between samples, not one-foot model detail",
        "Publisher describes current LiDAR acquisition as late 2023 / early 2024; per-pixel acquisition dates and uncertainty are not exposed by this export",
        "Bare earth, not building heights, curb profiles, steps, bridges or underpasses",
        "Pixel-centre samples interpolated and clamped at the crop border; no extrapolation",
    ],
}
(root / "terrain-source.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Imported {len(values)} real DTM samples, {min(grid['elevations']):.2f}–{max(grid['elevations']):.2f} m NAVD88")
