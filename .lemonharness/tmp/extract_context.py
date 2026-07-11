import os, sys
with open(sys.argv[1], 'rb') as f:
    content = f.read()
idx = content.rfind(b'contextBudget')
start = max(0, idx - 60)
end = min(len(content), idx + 500)
text = content[start:end].decode('utf-8', errors='replace')
with open(sys.argv[2], 'w') as f:
    f.write(text)
print(f"Extracted {len(text)} chars to {sys.argv[2]}")
