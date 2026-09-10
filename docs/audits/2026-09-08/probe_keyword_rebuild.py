"""Reproduce Keyword Tool rebuild behavior against an in-memory database.

Usage: python probe_keyword_rebuild.py --repo PATH_TO_KEYWORD_TOOL
Imports the real classifier and schema; substitutes only the database session
and research filter output. Never opens the application's on-disk database.
"""

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    sys.path.insert(0, str(repo))
    from backend.v5 import classify

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript((repo / "src_v2/db/schema.sql").read_text(encoding="utf-8"))

    @contextmanager
    def memory_session():
        yield connection

    classify.db_session = memory_session

    # A current candidate survives research. The second, completed topic no
    # longer qualifies. Both already have operational state before a rebuild.
    candidate = SimpleNamespace(
        video_id="auditvideo1", title="How to create a calendar in Notion",
        verdict="PRODUCE", topic="Notion", duration_seconds=120,
        rpm=16.0, length_class="<3min", complexity="LOW", views=2000,
        outlier=2.0, age_days=365, est_value=32.0,
    )

    class FixedResearchFilter:
        def evaluate_channel(self, _videos):
            return [candidate]

    classify.ProductionFilter = FixedResearchFilter
    connection.execute(
        "INSERT INTO kt_videos(video_id,channel_ref,title,views,upload_date,duration_seconds) "
        "VALUES (?,?,?,?,?,?)",
        (candidate.video_id, "audit-channel", candidate.title, 2000, "20250908", 120),
    )
    connection.executemany(
        "INSERT INTO kt_keywords(video_id,keyword,canonical_key,topic,status,"
        "claimed_by,assignee,note,drive_url) VALUES (?,?,?,?,?,?,?,?,?)",
        [
            (candidate.video_id, candidate.title, "notion calendar", "Notion",
             "CLAIMED", 42, "Audit VA", "Keep the source account", None),
            ("auditvideo2", "Completed obsolete workflow", "obsolete workflow", "Notion",
             "DONE", 42, "Audit VA", "Already published", "https://drive.google.com/file/d/audit"),
        ],
    )
    connection.commit()

    def snapshot():
        return [dict(row) for row in connection.execute(
            "SELECT id,video_id,status,claimed_by,assignee,note,drive_url "
            "FROM kt_keywords ORDER BY id"
        )]

    before = snapshot()
    result = classify.build_keywords()
    after = snapshot()
    original = before[0]
    survivor = next(row for row in after if row["video_id"] == candidate.video_id)
    checks = {
        "stable_keyword_id": survivor["id"] == original["id"],
        "claim_owner_preserved": survivor["claimed_by"] == original["claimed_by"],
        "va_note_preserved": survivor["note"] == original["note"],
        "completed_work_preserved": any(row["video_id"] == "auditvideo2" for row in after),
    }
    print(json.dumps({"before": before, "after": after, "rebuild_result": result,
                      "required_invariants": checks}, indent=2))
    connection.close()
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
