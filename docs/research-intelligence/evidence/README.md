# Retained CPU study evidence

`archive/` is the unchanged original ResearchStore/Registry export. Its tree
digest, byte count, event tail and source identities appear in the
[engineering report](../REPORT.md) and `replay-receipt.json`. Do not format or
rewrite its JSON/source snapshots. These files are research records, not another
implementation to import or execute.

`replay-receipt.json` records the separately reviewed numerical replay of all
12 exposed panels. It confirms deterministic consistency, with zero new
confirmation samples and an additional 2,304 declared work units. It does not
authenticate a human signer or independently replicate the statistical method.

`browser-qa.json` identifies the refreshed production viewer by HTML, script and
evidence hashes and records desktop/phone checks under the production CSP.
Screenshots are retained locally under ignored `shots/`; binary assets are not
committed. The newer presentation differs from the original archived HTML; raw
observations, registry records and evidence JSON were not changed.

The generated web summaries/viewers live at
[`public/research-intelligence/`](../../../public/research-intelligence).
They deliberately omit full source receipts from the deployable static bundle.
See [usage](../USAGE.md) for read-only verification and separately reviewed replay.
