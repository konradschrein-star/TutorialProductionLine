import pandas as pd

df = pd.read_excel(r'C:\Users\konra\Downloads\Verified 37 Global Tutorial Gaps (1).xlsx')
for idx, r in df.iterrows():
    num = r['#']
    tool = r['Tool / Brand']
    cat = r['Category']
    rpm_l = r['RPM Low ($)']
    rpm_h = r['RPM High ($)']
    ideas = r['5 Content Ideas']
    gap = r['Gap Size']
    why = r['Why the gap exists']
    print(f"{num:2d}. {tool:25s} | {cat:25s} | {ideas}")
