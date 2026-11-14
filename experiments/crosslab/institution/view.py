"""Derive a publication snapshot and a living Markdown wiki from journal history."""
from memory import standing


def public_snapshot(records, evaluation=None):
    # Export is explicit. Local identities, hashes linking to unpublished
    # events, and source text are deliberately retained for operator inspection.
    subjects = sorted({row["event"]["subject"] for row in records})
    return {"schema": "rain-memory-observatory/v1", "records": records,
            "subjects": subjects, "standing": standing(records), "evaluation": evaluation}


def wiki(records):
    dispositions = standing(records)
    pages = {}
    for row in records:
        item = row["event"]
        page = pages.setdefault(item["subject"], [])
        refs = " ".join(f"[`{ref[:12]}`](#{ref})" for ref in item["refs"])
        text = item["text"].replace("<", "&lt;").replace(">", "&gt;")
        status = dispositions.get(row["hash"])
        if item["kind"] in {"correction", "guidance"} and status is None:
            status = "review pending"
        after = f" ({status})" if status else ""
        page.append(f'<a id="{row["hash"]}"></a>\n\n'
                    f'### {row["seq"]}. {item["kind"]}{after}\n\n{text}\n\n'
                    f'{refs}\n')
    return {subject: f"# {subject}\n\n" + "\n".join(sections) for subject, sections in pages.items()}
