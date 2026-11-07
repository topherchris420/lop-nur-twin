"""Keep seven daily, consistent SQLite snapshots on the existing VM disk."""
from datetime import datetime
import os
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo

database = Path(os.environ.get("FLY_DB", "/var/lib/bethesda-fly/world.sqlite3"))
backups = database.parent / "backups"
backups.mkdir(mode=0o700, exist_ok=True)
slot = datetime.now(ZoneInfo("America/New_York")).weekday()
destination = backups / f"day-{slot}.sqlite3"
temporary = backups / f"day-{slot}.pending"
source = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
target = sqlite3.connect(str(temporary))
try:
    source.backup(target)
    if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("Backup integrity check failed")
finally:
    target.close()
    source.close()
os.replace(temporary, destination)
print(f"Saved a consistent life snapshot to {destination}")
