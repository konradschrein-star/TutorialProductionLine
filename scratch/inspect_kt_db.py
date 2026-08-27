import sqlite3

con = sqlite3.connect('/opt/keyword-tool-v2/data/data_lake.db')
cur = con.cursor()
tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print('Tables in data_lake.db:', tables)

for t in tables:
    try:
        cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"Table '{t}': {cnt} rows")
        # Check columns
        cols = [c[1] for c in cur.execute(f"PRAGMA table_info({t})").fetchall()]
        print(f"  Columns: {cols}")
    except Exception as e:
        print(f"Error reading {t}: {e}")
