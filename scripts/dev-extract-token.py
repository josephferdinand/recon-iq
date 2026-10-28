import json, os, sys, tempfile

WIN_TMP = os.environ.get("TEMP") or r"C:\Users\ALICEY~1\AppData\Local\Temp"
candidates = [
    os.path.join(WIN_TMP, "dev-session.json"),
    "/tmp/dev-session.json",
    os.path.join(tempfile.gettempdir(), "dev-session.json"),
]
data = None
for c in candidates:
    if os.path.exists(c):
        with open(c) as f:
            data = json.load(f)
        print("loaded:", c)
        break
if data is None:
    print("ERROR: dev-session.json not found in", candidates)
    sys.exit(1)

out = data["access_token"]
out_path = os.path.join(WIN_TMP, "dev-access.txt")
fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(out)
print("wrote", out_path, "len=", len(out))
