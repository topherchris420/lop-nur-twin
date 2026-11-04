# The collision repair's records, 2026-11-03

What [`ECHO_COLLISION.md`](../../../ECHO_COLLISION.md) reports, as each run wrote it. All of
it ran on GitHub's Linux arm64 runners with Node 24.22.1, the VM's platform, on copies of
the deployed fly's backups or on research flies. A copy is never the individual. No store
or archive is here.

| Folder       | Run                                                                                                                                                                                  | Commit    | What it is                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------- |
| `flies/`     | [41727492979](https://github.com/topherchris420/lop-nur-twin/actions/runs/41727492979)                                                                                               | `d24c23d` | Research flies, 96 simulated hours each, on the old physics and the new    |
| `procedure/` | [41731771963](https://github.com/topherchris420/lop-nur-twin/actions/runs/41731771963)                                                                                               | `f349ffb` | The continuation's commands on a copy, and the refusals                    |
| `rehearsal/` | [41729219898](https://github.com/topherchris420/lop-nur-twin/actions/runs/41729219898)                                                                                               | `4481891` | 72 simulated hours on a copy, one sample a minute, gzipped                 |
| `replay/`    | [41747963788](https://github.com/topherchris420/lop-nur-twin/actions/runs/41747963788)                                                                                               | `4ef2bc3` | A replay across the continuation, on a copy                                |
| `dress/`     | [41752780859](https://github.com/topherchris420/lop-nur-twin/actions/runs/41752780859), after [41748526687](https://github.com/topherchris420/lop-nur-twin/actions/runs/41748526687) | `9efdc1d` | Every step of the cutover plan, as root, on a disposable machine, in order |

`4481891` differs from the merged script only by lint. `4ef2bc3` and `9efdc1d` are scratch
commits on `1844db5`, which add the workflow, kept in
[`docs/research/echo-collision/`](../../../research/echo-collision/), and the dress rehearsal's
two VM scripts. They change nothing the fly runs. Each folder's `archive.txt` names the
backup and its SHA-256.

The workflows for `replay/` and `dress/` read a secret and only ran on their own scratch
branches, so they are kept as records and do not run from this repository's main branch.
