# Evidence index

- Passive scroll/demo observation: ev_465a794b7ce347cdf2af10840d71df97c789f1397921975a6aa915439a292bd5.
- Post-scroll page inspection: ev_d4fb9257eb12d28d74cec461cdbc7fd3198c3b9189615c3c9d57d52897896994. The illustrative dashboard progressed to evidence/cohort/root-cause panels, without navigation or authenticated retrieval. Demonstration values are not experimental evidence.

- Passive page inspection: ev_21a28c09e1d2951dab74520ebf014a30f85186e359ffcaaadf85364f3e6202b3.
- Static bundle analysis: ev_db3b69a95cfd204129fecf8fdbbedbf172a4db7e0f87342d59c92bb790bd784b.
- Browser target discovery: ev_d21256d4ab76047fa65380353faef29832128832533e75ce71c944b55fc17ce4.
- Public summary: [evidence-summary.json](evidence-summary.json), containing script hashes, locations and coverage, with no source bytes.

Complete private REA evidence is retained outside this repository at C:\\Users\\chris\\rea-rain-investigation\\private-evidence.json. It contains public script captures and is excluded from publication. Reproduce using a separate browser profile on a literal loopback CDP port, allow only the listed origin, list targets, inspect_web_page with accessibility text and analyze_web_bundle with source-map discovery. Dynamic target IDs and timestamps will change; compare script SHA-256 values and content scope.
