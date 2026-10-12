# Evidence index

- Passive interaction observation: ev_8274395d077e58c27fa8829eaa7a3a13806fc0220d73265e06155a446dad570b. No navigation occurred; the attempted text match did not activate the icon-only panel button, so this does not establish an interactive workflow.

- Passive page inspection: ev_ff10b2e1fdc4fb4a361b0ac638399c3e00b61c6972e0fbe3140c7361b27e513e.
- Static bundle analysis: ev_11058dd379ccffd1f06447eb280dae5657b3a932fa3e78e4cb5cb3d6c27b90d9.
- Browser target discovery: ev_d21256d4ab76047fa65380353faef29832128832533e75ce71c944b55fc17ce4.
- Public summary: [evidence-summary.json](evidence-summary.json), containing script hashes, locations and coverage, with no source bytes.

Complete private REA evidence is retained outside this repository at C:\\Users\\chris\\rea-rain-investigation\\private-evidence.json. It contains public script captures and is excluded from publication. Reproduce using a separate browser profile on a literal loopback CDP port, allow only the listed origin, list targets, inspect_web_page with accessibility text and analyze_web_bundle with source-map discovery. Dynamic target IDs and timestamps will change; compare script SHA-256 values and content scope.
