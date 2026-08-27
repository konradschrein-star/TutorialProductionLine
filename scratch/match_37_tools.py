import pandas as pd
import re
import os
import glob

# 1. Load 37 tools
excel_path = r'C:\Users\konra\Downloads\Verified 37 Global Tutorial Gaps (1).xlsx'
tools_df = pd.read_excel(excel_path)

tools_list = []
for idx, r in tools_df.iterrows():
    name = str(r['Tool / Brand']).strip()
    cat = str(r['Category']).strip()
    ideas = str(r['5 Content Ideas']).strip()
    tools_list.append({
        'num': r['#'],
        'name': name,
        'cat': cat,
        'ideas': ideas
    })

tool_patterns = {}
for t in tools_list:
    name = t['name']
    aliases = [name.lower()]
    m = re.search(r'\((.*?)\)', name)
    if m:
        sub = m.group(1).lower()
        aliases.append(sub)
        base = re.sub(r'\(.*?\)', '', name).strip().lower()
        aliases.append(base)
    
    if "make" in name.lower():
        aliases.extend(["make.com", "integromat"])
    if "brevo" in name.lower():
        aliases.extend(["sendinblue"])
    if "looker" in name.lower():
        aliases.extend(["looker studio", "google data studio", "datastudio"])
    if "tradingview" in name.lower():
        aliases.extend(["trading view", "tradingview"])
    if "quickbooks" in name.lower():
        aliases.extend(["quickbooks", "quick books", "qbo"])
    if "monday" in name.lower():
        aliases.extend(["monday.com", "monday"])
    if "dext" in name.lower():
        aliases.extend(["receipt bank", "receiptbank", "dext"])
    if "remote" in name.lower():
        aliases.extend(["remote.com", "remote"])
    if "webex" in name.lower():
        aliases.extend(["cisco webex", "webex"])

    aliases = list(set([a.strip() for a in aliases if len(a.strip()) > 1]))
    tool_patterns[name] = aliases

def match_tool(title):
    t_lower = title.lower()
    for tool_name, aliases in tool_patterns.items():
        for alias in aliases:
            # Word boundary matching so e.g. "make" matches "how to use make" or "make.com" but not "remake"
            if re.search(r'\b' + re.escape(alias) + r'\b', t_lower):
                return tool_name
    return None

# Check keyword files in YTA Tutorials/Keywords
kw_folder = r'C:\Users\konra\OneDrive\YouTube\Projekte\YTA Tutorials\Keywords'
kw_files = glob.glob(os.path.join(kw_folder, '*'))
print(f"Checking {len(kw_files)} keyword files in {kw_folder}...")

matched_keywords = []

# Collect from txt files in Keywords folder
for f in kw_files:
    if f.endswith('.txt'):
        tool_hint = os.path.splitext(os.path.basename(f))[0]
        matched_t = match_tool(tool_hint)
        with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
            for line in fp:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                # check if line matches tool
                m_tool = match_tool(line) or matched_t
                if m_tool:
                    matched_keywords.append({
                        'title': line,
                        'software': m_tool,
                        'source': f"file:{os.path.basename(f)}"
                    })
    elif f.endswith('.xlsx'):
        tool_hint = os.path.splitext(os.path.basename(f))[0]
        matched_t = match_tool(tool_hint)
        try:
            xdf = pd.read_excel(f)
            # check columns for titles
            for col in xdf.columns:
                if any(k in str(col).lower() for k in ['title', 'keyword', 'name', 'topic']):
                    for val in xdf[col].dropna():
                        val_str = str(val).strip()
                        m_tool = match_tool(val_str) or matched_t
                        if m_tool:
                            matched_keywords.append({
                                'title': val_str,
                                'software': m_tool,
                                'source': f"xlsx:{os.path.basename(f)}"
                            })
        except Exception as e:
            print(f"Error reading {f}: {e}")

# Check guiderealm and master production queues
csvs = [
    r'C:\Users\konra\OneDrive\YouTube\Projekte\YTA Tutorials\Scraper Projekt für ganz viel Einkommen\Keyword Tool V2\guiderealm_production_queue.csv',
    r'C:\Users\konra\OneDrive\YouTube\Projekte\YTA Tutorials\Scraper Projekt für ganz viel Einkommen\Keyword Tool V2\master_production_queue.csv'
]

for c in csvs:
    if os.path.exists(c):
        cdf = pd.read_csv(c)
        print(f"Checking {len(cdf)} rows from {os.path.basename(c)}...")
        for idx, row in cdf.iterrows():
            title = str(row.get('title', ''))
            topic = str(row.get('topic', ''))
            m_tool = match_tool(title) or match_tool(topic)
            if m_tool:
                matched_keywords.append({
                    'title': title,
                    'software': m_tool,
                    'source': os.path.basename(c),
                    'video_id': str(row.get('video_id', ''))
                })

print(f"Total matched keywords collected: {len(matched_keywords)}")

# Deduplicate by title
unique_kws = {}
for k in matched_keywords:
    t_clean = k['title'].strip()
    if not t_clean:
        continue
    # ensure "How to" formatting if missing
    t_key = t_clean.lower()
    if t_key not in unique_kws:
        unique_kws[t_key] = k

print(f"Unique matched keywords: {len(unique_kws)}")

# Count per software
from collections import Counter
counts = Counter([k['software'] for k in unique_kws.values()])
for tool_name in tool_patterns.keys():
    print(f"{tool_name:25s}: {counts.get(tool_name, 0)} keywords")
