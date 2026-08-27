import sqlite3

con = sqlite3.connect('/opt/keyword-tool-v2/data/data_lake.db')
cur = con.cursor()

# 37 Verified business software tools
ALLOWED_37 = [
    "Airtable", "BambooHR", "Brevo", "Calendly", "Canva", "ClickUp",
    "Deel", "Dext", "DocuSign", "Figma", "Framer", "Gusto", "Hotjar",
    "HubSpot", "Intercom", "Klaviyo", "Looker Studio", "Loom", "Make",
    "Miro", "Monday.com", "n8n", "Notion", "PandaDoc", "Pipedrive",
    "QuickBooks", "Remote.com", "Rippling", "Semrush", "Slack",
    "TradingView", "Typeform", "Webex", "Webflow", "Xero", "Zapier", "Zendesk"
]

# Normalization mapping
NORM = {
    "sendinblue": "Brevo",
    "integromat": "Make",
    "receipt bank": "Dext",
    "monday": "Monday.com",
    "remote": "Remote.com",
    "quickbooks online": "QuickBooks",
    "qbo": "QuickBooks",
}

# Normalize allowed set (case-insensitive lookup)
allowed_lower_map = {s.lower(): s for s in ALLOWED_37}
allowed_lower_map.update(NORM)

# 1. Update topics that match aliases
for bad, good in NORM.items():
    cur.execute("UPDATE kt_keywords SET topic = ? WHERE LOWER(topic) = ?", (good, bad))
    cur.execute("UPDATE kt_software_state SET topic = ? WHERE LOWER(topic) = ?", (good, bad))

# 2. Get initial count
initial_count = cur.execute("SELECT COUNT(*) FROM kt_keywords").fetchone()[0]
print(f"Initial keywords in Keyword Tool: {initial_count}")

# 3. Delete non-37 keywords
all_rows = cur.execute("SELECT id, topic FROM kt_keywords").fetchall()
to_delete = []
for kid, top in all_rows:
    top_clean = (top or "").strip().lower()
    if top_clean not in allowed_lower_map:
        to_delete.append(kid)

print(f"Deleting {len(to_delete)} non-business/irrelevant keywords (gaming, phone, general OS)...")
if to_delete:
    # Delete in batches
    batch_size = 500
    for i in range(0, len(to_delete), batch_size):
        batch = to_delete[i:i+batch_size]
        cur.execute(f"DELETE FROM kt_keywords WHERE id IN ({','.join(['?']*len(batch))})", batch)

# 4. Clean kt_software_state
cur.execute("DELETE FROM kt_software_state WHERE topic NOT IN ({})".format(','.join(['?']*len(ALLOWED_37))), ALLOWED_37)

# 5. Commit and VACUUM
con.commit()
cur.execute("VACUUM")
con.commit()

final_count = cur.execute("SELECT COUNT(*) FROM kt_keywords").fetchone()[0]
topics_left = cur.execute("SELECT topic, COUNT(*) FROM kt_keywords GROUP BY topic ORDER BY COUNT(*) DESC").fetchall()

print(f"Cleanup complete! Remaining keywords: {final_count}")
print("Remaining topics:")
for t, c in topics_left:
    print(f"  {t}: {c}")

con.close()
