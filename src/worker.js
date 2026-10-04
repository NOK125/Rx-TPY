// Rx-TPY บน Cloudflare Workers + D1
// พอร์ตจาก server.py ให้ API เหมือนกันทุกเส้น หน้าเว็บ (static/) ใช้ร่วมกัน
// นิยามงานอยู่ใน modules.json ใช้ร่วมกับ server.py
import MODULES from "../modules.json" with { type: "json" };

const SESSION_HOURS = 12;
const COOKIE_NAME = "rx_tpy_session";
const PBKDF2_ITERATIONS = 100_000; // Workers รองรับ PBKDF2 ได้สูงสุด 100,000 รอบ
const MAX_BODY = 1024 * 1024;
const TZ_OFFSET_MS = 7 * 3600 * 1000; // เวลาประเทศไทย (Workers ใช้ UTC)

const ROLES = { admin: "ผู้ดูแลระบบ", pharmacist: "เภสัชกร" };
const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS records (
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
  )`,
  `CREATE TABLE IF NOT EXISTS record_log (
    id INTEGER PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id),
    action TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    ts TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_rec_module_date ON records(module, record_date)",
  "CREATE INDEX IF NOT EXISTS idx_rec_hn ON records(hn)",
  "CREATE INDEX IF NOT EXISTS idx_log_record ON record_log(record_id)",
];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// เวลาท้องถิ่นแบบ ISO ไม่มีโซนเวลา เหมือน datetime.now().isoformat(timespec="seconds")
const now = (offsetMs = 0) => new Date(Date.now() + TZ_OFFSET_MS + offsetMs).toISOString().slice(0, 19);
const today = () => now().slice(0, 10);
function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- แปลงและตรวจค่าที่ส่งเข้ามา ----------

function toStr(value, label, required = false, maxLen = 200) {
  const text = value == null ? "" : String(value).trim();
  if (!text) {
    if (required) throw new ApiError(400, `กรุณาระบุ${label}`);
    return null;
  }
  if ([...text].length > maxLen) throw new ApiError(400, `${label}ยาวเกิน ${maxLen} ตัวอักษร`);
  return text;
}

function toNum(value, label, required = false, minimum = null, maximum = null) {
  if (value == null || value === "") {
    if (required) throw new ApiError(400, `กรุณาระบุ${label}`);
    return null;
  }
  const number = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(number)) throw new ApiError(400, `${label}ต้องเป็นตัวเลข`);
  if (minimum != null && number < minimum) throw new ApiError(400, `${label}ต้องไม่น้อยกว่า ${minimum}`);
  if (maximum != null && number > maximum) throw new ApiError(400, `${label}ต้องไม่เกิน ${maximum}`);
  return number;
}

function toDate(value, label, required = false) {
  const text = toStr(value, label, required, 10);
  if (text == null) return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + "T00:00:00Z").toISOString().startsWith(text);
  if (!valid) throw new ApiError(400, `${label}ไม่ถูกต้อง`);
  return text;
}

const toBool = (value) => [true, 1, "1", "true", "on"].includes(value);

// ---------- รหัสผ่านและเซสชัน ----------

const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text) => new Uint8Array(text.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function checkPassword(password, stored) {
  try {
    const [, iterations, salt, digest] = stored.split("$");
    const rounds = Number(iterations);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > PBKDF2_ITERATIONS) return false;
    return sameText(hex(await pbkdf2(password, fromHex(salt), rounds)), digest);
  } catch {
    return false;
  }
}

function validPassword(password) {
  const text = password == null ? "" : String(password);
  if (text.length < 6) throw new ApiError(400, "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร");
  return text;
}

const tokenHash = async (token) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...user } = row;
  return user;
}

function readCookie(header, name) {
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function userFromCookie(db, header) {
  const token = readCookie(header, COOKIE_NAME);
  if (!token) return null;
  const row = await db.prepare(
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1",
  ).bind(await tokenHash(token), now()).first();
  return publicUser(row);
}

function sessionCookie(req, value, maxAge) {
  const secure = req.url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function startSession(req, userId) {
  const token = newToken();
  await req.db.batch([
    req.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now()),
    req.db.prepare("INSERT INTO sessions VALUES (?, ?, ?)")
      .bind(await tokenHash(token), userId, now(SESSION_HOURS * 3600 * 1000)),
  ]);
  req.cookies.push(sessionCookie(req, token, SESSION_HOURS * 3600));
}

async function getUser(db, userId) {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  if (!row) throw new ApiError(404, "ไม่พบผู้ใช้นี้");
  return publicUser(row);
}

// ---------- บัญชีผู้ใช้และการล็อกอิน ----------

async function setupStatus(req) {
  const row = await req.db.prepare("SELECT COUNT(*) AS n FROM users").first();
  return { needs_setup: row.n === 0 };
}

async function setup(req) {
  if (!(await setupStatus(req)).needs_setup) throw new ApiError(409, "ระบบตั้งค่าไปแล้ว");
  const b = req.body;
  const username = toStr(b.username, "ชื่อผู้ใช้", true, 50);
  const fullName = toStr(b.full_name, "ชื่อ-นามสกุล", true);
  const password = validPassword(b.password);
  const result = await req.db.prepare(
    "INSERT INTO users (username, full_name, password_hash, role, created_at) SELECT ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users)",
  ).bind(username, fullName, await hashPassword(password), now()).run();
  if (!result.meta.changes) throw new ApiError(409, "ระบบตั้งค่าไปแล้ว");
  await startSession(req, result.meta.last_row_id);
  return getUser(req.db, result.meta.last_row_id);
}

async function login(req) {
  const username = toStr(req.body.username, "ชื่อผู้ใช้", true, 50);
  const password = String(req.body.password ?? "");
  const row = await req.db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!row || !(await checkPassword(password, row.password_hash))) throw new ApiError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  if (!row.active) throw new ApiError(403, "บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ");
  await startSession(req, row.id);
  return publicUser(row);
}

async function logout(req) {
  await req.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(req.user.id).run();
  req.cookies.push(sessionCookie(req, "", 0));
  return { ok: true };
}

const me = (req) => req.user;

async function changePassword(req) {
  const row = await req.db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(req.user.id).first();
  if (!(await checkPassword(String(req.body.old_password ?? ""), row.password_hash))) {
    throw new ApiError(400, "รหัสผ่านเดิมไม่ถูกต้อง");
  }
  const password = validPassword(req.body.new_password);
  await req.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), req.user.id).run();
  return { ok: true };
}

// ---------- ผู้ใช้ ----------

async function listUsers(req) {
  const { results } = await req.db.prepare("SELECT * FROM users ORDER BY role, full_name").all();
  return results.map(publicUser);
}

async function listStaff(req) {
  const { results } = await req.db.prepare("SELECT full_name FROM users WHERE active = 1 ORDER BY full_name").all();
  return results.map((r) => r.full_name);
}

async function saveUser(req, userId = null) {
  const b = req.body;
  const fullName = toStr(b.full_name, "ชื่อ-นามสกุล", true);
  const role = b.role;
  if (!Object.hasOwn(ROLES, role)) throw new ApiError(400, "กรุณาเลือกสิทธิ์ผู้ใช้");
  const active = toBool(b.active ?? true) ? 1 : 0;
  const password = b.password;
  const db = req.db;
  if (userId) {
    if (userId === req.user.id && (role !== "admin" || !active)) {
      throw new ApiError(400, "ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้");
    }
    await getUser(db, userId);
    const statements = [db.prepare("UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?").bind(fullName, role, active, userId)];
    if (password) {
      statements.push(db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(validPassword(password)), userId));
    }
    if (password || !active) statements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId));
    await db.batch(statements);
  } else {
    const username = toStr(b.username, "ชื่อผู้ใช้", true, 50);
    if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new ApiError(400, "ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข . _ -");
    const hash = await hashPassword(validPassword(password));
    try {
      const result = await db.prepare(
        "INSERT INTO users (username, full_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(username, fullName, hash, role, active, now()).run();
      userId = result.meta.last_row_id;
    } catch (err) {
      if (/UNIQUE/i.test(String(err.message))) throw new ApiError(409, `ชื่อผู้ใช้ ${username} มีอยู่แล้ว`);
      throw err;
    }
  }
  return getUser(db, userId);
}

const createUser = (req) => saveUser(req);
const updateUser = (req, userId) => saveUser(req, userId);

// ---------- บันทึกงานบริการ ----------

const listModules = () => MODULES;

function getModule(key) {
  const module = typeof key === "string" && Object.hasOwn(MODULE_BY_KEY, key) ? MODULE_BY_KEY[key] : null;
  if (!module) throw new ApiError(400, "ไม่พบงานนี้");
  return module;
}

function cleanField(field, value) {
  const { label, type } = field;
  const required = Boolean(field.required);
  if (type === "number") return toNum(value, label, required, field.min, field.max);
  if (type === "date") return toDate(value, label, required);
  if (type === "multi") {
    const values = (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map(String);
    if (values.some((v) => !field.options.includes(v))) throw new ApiError(400, `${label}: ตัวเลือกไม่ถูกต้อง`);
    if (required && !values.length) throw new ApiError(400, `กรุณาเลือก${label}`);
    const chosen = field.options.filter((o) => values.includes(o));
    return chosen.length ? chosen : null;
  }
  const text = toStr(value, label, required, type === "textarea" ? 2000 : 200);
  if (type === "select" && text != null && !field.options.includes(text)) throw new ApiError(400, `${label}: ตัวเลือกไม่ถูกต้อง`);
  return text;
}

function recordValues(module, body) {
  const recordDate = toDate(body.record_date, module.date_label || "วันที่", true);
  let hn = null;
  let patientName = null;
  if (module.patient) {
    const need = !module.patient_optional;
    hn = toStr(body.hn, "HN", need, 20);
    patientName = toStr(body.patient_name, "ชื่อผู้ป่วย", need);
  }
  const data = {};
  for (const field of module.fields) {
    const value = cleanField(field, body[field.name]);
    if (value != null) data[field.name] = value;
  }
  return { recordDate, hn, patientName, data: JSON.stringify(data) };
}

const RECORD_SELECT = `
  SELECT r.*, cu.full_name AS created_by_name, uu.full_name AS updated_by_name
  FROM records r
  JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users uu ON uu.id = r.updated_by`;

function recordDict(row) {
  return { ...row, data: JSON.parse(row.data) };
}

async function getRecord(db, recordId) {
  const row = await db.prepare(RECORD_SELECT + " WHERE r.id = ? AND r.deleted_at IS NULL").bind(recordId).first();
  if (!row) throw new ApiError(404, "ไม่พบบันทึกนี้");
  return recordDict(row);
}

// เก็บข้อมูลทั้งแถว ณ ตอนนี้ลง record_log (recordId = null คือแถวที่เพิ่ง INSERT ในชุดคำสั่งเดียวกัน)
function logStatement(req, action, recordId) {
  return req.db.prepare(`INSERT INTO record_log (record_id, action, snapshot, user_id, ts)
    SELECT id, ?, json_object('id', id, 'module', module, 'record_date', record_date, 'hn', hn,
      'patient_name', patient_name, 'data', data, 'created_by', created_by, 'created_at', created_at,
      'updated_by', updated_by, 'updated_at', updated_at, 'deleted_at', deleted_at), ?, ?
    FROM records WHERE id = ${recordId == null ? "last_insert_rowid()" : "?"}`)
    .bind(...[action, req.user.id, now(), ...(recordId == null ? [] : [recordId])]);
}

async function listRecords(req) {
  const where = ["r.deleted_at IS NULL"];
  const params = [];
  const module = req.q("module");
  if (module) {
    getModule(module);
    where.push("r.module = ?");
    params.push(module);
  }
  const month = req.q("month");
  if (/^\d{4}-\d{2}$/.test(month)) {
    where.push("r.record_date LIKE ?");
    params.push(month + "-%");
  }
  const hn = req.q("hn").trim();
  if (hn) {
    where.push("r.hn = ?");
    params.push(hn);
  }
  const text = req.q("q").trim();
  if (text) {
    where.push("(r.hn LIKE ? OR r.patient_name LIKE ? OR r.data LIKE ?)");
    params.push(`%${text}%`, `%${text}%`, `%${text}%`);
  }
  const { results } = await req.db.prepare(
    RECORD_SELECT + " WHERE " + where.join(" AND ") + " ORDER BY r.record_date DESC, r.id DESC LIMIT 3000",
  ).bind(...params).all();
  return results.map(recordDict);
}

const getRecordEndpoint = (req, recordId) => getRecord(req.db, recordId);

async function createRecord(req) {
  const module = getModule(req.body.module);
  const v = recordValues(module, req.body);
  const [inserted] = await req.db.batch([
    req.db.prepare(
      "INSERT INTO records (module, record_date, hn, patient_name, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(module.key, v.recordDate, v.hn, v.patientName, v.data, req.user.id, now()),
    logStatement(req, "create", null),
  ]);
  return getRecord(req.db, inserted.meta.last_row_id);
}

const MAX_IMPORT = 500;

const SNAPSHOT_SQL = `json_object('id', id, 'module', module, 'record_date', record_date, 'hn', hn,
  'patient_name', patient_name, 'data', data, 'created_by', created_by, 'created_at', created_at,
  'updated_by', updated_by, 'updated_at', updated_at, 'deleted_at', deleted_at)`;

// นำเข้าหลายแถวพร้อมกัน (เช่น จาก Excel) ผิดแถวเดียวไม่บันทึกทั้งชุด
// ใช้คำสั่งเดียวผ่าน json_each เพราะ D1 จำกัดจำนวนคำสั่งต่อครั้งและจำนวนพารามิเตอร์ต่อคำสั่ง
async function importRecords(req) {
  const module = getModule(req.body.module);
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, "ไม่มีข้อมูลที่จะนำเข้า");
  if (rows.length > MAX_IMPORT) throw new ApiError(400, `นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT} แถว`);
  const values = rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ApiError(400, `แถวที่ ${i + 1}: ข้อมูลไม่ถูกต้อง`);
    try {
      const v = recordValues(module, row);
      return { record_date: v.recordDate, hn: v.hn, patient_name: v.patientName, data: v.data };
    } catch (err) {
      if (err instanceof ApiError) throw new ApiError(400, `แถวที่ ${row._row ?? i + 1}: ${err.message}`);
      throw err;
    }
  });
  const ts = now();
  await req.db.batch([
    req.db.prepare(`INSERT INTO records (module, record_date, hn, patient_name, data, created_by, created_at)
      SELECT ?, json_extract(value, '$.record_date'), json_extract(value, '$.hn'), json_extract(value, '$.patient_name'),
             json_extract(value, '$.data'), ?, ?
      FROM json_each(?) ORDER BY key`).bind(module.key, req.user.id, ts, JSON.stringify(values)),
    // แถวที่เพิ่งเพิ่มคือ id สุดท้าย n แถว (ทั้งชุดอยู่ในทรานแซกชันเดียว)
    req.db.prepare(`INSERT INTO record_log (record_id, action, snapshot, user_id, ts)
      SELECT id, 'import', ${SNAPSHOT_SQL}, ?, ? FROM records
      WHERE id > (SELECT MAX(id) FROM records) - ? ORDER BY id`).bind(req.user.id, ts, values.length),
  ]);
  return { inserted: values.length };
}

function canEdit(req, rec) {
  if (req.user.role !== "admin" && rec.created_by !== req.user.id) {
    throw new ApiError(403, "แก้ไขได้เฉพาะผู้บันทึกหรือผู้ดูแลระบบ");
  }
}

async function updateRecord(req, recordId) {
  const rec = await getRecord(req.db, recordId);
  canEdit(req, rec);
  const v = recordValues(getModule(rec.module), req.body);
  await req.db.batch([
    req.db.prepare(
      "UPDATE records SET record_date = ?, hn = ?, patient_name = ?, data = ?, updated_by = ?, updated_at = ? WHERE id = ?",
    ).bind(v.recordDate, v.hn, v.patientName, v.data, req.user.id, now(), recordId),
    logStatement(req, "update", recordId),
  ]);
  return getRecord(req.db, recordId);
}

// ลบแบบซ่อน ข้อมูลยังอยู่ในฐานข้อมูลและประวัติ
async function deleteRecord(req, recordId) {
  await getRecord(req.db, recordId);
  await req.db.batch([
    req.db.prepare("UPDATE records SET deleted_at = ? WHERE id = ?").bind(now(), recordId),
    logStatement(req, "delete", recordId),
  ]);
  return { ok: true };
}

async function recordHistory(req, recordId) {
  await getRecord(req.db, recordId);
  const { results } = await req.db.prepare(
    `SELECT l.action, l.ts, l.snapshot, u.full_name AS user_name
     FROM record_log l JOIN users u ON u.id = l.user_id WHERE l.record_id = ? ORDER BY l.id`,
  ).bind(recordId).all();
  return results.map((entry) => ({ ...entry, snapshot: recordDict(JSON.parse(entry.snapshot)) }));
}

// ---------- ภาพรวม ----------

async function summary(req) {
  const day = today();
  const month = /^\d{4}-\d{2}$/.test(req.q("month")) ? req.q("month") : day.slice(0, 7);
  const db = req.db;
  const [counts, appointments, duty] = await db.batch([
    db.prepare("SELECT module, COUNT(*) AS n FROM records WHERE deleted_at IS NULL AND record_date LIKE ? GROUP BY module")
      .bind(month + "-%"),
    // นัดหมายจากบันทึกล่าสุดของผู้ป่วยแต่ละคนในแต่ละคลินิก: ขาดนัดไม่เกิน 30 วัน และนัดใน 14 วันข้างหน้า
    db.prepare(RECORD_SELECT + ` WHERE r.id IN (SELECT MAX(id) FROM records WHERE deleted_at IS NULL AND hn IS NOT NULL
                                               GROUP BY module, hn)
        AND json_extract(r.data, '$.next_visit') BETWEEN ? AND ?
        ORDER BY json_extract(r.data, '$.next_visit'), r.patient_name`).bind(addDays(day, -30), addDays(day, 14)),
    db.prepare(RECORD_SELECT + " WHERE r.module = 'duty' AND r.deleted_at IS NULL AND r.record_date = ? ORDER BY r.id").bind(day),
  ]);
  return {
    month,
    today: day,
    counts: Object.fromEntries(counts.results.map((r) => [r.module, r.n])),
    appointments: appointments.results.map(recordDict),
    duty_today: duty.results.map(recordDict),
  };
}

// ---------- เส้นทาง API ----------

const ROUTES = [];

// access: public = ไม่ต้องล็อกอิน, user = ผู้ใช้ทุกคน, admin = ผู้ดูแลระบบเท่านั้น
function route(method, pattern, handler, access = "user") {
  ROUTES.push([method, new RegExp(`^/api${pattern}$`), handler, access]);
}

const ID = "(\\d+)";
route("GET", "/setup", setupStatus, "public");
route("POST", "/setup", setup, "public");
route("POST", "/login", login, "public");
route("POST", "/logout", logout);
route("GET", "/me", me);
route("POST", "/me/password", changePassword);
route("GET", "/users", listUsers, "admin");
route("POST", "/users", createUser, "admin");
route("PUT", `/users/${ID}`, updateUser, "admin");
route("GET", "/staff", listStaff);
route("GET", "/modules", listModules);
route("GET", "/records", listRecords);
route("POST", "/records", createRecord);
route("POST", "/records/import", importRecords);
route("GET", `/records/${ID}`, getRecordEndpoint);
route("PUT", `/records/${ID}`, updateRecord);
route("POST", `/records/${ID}/delete`, deleteRecord, "admin");
route("GET", `/records/${ID}/history`, recordHistory);
route("GET", "/summary", summary);

let schemaReady = null;
function ensureSchema(db) {
  schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

function json(status, payload, cookies = [], testMode = false) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
    // ชุดทดสอบในเบราว์เซอร์อ่าน Set-Cookie ไม่ได้ จึงส่งซ้ำในหัวข้อนี้เฉพาะตอนทดสอบ
    if (testMode) headers.append("X-Rx-Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

async function readJson(request) {
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY) throw new ApiError(413, "ข้อมูลใหญ่เกินไป");
  if (!text) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, "ข้อมูลที่ส่งมาไม่ใช่ JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "ข้อมูลที่ส่งมาต้องเป็น JSON object");
  return data;
}

async function handleApi(request, env, url) {
  const testMode = Boolean(env.TEST_MODE);
  const method = request.method;
  try {
    if (!["GET", "POST", "PUT"].includes(method)) throw new ApiError(405, "Method not allowed");
    // กัน CSRF: คำขอที่เปลี่ยนข้อมูลต้องเป็น JSON ซึ่งฟอร์มจากเว็บอื่นส่งไม่ได้
    if (method !== "GET" && !(request.headers.get("Content-Type") || "").startsWith("application/json")) {
      throw new ApiError(415, "ต้องส่งข้อมูลเป็น JSON");
    }
    const body = method !== "GET" ? await readJson(request) : {};
    for (const [routeMethod, pattern, handler, access] of ROUTES) {
      const match = url.pathname.match(pattern);
      if (routeMethod !== method || !match) continue;
      const db = env.DB;
      await ensureSchema(db);
      const cookieHeader = request.headers.get("Cookie") ?? (testMode ? request.headers.get("X-Rx-Cookie") : null);
      const req = {
        db, body, url, cookies: [],
        user: await userFromCookie(db, cookieHeader),
        q: (name) => url.searchParams.get(name) ?? "",
      };
      if (access !== "public" && !req.user) throw new ApiError(401, "กรุณาเข้าสู่ระบบ");
      if (access === "admin" && req.user.role !== "admin") throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้น");
      const result = await handler(req, ...match.slice(1).map(Number));
      return json(200, result, req.cookies, testMode);
    }
    throw new ApiError(404, "ไม่พบ API นี้");
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
