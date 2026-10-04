#!/usr/bin/env python3
"""ทดสอบ src/worker.js ในเบราว์เซอร์โดยไม่ต้องมี Node.js

    set RX_TEST_DB=%TEMP%\\rx-worker-test.db
    python tools/worker_dev.py            # เปิด http://127.0.0.1:8769

หน้าเว็บโหลด tools/worker_harness.js ซึ่งรันโค้ด Worker จริงในเบราว์เซอร์
และส่ง SQL มาที่ /__d1 ให้รันบน SQLite ชั่วคราว (จำลอง D1)
ใช้ทดสอบเท่านั้น ห้ามชี้ไปที่ฐานข้อมูลจริง
"""
import json
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("RX_TEST_DB")
PORT = int(os.environ.get("PORT", "8769"))
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".json": "application/json"}
FILES = {"/src/worker.js": ROOT / "src" / "worker.js", "/modules.json": ROOT / "modules.json",
         "/__harness.js": ROOT / "tools" / "worker_harness.js"}


def run_sql(statements):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        out = []
        with conn:  # ทั้งชุดอยู่ในทรานแซกชันเดียวเหมือน D1 batch
            for s in statements:
                cur = conn.execute(s["sql"], s.get("params") or [])
                results = [dict(r) for r in cur.fetchall()]
                out.append({"results": results, "success": True,
                            "meta": {"last_row_id": cur.lastrowid, "changes": cur.rowcount if cur.rowcount > 0 else 0}})
        return out
    finally:
        conn.close()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
            html = html.replace('<script src="app.js"></script>', '<script type="module" src="/__harness.js"></script>')
            return self.send(200, html.encode(), TYPES[".html"])
        target = FILES.get(path) or (ROOT / "static" / path.lstrip("/")).resolve()
        if not target.is_file() or not (target in FILES.values() or target.is_relative_to(ROOT / "static")):
            return self.send(404, b"not found", "text/plain")
        self.send(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self):
        if urlparse(self.path).path != "/__d1":
            return self.send(404, b"not found", "text/plain")
        statements = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        try:
            payload, status = run_sql(statements), 200
        except sqlite3.Error as err:
            payload, status = {"error": f"D1_ERROR: {err}"}, 500
        self.send(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json")

    def send(self, status, data, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    if not DB_PATH or Path(DB_PATH).resolve().parent == (ROOT / "data").resolve():
        sys.exit("ตั้ง RX_TEST_DB เป็นไฟล์ฐานข้อมูลชั่วคราวก่อน (ห้ามใช้ data/)")
    print(f"ทดสอบ Worker ที่ http://127.0.0.1:{PORT}  ฐานข้อมูล: {DB_PATH}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
