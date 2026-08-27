with open('/opt/keyword-tool-v2/backend/routers/v5.py', 'r') as f:
    text = f.read()

idx = text.find('def get_board')
if idx != -1:
    print(text[idx:idx+1500])
else:
    idx2 = text.find('/board')
    print(text[idx2:idx2+1500])
