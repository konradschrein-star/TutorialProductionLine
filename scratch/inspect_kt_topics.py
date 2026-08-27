import sqlite3

con = sqlite3.connect('/opt/keyword-tool-v2/data/data_lake.db')
cur = con.cursor()

topics = cur.execute("SELECT topic, COUNT(*) FROM kt_keywords GROUP BY topic ORDER BY COUNT(*) DESC").fetchall()
print("Top 30 topics in kt_keywords:")
for t, c in topics[:30]:
    print(f"  {t}: {c}")

print(f"\nTotal topics: {len(topics)}")
