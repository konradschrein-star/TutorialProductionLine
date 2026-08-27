import pandas as pd
import re
import json

excel_path = r'C:\Users\konra\Downloads\Verified 37 Global Tutorial Gaps (1).xlsx'
tools_df = pd.read_excel(excel_path)

tools = []
for idx, r in tools_df.iterrows():
    tools.append({
        'id': int(r['#']),
        'name': str(r['Tool / Brand']).strip(),
        'category': str(r['Category']).strip(),
        'rpm_low': str(r['RPM Low ($)']).strip(),
        'rpm_high': str(r['RPM High ($)']).strip(),
        'gap': str(r['Gap Size']).strip(),
        'ideas': str(r['5 Content Ideas']).strip()
    })

print(f"Loaded {len(tools)} tools.")
