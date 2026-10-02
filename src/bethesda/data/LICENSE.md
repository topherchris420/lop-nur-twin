# Geographic database license

© OpenStreetMap contributors. `osm.json` is an extracted and modified OpenStreetMap
geographic database, licensed under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/

Attribution and source information: https://www.openstreetmap.org/copyright

This database license is separate from the repository's Apache-2.0 source code
license. The derivative database is provided in full here and through the city's
Field notes download. `source.json` records the actual source URL, acquisition
time, byte hashes, feature counts and known extraction limitations.

## Bare-earth elevation crop

`terrain.json` is a 65 × 65 bilinear crop of the Montgomery Planning countywide
DTM, converted from US survey feet to metres. © Montgomery County Planning
Department, MNCPPC. This is separate from the OSM database and Apache code license.

The publisher expressly permits copying, modification, distribution and analysis,
including commercially, with attribution. The data is provided without warranties;
the publisher disclaims liability to the fullest extent permitted by law. The full
permission text, service/item URLs, request, retrieval date and byte hashes are in
`terrain-source.json`.

Terms: https://www.arcgis.com/sharing/rest/content/items/0379353eb80b4207b979656bd9eadff9?f=json

Source: https://montgomeryplanning.org/tools/gis-and-mapping/elevation-data/

## Streetscape and transit layer

`streetscape.json` is a second extracted and modified OpenStreetMap database for the
same bounding box, also © OpenStreetMap contributors and licensed under ODbL 1.0. It
was downloaded later than `osm.json` (see `streetscape-source.json` for the actual
URL, retrieval time, byte hashes and counts), so a feature in it may postdate the
road/building snapshot. It contains storefront name tags, mapped public art,
monuments and fountains, trees, lamps, benches, bus stops, ordered bus-route node
chains, Purple Line construction ways and building colour/material tags whose OSM
version matches `osm.json`. Contact details, opening hours, websites and mapper
identities are not copied. Storefront names are OSM `name` tags rendered as plain
text; no logos, trade dress or photographs are included.
