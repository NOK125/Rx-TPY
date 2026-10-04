#!/usr/bin/env python3
"""Rx-TPY — ระบบบันทึกงานบริการเภสัชกรรม โรงพยาบาลตาพระยา

ใช้แค่ Python standard library (http.server + sqlite3) ไม่ต้องติดตั้งไลบรารีเพิ่ม
รัน:  python server.py --open   แล้วเปิด http://127.0.0.1:8100
"""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import sys
import traceback
import webbrowser
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = Path(os.environ.get("RX_DB", BASE_DIR / "data" / "rx.db"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8100"))
SESSION_HOURS = 12
COOKIE_NAME = "rx_tpy_session"
MAX_BODY = 1024 * 1024

ROLES = {"admin": "ผู้ดูแลระบบ", "pharmacist": "เภสัชกร"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
-- บันทึกของทุกงาน ช่องเฉพาะของแต่ละงานเก็บใน data (JSON) ตามนิยามใน MODULES
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    module TEXT NOT NULL,
    record_date TEXT NOT NULL,
    hn TEXT,
    patient_name TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    deleted_at TEXT
);
-- ประวัติการสร้าง แก้ไข และลบ เก็บข้อมูลทั้งชุด ณ ตอนนั้น
CREATE TABLE IF NOT EXISTS record_log (
    id INTEGER PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id),
    action TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_module_date ON records(module, record_date);
CREATE INDEX IF NOT EXISTS idx_rec_hn ON records(hn);
CREATE INDEX IF NOT EXISTS idx_log_record ON record_log(record_id);
"""

# ---------- นิยามงานบริการ ----------
# นิยามทุกงานอยู่ใน modules.json ใช้ร่วมกับ src/worker.js (เวอร์ชัน Cloudflare)
# type: text, textarea, number, date, select, multi (เลือกได้หลายข้อ), staff (รายชื่อผู้ใช้)
# patient = มีช่อง HN และชื่อผู้ป่วย, list = ช่องที่แสดงในตาราง, stats = ช่องที่นับสรุปรายเดือน
MODULES = json.loads((BASE_DIR / "modules.json").read_text(encoding="utf-8"))
MODULE_BY_KEY = {m["key"]: m for m in MODULES}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Request:
    def __init__(self, conn, body, query, user):
        self.conn = conn
        self.body = body
        self.query = query
        self.user = user
        self.cookies = []

    def q(self, name, default=""):
        return (self.query.get(name) or [default])[0]


def now():
    return datetime.now().isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()


def rows(cursor):
    return [dict(r) for r in cursor.fetchall()]


# ---------- แปลงและตรวจค่าที่ส่งเข้ามา ----------

def to_str(value, label, required=False, max_len=200):
    text = "" if value is None else str(value).strip()
    if not text:
        if required:
            raise ApiError(400, f"กรุณาระบุ{label}")
        return None
    if len(text) > max_len:
        raise ApiError(400, f"{label}ยาวเกิน {max_len} ตัวอักษร")
    return text


def to_num(value, label, required=False, minimum=None, maximum=None):
    if value is None or value == "":
        if required:
            raise ApiError(400, f"กรุณาระบุ{label}")
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{label}ต้องเป็นตัวเลข")
    if not math.isfinite(number):
        raise ApiError(400, f"{label}ต้องเป็นตัวเลข")
    if minimum is not None and number < minimum:
        raise ApiError(400, f"{label}ต้องไม่น้อยกว่า {minimum:g}")
    if maximum is not None and number > maximum:
        raise ApiError(400, f"{label}ต้องไม่เกิน {maximum:g}")
    return int(number) if number.is_integer() else number


def to_date(value, label, required=False):
    text = to_str(value, label, required, 10)
    if text is None:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        raise ApiError(400, f"{label}ไม่ถูกต้อง")


def to_bool(value):
    return value in (True, 1, "1", "true", "on")


# ---------- บัญชีผู้ใช้และการล็อกอิน ----------

def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        _, iterations, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, AttributeError):
        return False


def valid_password(password):
    password = "" if password is None else str(password)
    if len(password) < 6:
        raise ApiError(400, "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร")
    return password


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(row):
    if row is None:
        return None
    user = dict(row)
    user.pop("password_hash", None)
    return user


def user_from_cookie(conn, header):
    if not header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(header)
    except Exception:
        return None
    if COOKIE_NAME not in cookie:
        return None
    row = conn.execute(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1",
        (token_hash(cookie[COOKIE_NAME].value), now())).fetchone()
    return public_user(row)


def start_session(req, user_id):
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(hours=SESSION_HOURS)
    req.conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
    req.conn.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                     (token_hash(token), user_id, expires.isoformat(timespec="seconds")))
    req.cookies.append(f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_HOURS * 3600}")


def get_user(conn, user_id):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise ApiError(404, "ไม่พบผู้ใช้นี้")
    return public_user(row)


def setup_status(req):
    count = req.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"needs_setup": count == 0}


def setup(req):
    """สร้างบัญชีผู้ดูแลระบบคนแรก ทำได้ครั้งเดียวตอนยังไม่มีผู้ใช้"""
    if not setup_status(req)["needs_setup"]:
        raise ApiError(409, "ระบบตั้งค่าไปแล้ว")
    b = req.body
    username = to_str(b.get("username"), "ชื่อผู้ใช้", True, 50)
    full_name = to_str(b.get("full_name"), "ชื่อ-นามสกุล", True)
    password = valid_password(b.get("password"))
    user_id = req.conn.execute(
        "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
        (username, full_name, hash_password(password), now())).lastrowid
    start_session(req, user_id)
    return get_user(req.conn, user_id)


def login(req):
    username = to_str(req.body.get("username"), "ชื่อผู้ใช้", True, 50)
    password = str(req.body.get("password") or "")
    row = req.conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not check_password(password, row["password_hash"]):
        raise ApiError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    if not row["active"]:
        raise ApiError(403, "บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ")
    start_session(req, row["id"])
    return public_user(row)


def logout(req):
    req.conn.execute("DELETE FROM sessions WHERE user_id = ?", (req.user["id"],))
    req.cookies.append(f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    return {"ok": True}


def me(req):
    return req.user


def change_password(req):
    row = req.conn.execute("SELECT password_hash FROM users WHERE id = ?", (req.user["id"],)).fetchone()
    if not check_password(str(req.body.get("old_password") or ""), row["password_hash"]):
        raise ApiError(400, "รหัสผ่านเดิมไม่ถูกต้อง")
    password = valid_password(req.body.get("new_password"))
    req.conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), req.user["id"]))
    return {"ok": True}


# ---------- ผู้ใช้ ----------

def list_users(req):
    return [public_user(r) for r in req.conn.execute("SELECT * FROM users ORDER BY role, full_name")]


def list_staff(req):
    """รายชื่อผู้ใช้ที่ยังใช้งาน สำหรับเลือกในตารางเวร"""
    return [r[0] for r in req.conn.execute("SELECT full_name FROM users WHERE active = 1 ORDER BY full_name")]


def save_user(req, user_id=None):
    b = req.body
    full_name = to_str(b.get("full_name"), "ชื่อ-นามสกุล", True)
    role = b.get("role")
    if role not in ROLES:
        raise ApiError(400, "กรุณาเลือกสิทธิ์ผู้ใช้")
    active = 1 if to_bool(b.get("active", True)) else 0
    password = b.get("password")
    if user_id:
        if user_id == req.user["id"] and (role != "admin" or not active):
            raise ApiError(400, "ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้")
        get_user(req.conn, user_id)
        req.conn.execute("UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?",
                         (full_name, role, active, user_id))
        if password:
            req.conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                             (hash_password(valid_password(password)), user_id))
            req.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        if not active:
            req.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    else:
        username = to_str(b.get("username"), "ชื่อผู้ใช้", True, 50)
        if not re.fullmatch(r"[A-Za-z0-9._-]+", username):
            raise ApiError(400, "ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข . _ -")
        try:
            user_id = req.conn.execute(
                "INSERT INTO users (username, full_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (username, full_name, hash_password(valid_password(password)), role, active, now())).lastrowid
        except sqlite3.IntegrityError:
            raise ApiError(409, f"ชื่อผู้ใช้ {username} มีอยู่แล้ว")
    return get_user(req.conn, user_id)


def create_user(req):
    return save_user(req)


def update_user(req, user_id):
    return save_user(req, user_id)


# ---------- บันทึกงานบริการ ----------

def list_modules(req):
    return MODULES


def get_module(key):
    module = MODULE_BY_KEY.get(key)
    if module is None:
        raise ApiError(400, "ไม่พบงานนี้")
    return module


def clean_field(field, value):
    label, kind = field["label"], field["type"]
    required = field.get("required", False)
    if kind == "number":
        return to_num(value, label, required, field.get("min"), field.get("max"))
    if kind == "date":
        return to_date(value, label, required)
    if kind == "multi":
        values = value if isinstance(value, list) else ([] if value in (None, "") else [value])
        values = [str(v) for v in values]
        if any(v not in field["options"] for v in values):
            raise ApiError(400, f"{label}: ตัวเลือกไม่ถูกต้อง")
        if required and not values:
            raise ApiError(400, f"กรุณาเลือก{label}")
        return [v for v in field["options"] if v in values] or None
    text = to_str(value, label, required, 2000 if kind == "textarea" else 200)
    if kind == "select" and text is not None and text not in field["options"]:
        raise ApiError(400, f"{label}: ตัวเลือกไม่ถูกต้อง")
    return text


def record_values(module, body):
    record_date = to_date(body.get("record_date"), module.get("date_label", "วันที่"), True)
    hn = patient_name = None
    if module.get("patient"):
        need = not module.get("patient_optional")
        hn = to_str(body.get("hn"), "HN", need, 20)
        patient_name = to_str(body.get("patient_name"), "ชื่อผู้ป่วย", need)
    data = {}
    for field in module["fields"]:
        value = clean_field(field, body.get(field["name"]))
        if value is not None:
            data[field["name"]] = value
    return record_date, hn, patient_name, data


RECORD_SELECT = """
    SELECT r.*, cu.full_name AS created_by_name, uu.full_name AS updated_by_name
    FROM records r
    JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users uu ON uu.id = r.updated_by
"""


def record_dict(row):
    rec = dict(row)
    rec["data"] = json.loads(rec["data"])
    return rec


def get_record(conn, record_id):
    row = conn.execute(RECORD_SELECT + " WHERE r.id = ? AND r.deleted_at IS NULL", (record_id,)).fetchone()
    if row is None:
        raise ApiError(404, "ไม่พบบันทึกนี้")
    return record_dict(row)


def log_record(req, record_id, action):
    snapshot = dict(req.conn.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone())
    req.conn.execute("INSERT INTO record_log (record_id, action, snapshot, user_id, ts) VALUES (?, ?, ?, ?, ?)",
                     (record_id, action, json.dumps(snapshot, ensure_ascii=False), req.user["id"], now()))


def list_records(req):
    where, params = ["r.deleted_at IS NULL"], []
    if req.q("module"):
        get_module(req.q("module"))
        where.append("r.module = ?")
        params.append(req.q("module"))
    month = req.q("month")
    if re.fullmatch(r"\d{4}-\d{2}", month):
        where.append("r.record_date LIKE ?")
        params.append(month + "-%")
    hn = req.q("hn").strip()
    if hn:
        where.append("r.hn = ?")
        params.append(hn)
    text = req.q("q").strip()
    if text:
        where.append("(r.hn LIKE ? OR r.patient_name LIKE ? OR r.data LIKE ?)")
        params += [f"%{text}%"] * 3
    return [record_dict(r) for r in req.conn.execute(
        RECORD_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY r.record_date DESC, r.id DESC LIMIT 3000", params)]


def get_record_endpoint(req, record_id):
    return get_record(req.conn, record_id)


def create_record(req):
    module = get_module(req.body.get("module"))
    record_date, hn, patient_name, data = record_values(module, req.body)
    record_id = req.conn.execute(
        "INSERT INTO records (module, record_date, hn, patient_name, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (module["key"], record_date, hn, patient_name, json.dumps(data, ensure_ascii=False), req.user["id"], now())).lastrowid
    log_record(req, record_id, "create")
    return get_record(req.conn, record_id)


MAX_IMPORT = 500


def import_records(req):
    """นำเข้าหลายแถวพร้อมกัน (เช่น จาก Excel) ผิดแถวเดียวไม่บันทึกทั้งชุด"""
    module = get_module(req.body.get("module"))
    rows_in = req.body.get("rows")
    if not isinstance(rows_in, list) or not rows_in:
        raise ApiError(400, "ไม่มีข้อมูลที่จะนำเข้า")
    if len(rows_in) > MAX_IMPORT:
        raise ApiError(400, f"นำเข้าได้ครั้งละไม่เกิน {MAX_IMPORT} แถว")
    values = []
    for i, row in enumerate(rows_in, 1):
        if not isinstance(row, dict):
            raise ApiError(400, f"แถวที่ {i}: ข้อมูลไม่ถูกต้อง")
        try:
            values.append(record_values(module, row))
        except ApiError as err:
            raise ApiError(400, f"แถวที่ {row.get('_row', i)}: {err.message}")
    ts = now()
    for record_date, hn, patient_name, data in values:
        record_id = req.conn.execute(
            "INSERT INTO records (module, record_date, hn, patient_name, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (module["key"], record_date, hn, patient_name, json.dumps(data, ensure_ascii=False), req.user["id"], ts)).lastrowid
        log_record(req, record_id, "import")
    return {"inserted": len(values)}


def can_edit(req, rec):
    if req.user["role"] != "admin" and rec["created_by"] != req.user["id"]:
        raise ApiError(403, "แก้ไขได้เฉพาะผู้บันทึกหรือผู้ดูแลระบบ")


def update_record(req, record_id):
    rec = get_record(req.conn, record_id)
    can_edit(req, rec)
    record_date, hn, patient_name, data = record_values(get_module(rec["module"]), req.body)
    req.conn.execute(
        "UPDATE records SET record_date = ?, hn = ?, patient_name = ?, data = ?, updated_by = ?, updated_at = ? WHERE id = ?",
        (record_date, hn, patient_name, json.dumps(data, ensure_ascii=False), req.user["id"], now(), record_id))
    log_record(req, record_id, "update")
    return get_record(req.conn, record_id)


def delete_record(req, record_id):
    """ลบแบบซ่อน ข้อมูลยังอยู่ในฐานข้อมูลและประวัติ"""
    get_record(req.conn, record_id)
    req.conn.execute("UPDATE records SET deleted_at = ? WHERE id = ?", (now(), record_id))
    log_record(req, record_id, "delete")
    return {"ok": True}


def record_history(req, record_id):
    get_record(req.conn, record_id)
    result = rows(req.conn.execute(
        """SELECT l.action, l.ts, l.snapshot, u.full_name AS user_name
           FROM record_log l JOIN users u ON u.id = l.user_id WHERE l.record_id = ? ORDER BY l.id""", (record_id,)))
    for entry in result:
        entry["snapshot"] = record_dict(json.loads(entry["snapshot"]))
    return result


# ---------- ภาพรวม ----------

def summary(req):
    today = date.today()
    month = req.q("month") if re.fullmatch(r"\d{4}-\d{2}", req.q("month")) else today.isoformat()[:7]
    conn = req.conn
    counts = {r[0]: r[1] for r in conn.execute(
        "SELECT module, COUNT(*) FROM records WHERE deleted_at IS NULL AND record_date LIKE ? GROUP BY module",
        (month + "-%",))}
    # นัดหมายจากบันทึกล่าสุดของผู้ป่วยแต่ละคนในแต่ละคลินิก: ขาดนัดไม่เกิน 30 วัน และนัดใน 14 วันข้างหน้า
    appointments = [record_dict(r) for r in conn.execute(
        RECORD_SELECT + """ WHERE r.id IN (SELECT MAX(id) FROM records WHERE deleted_at IS NULL AND hn IS NOT NULL
                                           GROUP BY module, hn)
            AND json_extract(r.data, '$.next_visit') BETWEEN ? AND ?
            ORDER BY json_extract(r.data, '$.next_visit'), r.patient_name""",
        ((today - timedelta(days=30)).isoformat(), (today + timedelta(days=14)).isoformat()))]
    duty_today = [record_dict(r) for r in conn.execute(
        RECORD_SELECT + " WHERE r.module = 'duty' AND r.deleted_at IS NULL AND r.record_date = ? ORDER BY r.id",
        (today.isoformat(),))]
    return {"month": month, "today": today.isoformat(), "counts": counts,
            "appointments": appointments, "duty_today": duty_today}


# ---------- เส้นทาง API ----------

ROUTES = []


def route(method, pattern, handler, access="user"):
    """access: public = ไม่ต้องล็อกอิน, user = ผู้ใช้ทุกคน, admin = ผู้ดูแลระบบเท่านั้น"""
    ROUTES.append((method, re.compile(f"^/api{pattern}$"), handler, access))


ID = r"(\d+)"
route("GET", "/setup", setup_status, "public")
route("POST", "/setup", setup, "public")
route("POST", "/login", login, "public")
route("POST", "/logout", logout)
route("GET", "/me", me)
route("POST", "/me/password", change_password)
route("GET", "/users", list_users, "admin")
route("POST", "/users", create_user, "admin")
route("PUT", f"/users/{ID}", update_user, "admin")
route("GET", "/staff", list_staff)
route("GET", "/modules", list_modules)
route("GET", "/records", list_records)
route("POST", "/records", create_record)
route("POST", "/records/import", import_records)
route("GET", f"/records/{ID}", get_record_endpoint)
route("PUT", f"/records/{ID}", update_record)
route("POST", f"/records/{ID}/delete", delete_record, "admin")
route("GET", f"/records/{ID}/history", record_history)
route("GET", "/summary", summary)

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "RxTPY/0.1"

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def dispatch(self, method):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            if method != "GET":
                return self.send_json(405, {"error": "Method not allowed"})
            return self.serve_static(url.path)
        cookies = []
        try:
            if method != "GET" and not (self.headers.get("Content-Type") or "").startswith("application/json"):
                raise ApiError(415, "ต้องส่งข้อมูลเป็น JSON")
            body = self.read_json() if method != "GET" else {}
            for route_method, pattern, handler, access in ROUTES:
                match = pattern.match(url.path)
                if route_method != method or not match:
                    continue
                conn = connect()
                try:
                    with conn:
                        req = Request(conn, body, parse_qs(url.query), user_from_cookie(conn, self.headers.get("Cookie")))
                        if access != "public" and req.user is None:
                            raise ApiError(401, "กรุณาเข้าสู่ระบบ")
                        if access == "admin" and req.user["role"] != "admin":
                            raise ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้น")
                        result = handler(req, *[int(g) for g in match.groups()])
                        cookies = req.cookies
                finally:
                    conn.close()
                return self.send_json(200, result, cookies)
            raise ApiError(404, "ไม่พบ API นี้")
        except ApiError as err:
            self.send_json(err.status, {"error": err.message})
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "เกิดข้อผิดพลาดในเซิร์ฟเวอร์"})

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "ข้อมูลใหญ่เกินไป")
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "ข้อมูลที่ส่งมาไม่ใช่ JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "ข้อมูลที่ส่งมาต้องเป็น JSON object")
        return data

    def send_json(self, status, payload, cookies=()):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, path):
        target = (STATIC_DIR / (path.lstrip("/") or "index.html")).resolve()
        if not target.is_relative_to(STATIC_DIR) or not target.is_file():
            return self.send_json(404, {"error": "ไม่พบหน้านี้"})
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{'127.0.0.1' if HOST in ('0.0.0.0', '') else HOST}:{PORT}"
    print(f"Rx-TPY กำลังทำงานที่ {url}  (กด Ctrl+C เพื่อหยุด)")
    print(f"ฐานข้อมูล: {DB_PATH}")
    if "--open" in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nหยุดระบบแล้ว")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
