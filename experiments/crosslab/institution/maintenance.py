"""Verify checkpoints, back up the journal, and generate a local living wiki."""
import argparse
from pathlib import Path

from memory import Journal, ZERO
from view import wiki


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("journal", type=Path)
    parser.add_argument("--checkpoint")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--backup", type=Path)
    output.add_argument("--wiki", type=Path)
    args = parser.parse_args()
    if not args.journal.exists():
        parser.error("Journal does not exist")
    journal = Journal(args.journal)
    records = journal.snapshot(args.checkpoint)
    if args.backup:
        print(journal.backup(args.backup))
        return
    if args.wiki:
        args.wiki.mkdir(mode=0o700, parents=True, exist_ok=False)
        for subject, page in wiki(records).items():
            (args.wiki / f"{subject}.md").write_text(page, encoding="utf-8")
    print(records[-1]["hash"] if records else ZERO)


if __name__ == "__main__":
    main()
