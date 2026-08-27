import sqlite3
import json

with open('/opt/tutorial-studio/apps/hub-web/src/lib/tutorial/seed-37-keywords.json', 'r', encoding='utf-8') as f:
    keywords = json.load(f)

con = sqlite3.connect('/opt/keyword-tool-v2/data/data_lake.db')
cur = con.cursor()

existing_titles = set(r[0].lower().strip() for r in cur.execute("SELECT keyword FROM kt_keywords").fetchall())

inserted = 0
for k in keywords:
    title = k['title'].strip()
    if title.lower() not in existing_titles:
        soft = k['software']
        dur = k['duration_sec'] or 130
        cur.execute("""
            INSERT INTO kt_keywords (
                keyword, canonical_key, topic, content_type, rpm_tier, rpm,
                length_class, duration_sec, complexity, views, outlier, est_value,
                win_score, saturation, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            title,
            title.lower().replace(' ', '-'),
            soft,
            'HOW_TO',
            'HIGH',
            35.0,
            '<3min',
            dur,
            'BEGINNER',
            15000,
            2.5,
            50.0,
            85.0,
            0.15,
            'NEW'
        ))
        existing_titles.add(title.lower())
        inserted += 1

con.commit()
total = cur.execute("SELECT COUNT(*) FROM kt_keywords").fetchone()[0]
print(f"Inserted {inserted} new keywords into Keyword Tool data_lake.db. Total now: {total}")
con.close()
