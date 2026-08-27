with open('/opt/keyword-tool-v2/backend/routers/v5.py', 'r') as f:
    text = f.read()

for target in ['def _screen_sql', 'OPEN_STATUSES =', 'IN_FLIGHT_STATUSES =']:
    idx = text.find(target)
    if idx != -1:
        print(f"--- {target} ---")
        print(text[idx:idx+300])
