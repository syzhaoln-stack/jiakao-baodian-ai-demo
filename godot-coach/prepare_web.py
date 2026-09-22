"""Prepare immutable, compressed files and synchronize both HTML shells after export."""
from pathlib import Path
import gzip
import hashlib
import json
import re

project = Path(__file__).resolve().parent
output = project.parent / "simulator"

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]

wasm = (output / "index.wasm").read_bytes()
packed_wasm = gzip.compress(wasm, compresslevel=9, mtime=0)
pack = (output / "index.pck").read_bytes()
script = (output / "index.js").read_bytes()
resources = {
    "wasm": {"file": f"engine-{digest(packed_wasm)}.wasm.gz", "bytes": len(packed_wasm), "rawBytes": len(wasm)},
    "pack": {"file": f"training-{digest(pack)}.pck", "bytes": len(pack)},
    "script": {"file": f"engine-{digest(script)}.js", "bytes": len(script)},
}
for key, data in (("wasm", packed_wasm), ("pack", pack), ("script", script)):
    (output / resources[key]["file"]).write_bytes(data)

line = "const DELIVERABLES = " + json.dumps(resources, separators=(",", ":")) + ";"
for html in (project / "shell.html", output / "index.html"):
    source = html.read_text(encoding="utf-8-sig")
    updated, count = re.subn(r"const DELIVERABLES = .*?;", lambda _: line, source, count=1)
    if count != 1:
        raise RuntimeError(f"Resource configuration marker missing in {html}")
    html.write_text(updated, encoding="utf-8")

print(json.dumps(resources, indent=2))
print(f"Optimized first download: {sum(item['bytes'] for item in resources.values()):,} bytes")
