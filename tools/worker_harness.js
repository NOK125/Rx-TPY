// ชุดทดสอบ: รัน src/worker.js ในเบราว์เซอร์ แทน fetch("/api/...") ของหน้าเว็บ
// ฐานข้อมูลจำลอง D1 โดยส่ง SQL ไปให้ tools/worker_dev.py รันบน SQLite ชั่วคราว
import worker from "/src/worker.js";

const realFetch = window.fetch.bind(window);

async function run(statements) {
  const res = await realFetch("/__d1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(statements.map((s) => ({ sql: s.sql, params: s.params }))),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

class Statement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    if (params.some((p) => p === undefined)) throw new Error("D1_TYPE_ERROR: undefined ไม่รองรับ");
    return new Statement(this.sql, params);
  }
  async all() { return (await run([this]))[0]; }
  async first() { return (await this.all()).results[0] ?? null; }
  async run() { return (await run([this]))[0]; }
}

const env = { TEST_MODE: "1", DB: { prepare: (sql) => new Statement(sql), batch: (list) => run(list) } };
let jar = "";

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const headers = new Headers(init.headers);
  if (jar) headers.set("X-Rx-Cookie", jar);
  const res = await worker.fetch(new Request(url, { ...init, headers }), env);
  const cookie = res.headers.get("X-Rx-Set-Cookie");
  if (cookie) jar = /Max-Age=0/.test(cookie) ? "" : cookie.split(";")[0];
  return res;
};
window.__rx = { env, worker, cookie: () => jar, setCookie: (c) => (jar = c) };

const script = document.createElement("script");
script.src = "/app.js";
document.body.append(script);
