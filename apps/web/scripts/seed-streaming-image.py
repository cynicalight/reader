"""Seed one synthetic image fixture only in start-streaming-preview's disposable library."""
import datetime
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import sys
import zlib

ready_path = Path(sys.argv[1]).resolve()
ready = json.loads(ready_path.read_text())
root = Path(ready['data']).resolve()
assert root == ready_path.parent and root.name.startswith('reader-frontend-preview-')
identifier = 'streaming-synthetic-image'
analysis = root / 'cache' / identifier / 'analysis'
assets = analysis / 'assets'
assets.mkdir(parents=True, exist_ok=False)

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

width, height = 128, 96
pixels = b''.join(b'\x00' + b''.join(bytes((230, 30, 30) if x < 64 else (30, 60, 220)) for x in range(width)) for _ in range(height))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
(assets / 'p1-b1.png').write_bytes(png)
shutil.copyfile(Path(__file__).resolve().parents[1] / 'public/samples/reading-notes.pdf', root / 'papers' / (identifier + '.pdf'))
(analysis / 'manifest.json').write_text(json.dumps({'pages': 2, 'blocks': [{'id': 'p1-b1', 'page': 1, 'label': 'synthetic colors', 'bounds': {'x': .1, 'y': .1, 'width': .3, 'height': .4}, 'text': '', 'image': 'assets/p1-b1.png'}], 'warnings': []}))
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
with sqlite3.connect(root / 'reader.sqlite') as connection:
    connection.execute("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES(?,?,?,?,?,?,?)", (identifier, 'pdf', 'Synthetic image streaming test', '', len(png), now, now))
print(json.dumps({'documentId': identifier, 'blockId': 'p1-b1', 'source': 'synthetic red-left blue-right; seeded layout, no extraction test'}))
