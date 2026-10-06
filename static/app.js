"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $("#view");
const dlg = $("#dlg");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v == null || v === "" ? "-" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 }));
const pad = (n) => String(n).padStart(2, "0");
// วันที่ปัจจุบันตามเวลาเครื่อง รูปแบบ 2026-10-04
const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${TH_MONTHS[m - 1]} ${Number(y) + 543}`; };

// วันที่แบบไทย: 26/09/2569 21:19
function when(ts, withTime = true) {
  if (!ts) return "-";
  const [d, t = ""] = ts.split("T");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${Number(y) + 543}${withTime && t ? " " + t.slice(0, 5) : ""}`;
}

let me = null;
let unauthorized = () => {};

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") unauthorized();
  if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 2500);
}

// ---------- ส่วนประกอบหน้าจอ ----------

function table(headers, rowsHtml, emptyText) {
  if (!rowsHtml.length) return `<p class="empty">${esc(emptyText)}</p>`;
  const th = headers.map((h) => (Array.isArray(h) ? `<th class="${h[1]}">${esc(h[0])}</th>` : `<th>${esc(h)}</th>`));
  const td = (c) => (Array.isArray(c) ? `<td class="${c[1]}">${c[0]}</td>` : `<td>${c}</td>`);
  return `<div class="table-wrap"><table><thead><tr>${th.join("")}</tr></thead><tbody>${rowsHtml
    .map((cells) => `<tr>${cells.map(td).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const btn = (act, text, id = "", cls = "") =>
  `<button type="button" class="btn small ${cls}" data-act="${act}" data-id="${esc(id)}">${esc(text)}</button>`;
const actions = (...buttons) => [buttons.join(""), "actions"];
const badge = (text, cls) => `<span class="badge ${cls}">${esc(text)}</span>`;
const option = (value, text, selected) =>
  `<option value="${esc(value)}" ${String(value) === String(selected ?? "") ? "selected" : ""}>${esc(text)}</option>`;

function bind(handlers) {
  view.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (b && handlers[b.dataset.act]) handlers[b.dataset.act](b.dataset.id, b);
  };
}

// options เป็นรายการข้อความ หรือคู่ [ค่า, ข้อความ]
const optionPairs = (opts) => opts.map((o) => (Array.isArray(o) ? o : [o, o]));

function fieldHtml(f, values = {}) {
  const v = values[f.name] ?? f.value ?? "";
  const label = `${esc(f.label)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ""}${f.required ? " *" : ""}`;
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
  if (f.type === "multi") {
    const chosen = Array.isArray(v) ? v : [];
    return `<fieldset class="field full"><legend>${label}</legend><div class="checks">${f.options.map((o) =>
      `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o)}" ${chosen.includes(o) ? "checked" : ""}>${esc(o)}</label>`)
      .join("")}</div>${hint}</fieldset>`;
  }
  const attrs = [
    `name="${f.name}"`,
    f.required ? "required" : "",
    f.min != null ? `min="${f.min}"` : "",
    f.max != null ? `max="${f.max}"` : "",
    f.type === "number" ? `step="${f.step || "any"}"` : "",
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "",
    f.autocomplete ? `autocomplete="${f.autocomplete}"` : "",
  ].join(" ");
  let input;
  if (f.type === "textarea") {
    input = `<textarea rows="3" ${attrs}>${esc(v)}</textarea>`;
  } else if (f.type === "select" || f.type === "staff") {
    let opts = f.type === "staff" ? [...STAFF] : f.options;
    if (f.type === "staff" && v && !opts.includes(v)) opts.push(v);
    opts = optionPairs(opts);
    if (!f.noBlank) opts = [["", "— เลือก —"], ...opts];
    input = `<select ${attrs}>${opts.map(([val, text]) => option(val, text, v)).join("")}</select>`;
  } else {
    input = `<input type="${f.type || "text"}" value="${esc(v)}" ${attrs}>`;
  }
  return `<label class="field${f.type === "textarea" ? " full" : ""}"><span>${label}</span>${input}${hint}</label>`;
}

function dialogShell(title, inner, submitLabel = "บันทึก", cancelLabel = "ยกเลิก") {
  return `<form class="form" novalidate>
    <h2>${title}</h2>
    ${inner}
    <p class="form-error" hidden></p>
    <div class="actions">
      <button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button>
      ${submitLabel ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ""}
    </div>
  </form>`;
}

function wireDialog(onSubmit) {
  const form = $("form", dlg);
  const error = $(".form-error", form);
  $("[data-cancel]", form).onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const submit = $("button[type=submit]", form);
    if (submit) submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      dlg.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      error.scrollIntoView({ block: "nearest" });
    } finally {
      if (submit) submit.disabled = false;
    }
  };
  if (!dlg.open) dlg.showModal();
  return form;
}

function openForm({ title, fields, values = {}, submitLabel, intro = "", onSubmit, wide = false }) {
  dlg.className = wide ? "wide" : "";
  dlg.innerHTML = dialogShell(esc(title),
    `${intro}<div class="fields${wide ? " two" : ""}">${fields.map((f) => fieldHtml(f, values)).join("")}</div>`, submitLabel);
  const form = wireDialog(onSubmit);
  $("input:not([type=hidden]), select, textarea", form)?.focus();
  return form;
}

// อ่านค่าจากฟอร์มตามนิยามช่อง ช่องเลือกหลายข้อได้เป็น array
function formValues(form, fields) {
  const fd = new FormData(form);
  return Object.fromEntries(fields.map((f) => [f.name, f.type === "multi" ? fd.getAll(f.name) : fd.get(f.name) ?? ""]));
}

// ---------- นิยามงานจากเซิร์ฟเวอร์ ----------

let MODULES = [];
let MOD = {};
let STAFF = [];

async function loadMeta() {
  [MODULES, STAFF] = await Promise.all([api("GET", "/modules"), api("GET", "/staff")]);
  MOD = Object.fromEntries(MODULES.map((m) => [m.key, m]));
}

// ช่องทั้งหมดของงาน รวมวันที่ HN และชื่อผู้ป่วย
function allFields(m) {
  return [
    ...(m.no_date ? [] : [{ name: "record_date", label: m.date_label || "วันที่", type: "date", required: true }]),
    ...(m.patient ? [
      { name: "hn", label: "HN", required: !m.patient_optional, autocomplete: "off" },
      { name: "patient_name", label: "ชื่อ-นามสกุลผู้ป่วย", required: !m.patient_optional },
    ] : []),
    ...m.fields,
  ];
}
const fieldOf = (m, name) => m.fields.find((f) => f.name === name);
const flat = (rec) => ({ record_date: rec.record_date, hn: rec.hn, patient_name: rec.patient_name, ...rec.data });

function showValue(f, v, html = true) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "-";
  let text;
  if (Array.isArray(v)) text = v.join(", ");
  else if (f.type === "date") text = when(v, false);
  else if (f.type === "number") text = num(v) + (f.unit ? " " + f.unit : "");
  else text = String(v);
  return html ? esc(text) : text;
}

const recordText = (r) => [r.hn, r.patient_name, ...Object.values(r.data).flat()].join(" ").toLowerCase();

function summaryText(m, r) {
  return m.list.slice(0, 3).map((n) => {
    const f = fieldOf(m, n);
    const v = r.data[n];
    return v == null ? null : `<small>${esc(f.label)}:</small> ${showValue(f, v)}`;
  }).filter(Boolean).join(" · ") || "-";
}

// เดือนที่เลือกไว้ ใช้ร่วมกันทุกหน้า (ค่าว่าง = ทุกเดือน)
let currentMonth = isoDate().slice(0, 7);
try { currentMonth = sessionStorage.getItem("rx-month") ?? currentMonth; } catch {}

const monthInput = () => `<input type="month" id="month" value="${esc(currentMonth)}" aria-label="เดือน">`;
function wireMonth(load) {
  $("#month").onchange = () => {
    currentMonth = $("#month").value;
    try { sessionStorage.setItem("rx-month", currentMonth); } catch {}
    load().catch((e) => toast(e.message, true));
  };
}

// ---------- บันทึก: ดู แก้ไข ประวัติ พิมพ์ ----------

function patientAlert(list) {
  const adr = list.filter((r) => r.module === "adr");
  if (!adr.length) return `<p class="alert muted">ไม่พบประวัติแพ้ยา / ADR ที่บันทึกใน Rx-TPY (ตรวจสอบใน HIS ร่วมด้วย)</p>`;
  return `<p class="alert bad"><b>⚠ มีประวัติแพ้ยา / ADR:</b> ${adr.map((r) =>
    `${esc(r.data.drug)} <small>(${esc([r.data.adr_type, r.data.causality].filter(Boolean).join(", "))})</small>`).join(", ")}</p>`;
}

async function lookupHN(form) {
  const hn = $("[name=hn]", form).value.trim();
  const box = $(".hn-info", form);
  if (!hn) { box.hidden = true; return; }
  let list;
  try { list = await api("GET", `/records?hn=${encodeURIComponent(hn)}`); } catch { return; }
  const name = $("[name=patient_name]", form);
  if (list.length && !name.value) name.value = list.find((r) => r.patient_name)?.patient_name || "";
  box.innerHTML = patientAlert(list) +
    `<small>${list.length ? `มีบันทึกของ HN นี้ในระบบ ${num(list.length)} รายการ` : "ยังไม่มีบันทึกของ HN นี้"}</small>`;
  box.hidden = false;
}

function openRecordForm(m, rec = null, preset = {}) {
  const fields = allFields(m);
  const form = openForm({
    title: `${rec ? "แก้ไข" : "บันทึก"} ${m.title}`,
    fields,
    wide: true,
    values: rec ? flat(rec) : { record_date: isoDate(), ...preset },
    intro: m.patient ? `<div class="hn-info" hidden></div>` : "",
    submitLabel: "บันทึก",
    onSubmit: async (_, f) => {
      const body = { module: m.key, ...formValues(f, fields) };
      await api(rec ? "PUT" : "POST", rec ? `/records/${rec.id}` : "/records", body);
      toast(rec ? "บันทึกการแก้ไขแล้ว" : "บันทึกแล้ว");
      refresh();
    },
  });
  if (m.patient) {
    const hn = $("[name=hn]", form);
    hn.onchange = () => lookupHN(form);
    if (hn.value) lookupHN(form);
  }
}

async function openRecord(id) {
  let rec;
  try { rec = await api("GET", `/records/${id}`); } catch (e) { return toast(e.message, true); }
  const m = MOD[rec.module];
  const v = flat(rec);
  const cells = allFields(m).map((f) => `<div class="${["textarea", "multi"].includes(f.type) ? "full" : ""}">
      <small>${esc(f.label)}</small><div class="pre">${showValue(f, v[f.name])}</div></div>`).join("");
  const meta = `<p class="meta">บันทึกโดย ${esc(rec.created_by_name)} ${when(rec.created_at)}${
    rec.updated_at ? ` · แก้ไขล่าสุดโดย ${esc(rec.updated_by_name)} ${when(rec.updated_at)}` : ""}</p>`;
  const buttons = [
    (me.role === "admin" || rec.created_by === me.id) && btn("edit", "แก้ไข", "", "primary"),
    btn("print", "พิมพ์"),
    btn("history", "ประวัติการแก้ไข"),
    rec.hn && btn("patient", "ประวัติผู้ป่วยรายนี้"),
    me.role === "admin" && btn("delete", "ลบ", "", "danger"),
  ].filter(Boolean);
  dlg.className = "wide";
  dlg.innerHTML = dialogShell(esc(m.title), `<div class="info-grid">${cells}</div>${meta}<div class="doc-actions">${buttons.join("")}</div>`, null, "ปิด");
  const form = wireDialog(() => {});
  form.onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "edit") return openRecordForm(m, rec);
    if (act === "print") return printRecord(m, rec);
    if (act === "history") return openHistory(m, rec);
    if (act === "patient") { dlg.close(); return openPatient(rec.hn); }
    if (act === "delete") {
      if (!confirm("ลบบันทึกนี้? (ข้อมูลยังเก็บไว้ในประวัติการแก้ไข)")) return;
      try { await api("POST", `/records/${id}/delete`, {}); toast("ลบแล้ว"); dlg.close(); refresh(); }
      catch (err) { toast(err.message, true); }
    }
  };
}

async function openHistory(m, rec) {
  let list;
  try { list = await api("GET", `/records/${rec.id}/history`); } catch (e) { return toast(e.message, true); }
  const fields = allFields(m);
  const ACTION = { create: "สร้างบันทึก", import: "นำเข้าจาก Excel", update: "แก้ไข", delete: "ลบ" };
  let prev = null;
  const items = list.map((entry) => {
    const cur = flat(entry.snapshot);
    let changes = "";
    if (entry.action === "update" && prev) {
      const diff = fields.filter((f) => JSON.stringify(prev[f.name] ?? null) !== JSON.stringify(cur[f.name] ?? null));
      changes = diff.length
        ? `<ul>${diff.map((f) => `<li>${esc(f.label)}: ${showValue(f, prev[f.name])} → <b>${showValue(f, cur[f.name])}</b></li>`).join("")}</ul>`
        : `<div><small>ไม่มีข้อมูลเปลี่ยน</small></div>`;
    }
    prev = cur;
    return `<li><b>${ACTION[entry.action] || esc(entry.action)}</b> โดย ${esc(entry.user_name)} <small>${when(entry.ts)}</small>${changes}</li>`;
  }).reverse();
  dlg.className = "wide";
  dlg.innerHTML = dialogShell(`ประวัติการแก้ไข · ${esc(m.title)}`, `<ul class="history">${items.join("")}</ul>`, null, "ย้อนกลับ");
  const form = wireDialog(() => {});
  $("[data-cancel]", form).onclick = () => openRecord(rec.id);
}

function printRecord(m, rec) {
  const v = flat(rec);
  $("#print").innerHTML = `
    <h1>${esc(m.title)}</h1>
    <p class="center">กลุ่มงานเภสัชกรรม โรงพยาบาลตาพระยา</p>
    <table><tbody>${allFields(m).map((f) =>
      `<tr><th>${esc(f.label)}</th><td class="pre">${showValue(f, v[f.name])}</td></tr>`).join("")}</tbody></table>
    <div class="signs one">
      <div class="sign">
        <div>ลงชื่อ ....................................... ผู้บันทึก</div>
        <div>( ${esc(rec.created_by_name)} )</div>
        <div>วันที่ ${when(rec.created_at, false)}</div>
      </div>
    </div>`;
  window.print();
}

function exportCsv(m, list) {
  if (!list.length) return toast("ไม่มีข้อมูลให้ส่งออก", true);
  const fields = allFields(m);
  const head = [...fields.map((f) => f.label + (f.unit ? ` (${f.unit})` : "")), "ผู้บันทึก", "บันทึกเมื่อ"];
  const lines = list.map((r) => {
    const v = flat(r);
    return [...fields.map((f) => (f.type === "number" ? v[f.name] ?? "" : v[f.name] == null ? "" : showValue(f, v[f.name], false))),
      r.created_by_name, when(r.created_at)];
  });
  // กันสูตรใน Excel จากข้อความที่ขึ้นต้นด้วย = + - @
  const cell = (c) => {
    let s = String(c ?? "");
    if (typeof c === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + [head, ...lines].map((row) => row.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `Rx-TPY_${m.key}_${currentMonth || "all"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// สรุปรายเดือน: จำนวน ผลรวม และสัดส่วนของแต่ละตัวเลือก
function statsHtml(m, list) {
  const chips = [`<span class="chip strong">ทั้งหมด ${num(list.length)} รายการ</span>`];
  let groups = "";
  if (list.length) {
    const total = (name) => list.reduce((s, r) => s + (Number(r.data[name]) || 0), 0);
    for (const name of m.sums || []) {
      const f = fieldOf(m, name);
      chips.push(`<span class="chip">${esc(f.label)} <b>${num(total(name))}</b>${f.unit ? " " + esc(f.unit) : ""}</span>`);
    }
    if (m.rate && total(m.rate.den)) {
      chips.push(`<span class="chip">${esc(m.rate.label)} <b>${num(total(m.rate.num) * 100 / total(m.rate.den))}%</b></span>`);
    }
    for (const name of m.stats || []) {
      const f = fieldOf(m, name);
      const counts = new Map();
      for (const r of list) for (const v of [].concat(r.data[name] ?? [])) counts.set(v, (counts.get(v) || 0) + 1);
      if (!counts.size) continue;
      const order = f.options || [...counts.keys()].sort();
      groups += `<div class="stat-group"><small>${esc(f.label)}</small>${order.filter((o) => counts.has(o)).map((o) =>
        `<span class="chip">${esc(o)} <b>${num(counts.get(o))}</b> <small>${Math.round(counts.get(o) * 100 / list.length)}%</small></span>`).join("")}</div>`;
    }
  }
  return `<section class="card stats-card"><div>${chips.join("")}</div>${groups}</section>`;
}

// ---------- หน้ารายการของแต่ละงาน ----------

function recordsTable(m, list, emptyText) {
  const listFields = m.list.map((n) => fieldOf(m, n));
  return table(
    [...(m.no_date ? [] : [m.date_label || "วันที่"]), ...(m.patient ? ["HN", "ชื่อผู้ป่วย"] : []),
      ...listFields.map((f) => (f.type === "number" ? [f.label, "num"] : f.label)), "ผู้บันทึก", ""],
    list.map((r) => [
      ...(m.no_date ? [] : [when(r.record_date, false)]),
      ...(m.patient ? [esc(r.hn || "-"), esc(r.patient_name || "-")] : []),
      ...listFields.map((f) => (f.type === "number" ? [showValue(f, r.data[f.name]), "num"] : showValue(f, r.data[f.name]))),
      esc(r.created_by_name),
      actions(btn("open", "ดู", r.id)),
    ]),
    emptyText);
}

async function moduleView(m) {
  if (m.view === "calendar") return calendarView(m);
  if (m.view === "offhour") return offhourView(m);
  if (m.view === "formulary") return formularyView(m);
  if (m.view === "directory") return directoryView(m);
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      ${monthInput()}
      <input type="search" id="q" placeholder="${m.patient ? "ค้นหา HN ชื่อ หรือข้อความ" : "ค้นหา"}">
      <button class="btn" data-act="csv">ส่งออก CSV</button>
      <button class="btn primary" data-act="new">+ บันทึกใหม่</button>
    </div>
    <div id="stats"></div>
    <div class="list" id="list"></div>`;
  let list = [];
  let shown = [];
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    shown = q ? list.filter((r) => recordText(r).includes(q)) : list;
    $("#stats").innerHTML = statsHtml(m, shown);
    $("#list").innerHTML = recordsTable(m, shown,
      q ? "ไม่พบบันทึกที่ค้นหา" : `ยังไม่มีบันทึก${currentMonth ? "ในเดือน" + monthLabel(currentMonth) : ""}`);
  };
  const load = async () => {
    list = await api("GET", `/records?module=${m.key}${currentMonth ? "&month=" + currentMonth : ""}`);
    draw();
  };
  $("#q").oninput = draw;
  wireMonth(load);
  bind({ new: () => openRecordForm(m), open: (id) => openRecord(id), csv: () => exportCsv(m, shown) });
  await load();
}

// ---------- อ่านไฟล์ Excel (.xlsx) และ CSV ในเบราว์เซอร์ ไม่ใช้ไลบรารี ----------
// .xlsx คือไฟล์ zip ที่ข้างในเป็น XML: อ่านสารบัญ zip แล้วแตกไฟล์ด้วย inflateRaw ด้านล่าง
// (ไม่ใช้ DecompressionStream ของเบราว์เซอร์ เพราะพบว่าค้างเงียบใน Chrome บางเครื่อง)

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// ตาราง Huffman แบบ canonical: นับจำนวนรหัสต่อความยาว แล้วเรียงสัญลักษณ์ตามความยาว
function huffman(lengths) {
  const counts = new Uint16Array(16);
  for (const len of lengths) counts[len]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((len, sym) => { if (len) symbols[offsets[len]++] = sym; });
  return { counts, symbols };
}

const FIXED_LIT = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DIST = huffman(new Array(30).fill(5));

// แตกข้อมูล deflate (RFC 1951) ด้วย JavaScript ล้วน
function inflateRaw(src) {
  let out = new Uint8Array(Math.max(src.length * 4, 1024));
  let outLen = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;
  const fail = () => { throw new Error("ข้อมูลในไฟล์ Excel เสียหาย"); };
  const ensure = (n) => {
    if (outLen + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCount < n) {
      if (pos >= src.length) fail();
      bitBuf |= src[pos++] << bitCount;
      bitCount += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code < first + count) return h.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail();
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCount = 0; // ทิ้งบิตที่เหลือของไบต์ปัจจุบัน
      if (pos + 4 > src.length) fail();
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      if (pos + len > src.length) fail();
      ensure(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
      continue;
    }
    let lit = FIXED_LIT;
    let dist = FIXED_DIST;
    if (type === 2) {
      const nLit = bits(5) + 257;
      const nDist = bits(5) + 1;
      const nCode = bits(4) + 4;
      const codeLengths = new Array(19).fill(0);
      for (let i = 0; i < nCode; i++) codeLengths[CODE_ORDER[i]] = bits(3);
      const codeTable = huffman(codeLengths);
      const lengths = [];
      while (lengths.length < nLit + nDist) {
        const sym = decode(codeTable);
        if (sym < 16) { lengths.push(sym); continue; }
        let repeat;
        let value = 0;
        if (sym === 16) {
          if (!lengths.length) fail();
          value = lengths[lengths.length - 1];
          repeat = 3 + bits(2);
        } else repeat = sym === 17 ? 3 + bits(3) : 11 + bits(7);
        while (repeat--) lengths.push(value);
      }
      if (lengths.length > nLit + nDist) fail();
      lit = huffman(lengths.slice(0, nLit));
      dist = huffman(lengths.slice(nLit));
    } else if (type !== 1) fail();
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        if (li >= 29) fail();
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) fail();
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > outLen) fail();
        ensure(len);
        for (let k = 0; k < len; k++, outLen++) out[outLen] = out[outLen - d];
      }
    }
  }
  return out.subarray(0, outLen);
}

async function unzip(buffer) {
  const dv = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("ไฟล์นี้ไม่ใช่ไฟล์ Excel แบบ .xlsx");
  const decoder = new TextDecoder();
  const files = new Map();
  let p = dv.getUint32(end + 16, true);
  for (let n = dv.getUint16(end + 10, true); n > 0; n--) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ไฟล์ Excel เสียหาย");
    const nameLen = dv.getUint16(p + 28, true);
    files.set(decoder.decode(new Uint8Array(buffer, p + 46, nameLen)), {
      method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.offset + 30 + dv.getUint16(f.offset + 26, true) + dv.getUint16(f.offset + 28, true);
    const data = new Uint8Array(buffer, start, f.size);
    if (f.method === 0) return decoder.decode(data);
    if (f.method !== 8) throw new Error("ไฟล์ Excel ใช้การบีบอัดแบบที่ไม่รองรับ");
    return decoder.decode(inflateRaw(data));
  };
}

const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// คืนค่า [{ name, rows: [[ค่าแต่ละคอลัมน์]] }] ตัวเลข (รวมวันที่) เป็น number ข้อความเป็น string
async function readXlsx(buffer) {
  const read = await unzip(buffer);
  const xml = async (path) => {
    const text = await read(path);
    return text == null ? null : new DOMParser().parseFromString(text, "application/xml");
  };
  const tags = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];
  const sst = await xml("xl/sharedStrings.xml");
  const strings = sst ? tags(sst, "si").map((si) => tags(si, "t").filter((t) => t.parentNode.localName !== "rPh")
    .map((t) => t.textContent).join("")) : [];
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const targets = new Map(tags(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const sheets = [];
  for (const s of tags(await xml("xl/workbook.xml"), "sheet")) {
    const target = targets.get(s.getAttribute("r:id") ||
      s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) || "";
    const doc = await xml(target.startsWith("/") ? target.slice(1) : "xl/" + target);
    if (!doc) continue;
    const rows = [];
    for (const row of tags(doc, "row")) {
      const cells = [];
      for (const c of tags(row, "c")) {
        const type = c.getAttribute("t");
        const v = tags(c, "v")[0]?.textContent;
        cells[colIndex(c.getAttribute("r"))] =
          type === "s" ? strings[Number(v)] ?? ""
          : type === "inlineStr" ? tags(c, "t").map((x) => x.textContent).join("")
          : type === "str" || type === "e" ? v ?? ""
          : v == null || v === "" ? "" : Number(v);
      }
      rows[Number(row.getAttribute("r")) - 1] = cells;
    }
    sheets.push({ name: s.getAttribute("name"), rows });
  }
  return sheets;
}

function parseCsv(text) {
  const rows = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rows.at(-1).push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.at(-1).push(cell); cell = ""; rows.push([]);
    } else cell += ch;
  }
  rows.at(-1).push(cell);
  return rows.map((r) => r.map((c) => (c.trim() !== "" && !Number.isNaN(Number(c)) ? Number(c) : c)));
}

// ถ้าอ่านไฟล์ไม่เสร็จในเวลาที่กำหนด ให้แจ้งเตือนแทนการค้างเงียบ
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function readSpreadsheet(file) {
  const csv = /\.csv$/i.test(file.name);
  if (!csv && !/\.xlsx$/i.test(file.name)) throw new Error("รองรับเฉพาะไฟล์ .xlsx หรือ .csv (ไฟล์ .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)");
  toast(`กำลังอ่านไฟล์ ${file.name} ...`);
  const locked = "อ่านไฟล์ไม่ได้ ถ้าไฟล์นี้เปิดอยู่ใน Excel ให้ปิดไฟล์ก่อนแล้วลองใหม่";
  if (csv) return [{ name: file.name, rows: parseCsv((await withTimeout(file.text(), 20000, locked)).replace(/^﻿/, "")) }];
  return readXlsx(await withTimeout(file.arrayBuffer(), 20000, locked));
}

// วันที่จาก Excel: เลขลำดับวันของ Excel หรือข้อความ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.)
function excelDate(value) {
  // รวมช่วงที่ปีเป็น พ.ศ. (เช่น 2568) ด้วย ซึ่ง fixYear จะแปลงกลับเป็น ค.ศ.
  if (typeof value === "number" && value > 20000 && value < 300000) {
    return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let [y, mo, d] = m ? [m[1], m[2], m[3]] : [];
  if (!m && (m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/))) [d, mo, y] = [m[1], m[2], m[3]];
  if (!y) return null;
  y = Number(y);
  if (y < 100) y += y > 50 ? 2400 : 2500;
  if (y > 2400) y -= 543;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const check = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(check.getTime()) && check.toISOString().startsWith(iso) ? iso : null;
}

const cellText = (v) => {
  const s = String(v ?? "").trim();
  return s === "-" ? "" : s;
};
const cellNum = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// ช่องเลือกไฟล์ต้องอยู่ในหน้าระหว่างที่หน้าต่างเลือกไฟล์เปิดอยู่
// ถ้าไม่แปะไว้ เบราว์เซอร์อาจเก็บกวาดทิ้งก่อนผู้ใช้เลือกเสร็จ แล้วจะไม่ได้รับไฟล์
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, hidden: true });
    const done = (file) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files[0] || null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

// ---------- นำเข้าผลตรวจใบสั่งยานอกเวลาจาก Excel ----------
// รูปแบบไฟล์ (ทุกชีต): แถวหัวตารางขึ้นต้นด้วย "วัน เดือน ปี" แล้วตามด้วยคอลัมน์
// A วันที่ | B เวร | C OPD/IPD | D จำนวนที่คัดกรอง | E จำนวนที่คลาดเคลื่อน | F ร้อยละ (คำนวณใหม่ ไม่นำเข้า)
// G DRP ที่ตรวจพบ | H ยาที่เกิด DRP | I หมายเหตุ | J ผู้คัดกรอง

function parseDrp(value, options) {
  const found = new Set();
  for (const part of String(value ?? "").split(/[\/,;\n]+/)) {
    const p = part.trim().toLowerCase();
    if (!p || p === "-" || p === "no drp" || p === "no") continue;
    found.add(options.find((o) => o.toLowerCase() === p) || options.find((o) => p.includes(o.toLowerCase())) || "Others");
  }
  return options.filter((o) => found.has(o));
}

// ชื่อชีตแบบ "ก.ค. 68" หรือ "ส.ค.68" → { year: 2025, month: 7 } (ค.ศ.)
function sheetMonth(name) {
  const compact = String(name).replace(/\s+/g, "");
  const month = TH_SHORT_MONTHS.findIndex((m) => compact.startsWith(m)) + 1;
  const yy = compact.match(/(\d{2,4})$/)?.[1];
  if (!month || !yy) return null;
  const be = yy.length === 2 ? 2500 + Number(yy) : Number(yy);
  return { year: be - 543, month };
}

// แก้ปีที่ Excel แปลงผิดเพราะพิมพ์ปี พ.ศ. เช่น 24/7/68 กลายเป็น ค.ศ. 1968 หรือ 2568 ถูกเก็บเป็น ค.ศ. 2568
function fixYear(iso, hint) {
  let y = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (y > 2400) y -= 543;
  else if (y >= 1930 && y < 2000) y += 57;
  // ปีไม่ตรงกับชื่อชีต: ใช้ปีของชีตเมื่อเดือนตรงกัน หรือเมื่อปีห่างเกิน 1 ปี (พิมพ์ผิดแน่นอน)
  if (hint && y !== hint.year && (month === hint.month || Math.abs(y - hint.year) > 1)) y = hint.year;
  const fixed = `${y}${iso.slice(4)}`;
  return new Date(fixed + "T00:00:00Z").toISOString().startsWith(fixed) ? fixed : iso;
}

function mapOffhourSheets(m, sheets) {
  const shiftOptions = fieldOf(m, "shift").options;
  const drpOptions = fieldOf(m, "drp_type").options;
  const rows = [];
  const skipped = [];
  let blankErrors = 0;
  let sheetsRead = 0;
  let yearFixed = 0;
  for (const sheet of sheets) {
    const head = sheet.rows.findIndex((r) => cellText(r?.[0]) === "วัน เดือน ปี");
    if (head < 0) continue;
    sheetsRead++;
    const hint = sheetMonth(sheet.name);
    for (let i = head + 1; i < sheet.rows.length; i++) {
      const c = sheet.rows[i] || [];
      const where = `ชีต ${sheet.name} แถว ${i + 1}`;
      const shift = cellText(c[1]);
      if ((!cellText(c[0]) && !shift) || cellText(c[0]) === "รวม") continue; // แถวว่างหรือแถวรวมท้ายตาราง
      const rawDate = excelDate(c[0]);
      const date = rawDate && fixYear(rawDate, hint);
      if (date && date !== rawDate) yearFixed++;
      const total = cellNum(c[3]);
      if (!date) { skipped.push(`${where}: วันที่ไม่ถูกต้อง (${cellText(c[0]) || "ว่าง"})`); continue; }
      if (!shiftOptions.includes(shift)) { skipped.push(`${where}: เวรไม่ถูกต้อง (${shift || "ว่าง"})`); continue; }
      if (total == null || total < 0) { skipped.push(`${where}: ไม่มีจำนวนใบสั่งยาที่คัดกรอง`); continue; }
      let errors = cellNum(c[4]);
      if (errors == null) { errors = 0; blankErrors++; }
      const unit = cellText(c[2]).toUpperCase();
      rows.push({
        _row: `${i + 1} ชีต ${sheet.name}`,
        record_date: date, shift, unit: ["OPD", "IPD"].includes(unit) ? unit : "",
        total_rx: total, error_rx: errors,
        drp_type: parseDrp(c[6], drpOptions),
        drp_drugs: cellText(c[7]), problems: cellText(c[8]),
        screener: cellText(c[9]) || "ไม่ระบุ",
      });
    }
  }
  return { rows, skipped, blankErrors, sheetsRead, yearFixed };
}

const offhourKey = (v) => [v.record_date, v.shift, v.unit || "", Number(v.total_rx), Number(v.error_rx), v.screener].join("|");

async function importOffhour(m) {
  const file = await pickFile(".xlsx,.csv");
  if (!file) return;
  let parsed;
  let existing;
  try {
    [parsed, existing] = await Promise.all([
      readSpreadsheet(file).then((sheets) => mapOffhourSheets(m, sheets)),
      api("GET", `/records?module=${m.key}`),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!parsed.sheetsRead) return toast('ไม่พบหัวตาราง "วัน เดือน ปี" ในไฟล์นี้', true);
  // ข้ามแถวที่มีอยู่ในระบบแล้ว จึงนำเข้าไฟล์เดิมซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
  const have = new Map();
  for (const r of existing) {
    const k = offhourKey({ record_date: r.record_date, ...r.data });
    have.set(k, (have.get(k) || 0) + 1);
  }
  const fresh = parsed.rows.filter((r) => {
    const k = offhourKey(r);
    if (!have.get(k)) return true;
    have.set(k, have.get(k) - 1);
    return false;
  });
  const dates = fresh.map((r) => r.record_date).sort();
  const info = (label, value) => `<div><small>${label}</small><div>${value}</div></div>`;
  dlg.className = "wide";
  dlg.innerHTML = dialogShell("นำเข้าข้อมูลจาก Excel", `
    <p class="hint">${esc(file.name)} · อ่านได้ ${num(parsed.sheetsRead)} ชีต</p>
    <div class="info-grid">
      ${info("พร้อมนำเข้า", `<b>${num(fresh.length)}</b> แถว`)}
      ${info("ช่วงวันที่", dates.length ? `${when(dates[0], false)} – ${when(dates.at(-1), false)}` : "-")}
      ${info("มีในระบบแล้ว (ข้าม)", `${num(parsed.rows.length - fresh.length)} แถว`)}
      ${info("ข้อมูลไม่ครบ (ข้าม)", `${num(parsed.skipped.length)} แถว`)}
    </div>
    ${parsed.yearFixed ? `<p class="hint">แก้ปีที่พิมพ์เป็น พ.ศ. ใน Excel ให้ถูกต้อง ${num(parsed.yearFixed)} แถว (ใช้เดือนและปีจากชื่อชีต)</p>` : ""}
    ${parsed.blankErrors ? `<p class="hint">มี ${num(parsed.blankErrors)} แถวที่ช่องจำนวนใบสั่งยาที่คลาดเคลื่อนว่าง จะนับเป็น 0</p>` : ""}
    ${parsed.skipped.length ? `<details><summary>ดูแถวที่ข้าม</summary><ul class="history">${parsed.skipped.slice(0, 50)
      .map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}
    <p class="meta">ร้อยละของความคลาดเคลื่อนจะคำนวณใหม่จากจำนวนที่นำเข้า และบันทึกที่นำเข้าจะมีชื่อ ${esc(me.full_name)} เป็นผู้บันทึก</p>`,
    fresh.length ? `นำเข้า ${num(fresh.length)} แถว` : null, fresh.length ? "ยกเลิก" : "ปิด");
  wireDialog(async (_, form) => {
    const submit = $("button[type=submit]", form);
    let done = 0;
    try {
      for (let i = 0; i < fresh.length; i += 200) {
        submit.textContent = `กำลังนำเข้า ${num(done)} / ${num(fresh.length)}`;
        done += (await api("POST", "/records/import", { module: m.key, rows: fresh.slice(i, i + 200) })).inserted;
      }
    } catch (err) {
      submit.textContent = "ลองอีกครั้ง";
      if (done) refresh();
      throw new Error(done ? `นำเข้าแล้ว ${num(done)} แถว แล้วเกิดข้อผิดพลาด: ${err.message} (กดนำเข้าไฟล์เดิมอีกครั้งได้ ระบบจะข้ามแถวที่นำเข้าแล้ว)` : err.message);
    }
    toast(`นำเข้าแล้ว ${num(done)} แถว`);
    refresh();
  });
}

// ---------- วิเคราะห์ผลตรวจใบสั่งยานอกเวลา ----------

const TH_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const shortMonth = (ym) => { const [y, m] = ym.split("-"); return `${TH_SHORT_MONTHS[m - 1]} ${String(Number(y) + 543).slice(2)}`; };
const fiscalYear = (iso) => Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) >= 10 ? 1 : 0) + 543; // ปีงบ ต.ค.–ก.ย.
const pct = (a, b) => (b ? `${(a * 100 / b).toFixed(2)}%` : "-");

// แยกชื่อยาจากช่อง "ยาที่เกิด DRP" ที่เขียนได้หลายแบบ แล้วรวมชื่อเดียวกันเข้าด้วยกัน
const DRUG_NOISE = /\b(syrup|syr|sry|susp|suspension|tab|tabs|tablet|cap|caps|capsule|inj|injection|mg|ml|ir|sr|dosage|too|low|high)\b\.?/gi;
function drugNames(text) {
  return String(text ?? "").split(/[\n,\/;+]+/)
    .map((s) => s.replace(/^[\s\-•*\d.)]+/, "").replace(DRUG_NOISE, " ").replace(/[^A-Za-z฀-๿. ]/g, " ")
      .replace(/\s+/g, " ").replace(/^\.+|\.+$/g, "").trim().toLowerCase())
    .filter((s) => s.length > 1);
}
// ตัวย่อสั้น ๆ เช่น gg, ors ให้เป็นตัวพิมพ์ใหญ่ทั้งคำ
const titleCase = (s) => (s.length <= 3 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));

function offhourStats(rows) {
  const sum = (list, f) => list.reduce((s, r) => s + (Number(r.data[f]) || 0), 0);
  const agg = (list) => ({
    shifts: list.length, screened: sum(list, "total_rx"), errors: sum(list, "error_rx"),
    drp: list.filter((r) => (r.data.drp_type || []).length).length,
  });
  const groupBy = (keyOf) => {
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map].map(([k, list]) => [k, agg(list)]);
  };
  const count = (keysOf) => {
    const map = new Map();
    for (const r of rows) for (const k of keysOf(r)) map.set(k, (map.get(k) || 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1]);
  };
  return {
    all: agg(rows),
    byShift: groupBy((r) => r.data.shift),
    byUnit: groupBy((r) => r.data.unit),
    byMonth: groupBy((r) => r.record_date.slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0])),
    byScreener: groupBy((r) => r.data.screener).sort((a, b) => b[1].shifts - a[1].shifts),
    drp: count((r) => r.data.drp_type || []),
    drugs: count((r) => new Set(drugNames(r.data.drp_drugs))),
    rows,
  };
}

function barList(items, empty = "ยังไม่มีข้อมูล") {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return `<ul class="bars">${items.map((i) => `<li title="${esc(i.title || "")}">
      <span class="bar-label">${esc(i.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(i.value * 100 / max).toFixed(1)}%"></span></span>
      <span class="bar-value">${i.text ?? num(i.value)}${i.sub ? ` <small>${esc(i.sub)}</small>` : ""}</span>
    </li>`).join("")}</ul>`;
}

function columnChart(items) {
  if (!items.length) return `<p class="empty">ยังไม่มีข้อมูล</p>`;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return `<div class="cols-wrap"><div class="cols">${items.map((i) => `<div class="col" title="${esc(i.title || "")}">
      <span class="col-value">${esc(i.text)}</span>
      <span class="col-bar" style="height:${(i.value * 100 / max).toFixed(1)}%"></span>
      <span class="col-label">${esc(i.label)}</span>
    </div>`).join("")}</div></div>`;
}

const kpi = (label, value, sub = "") => `<div class="kpi"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;

function offhourAnalysis(s) {
  const a = s.all;
  const rateItem = ([k, v]) => ({
    label: k, value: v.screened ? v.errors * 100 / v.screened : 0, text: pct(v.errors, v.screened),
    sub: `${num(v.errors)}/${num(v.screened)} ใบ`, title: `${k}: ${num(v.shifts)} เวร พบ DRP ${num(v.drp)} เวร`,
  });
  const drpTotal = s.drp.reduce((n, [, c]) => n + c, 0);
  const cross = [...s.byShift, ...s.byUnit].map(([k]) => k);
  const crossCount = (type, key) => s.rows.filter((r) => (r.data.drp_type || []).includes(type) &&
    (r.data.shift === key || r.data.unit === key)).length;
  return `
    <section class="kpis">
      ${kpi("ใบสั่งยาที่คัดกรอง", num(a.screened), "ใบ")}
      ${kpi("พบความคลาดเคลื่อนทางยา", num(a.errors), "ใบ")}
      ${kpi("ร้อยละของความคลาดเคลื่อน", pct(a.errors, a.screened))}
      ${kpi("เวรที่พบ DRP", num(a.drp), `จาก ${num(a.shifts)} เวร`)}
    </section>
    <div class="grid2 analysis">
      <section class="card"><h2>ร้อยละความคลาดเคลื่อนรายเดือน</h2>
        ${columnChart(s.byMonth.map(([k, v]) => ({
          label: shortMonth(k), value: v.screened ? v.errors * 100 / v.screened : 0, text: pct(v.errors, v.screened),
          title: `${monthLabel(k)}: คลาดเคลื่อน ${num(v.errors)} จาก ${num(v.screened)} ใบ (${num(v.shifts)} เวร)`,
        })))}</section>
      <section class="card"><h2>ร้อยละความคลาดเคลื่อนตามเวรและหน่วยบริการ</h2>
        ${barList([...s.byShift, ...s.byUnit].map(rateItem))}</section>
      <section class="card"><h2>ประเภท DRP ที่ตรวจพบ</h2>
        ${barList(s.drp.map(([k, c]) => ({ label: k, value: c, sub: `ครั้ง · ${pct(c, drpTotal)}`, title: `${k}: ${c} ครั้ง` })),
          "ไม่พบ DRP ในช่วงนี้")}</section>
      <section class="card"><h2>ยาที่เกิด DRP บ่อย <small>10 อันดับ</small></h2>
        ${barList(s.drugs.slice(0, 10).map(([k, c]) => ({ label: titleCase(k), value: c, sub: "ครั้ง" })), "ยังไม่มีข้อมูลยา")}</section>
    </div>
    ${s.drp.length ? `<section class="card"><h2>ประเภท DRP แยกตามเวรและหน่วยบริการ <small>จำนวนครั้ง</small></h2>
      ${table(["ประเภท DRP", ...cross.map((k) => [k, "num"]), ["รวม", "num"]],
        s.drp.map(([type, c]) => [esc(type), ...cross.map((k) => [num(crossCount(type, k)), "num"]), [`<b>${num(c)}</b>`, "num"]]),
        "")}</section>` : ""}
    <section class="card"><h2>ผู้คัดกรอง</h2>
      ${table(["ผู้คัดกรอง", ["เวร", "num"], ["ใบสั่งยาที่คัดกรอง", "num"], ["พบคลาดเคลื่อน", "num"], ["ร้อยละ", "num"]],
        s.byScreener.map(([k, v]) => [esc(k), [num(v.shifts), "num"], [num(v.screened), "num"], [num(v.errors), "num"],
          [pct(v.errors, v.screened), "num"]]), "ยังไม่มีข้อมูล")}</section>`;
}

async function offhourView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <select id="period" aria-label="ช่วงเวลา"></select>
      <input type="search" id="q" placeholder="ค้นหา เช่น ชื่อยา ผู้คัดกรอง">
      <button class="btn" data-act="import">นำเข้า Excel</button>
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn" data-act="pdf">ดาวน์โหลด PDF</button>
      <button class="btn primary" data-act="new">+ บันทึกใหม่</button>
    </div>
    <div id="analysis"></div>
    <h3 class="group-title">รายการบันทึก</h3>
    <div class="list" id="list"></div>`;
  const all = await api("GET", `/records?module=${m.key}`);
  const years = [...new Set(all.map((r) => fiscalYear(r.record_date)))].sort((a, b) => b - a);
  const months = [...new Set(all.map((r) => r.record_date.slice(0, 7)))].sort().reverse();
  const options = [
    ["all", "ทั้งหมด"],
    ...years.map((y) => [`fy:${y}`, `ปีงบประมาณ ${y}`]),
    ...months.map((k) => [`m:${k}`, monthLabel(k)]),
  ];
  let period = "";
  try { period = sessionStorage.getItem("rx-offhour-period") || ""; } catch {}
  if (!options.some(([v]) => v === period)) period = options[0][0];
  $("#period").innerHTML = options.map(([v, text]) => option(v, text, period)).join("");
  let shown = [];
  // ชื่อช่วงเวลาที่แสดงอยู่ ใช้ในชื่อไฟล์และหัวรายงาน
  const periodLabel = () => {
    const q = $("#q").value.trim();
    return `${$("#period").selectedOptions[0]?.text || "ทั้งหมด"}${q ? ` (ค้นหา "${q}")` : ""}`;
  };
  const needData = () => {
    if (!shown.length) toast("ไม่มีข้อมูลในช่วงที่เลือก", true);
    return shown.length > 0;
  };
  const draw = () => {
    period = $("#period").value;
    try { sessionStorage.setItem("rx-offhour-period", period); } catch {}
    const [kind, val] = period.split(":");
    const rows = all.filter((r) => (kind === "fy" ? fiscalYear(r.record_date) === Number(val)
      : kind === "m" ? r.record_date.startsWith(val) : true));
    const q = $("#q").value.trim().toLowerCase();
    shown = q ? rows.filter((r) => recordText(r).includes(q)) : rows;
    $("#analysis").innerHTML = all.length ? offhourAnalysis(offhourStats(shown))
      : `<p class="hint">ยังไม่มีข้อมูล กด "นำเข้า Excel" เพื่อนำเข้าไฟล์ผลการตรวจใบสั่งยา หรือกด "+ บันทึกใหม่" เพื่อบันทึกทีละเวร</p>`;
    $("#list").innerHTML = recordsTable(m, shown, q ? "ไม่พบบันทึกที่ค้นหา" : "ยังไม่มีบันทึกในช่วงนี้");
  };
  $("#period").onchange = draw;
  $("#q").oninput = draw;
  bind({
    new: () => openRecordForm(m),
    open: (id) => openRecord(id),
    import: () => importOffhour(m),
    xlsx: () => needData() && downloadBlob(offhourWorkbook(offhourStats(shown), periodLabel()),
      safeFileName(`รายงานผลการตรวจใบสั่งยานอกเวลาราชการ ${periodLabel()}.xlsx`)),
    pdf: () => needData() && offhourDownloadPdf(offhourStats(shown), periodLabel()),
  });
  draw();
}

// ---------- เขียนไฟล์ Excel (.xlsx) ในเบราว์เซอร์ ไม่ใช้ไลบรารี ----------
// .xlsx คือ zip ของไฟล์ XML: เก็บแบบไม่บีบอัด (store) จึงต้องการแค่ CRC32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipFiles(files, type) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // ชื่อไฟล์เป็น UTF-8
    local.setUint16(12, 0x21, true); // วันที่ 1 ม.ค. 1980
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local, name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type });
}

const xmlEsc = (v) => String(v ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const colName = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// sheets: [{ name, widths: [ความกว้างคอลัมน์], rows: [[ค่า]], bold: Set(เลขแถวที่ตัวหนา เริ่ม 0) }]
function buildXlsx(sheets) {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheetXml = (sheet) => {
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      if (v == null || v === "") return "";
      const ref = `${colName(c)}${r + 1}`;
      const style = sheet.bold?.has(r) ? ' s="1"' : "";
      return typeof v === "number" && Number.isFinite(v)
        ? `<c r="${ref}"${style}><v>${v}</v></c>`
        : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name.replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipFiles(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const safeFileName = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const round2 = (x) => Math.round(x * 100) / 100;
const ratio = (a, b) => (b ? round2(a * 100 / b) : "");

// ---------- ดาวน์โหลดผลตรวจใบสั่งยานอกเวลา: Excel และ PDF ----------

const OFFHOUR_TITLE = "รายงานผลการตรวจใบสั่งยานอกเวลาราชการ กลุ่มงานเภสัชกรรม โรงพยาบาลตาพระยา";

function offhourWorkbook(s, periodLabel) {
  const rows = [...s.rows].sort((a, b) => a.record_date.localeCompare(b.record_date) || a.id - b.id);
  const a = s.all;
  // ชีตข้อมูล: คอลัมน์เดียวกับไฟล์ต้นฉบับ จึงนำกลับเข้าระบบด้วยปุ่ม "นำเข้า Excel" ได้
  const data = {
    name: "ข้อมูล",
    widths: [12, 9, 11, 14, 16, 12, 24, 28, 40, 16],
    bold: new Set([0, 1, rows.length + 2]),
    rows: [
      [`${OFFHOUR_TITLE} · ${periodLabel}`],
      ["วัน เดือน ปี", "เวร", "หน่วยบริการ", "จำนวนใบสั่งยาที่คัดกรอง", "จำนวนใบสั่งยาที่มีความคลาดเคลื่อนทางยา",
        "ร้อยละของความคลาดเคลื่อน", "DRP ที่ตรวจพบ", "ยาที่เกิด DRP", "หมายเหตุประเด็นที่ตรวจพบ/น่าสนใจ", "ผู้คัดกรอง"],
      ...rows.map((r) => {
        const d = r.data;
        return [when(r.record_date, false), d.shift, d.unit || "", d.total_rx ?? "", d.error_rx ?? "",
          ratio(Number(d.error_rx) || 0, Number(d.total_rx) || 0),
          (d.drp_type || []).join(" / ") || "No DRP", d.drp_drugs || "", d.problems || "", d.screener || ""];
      }),
      ["รวม", "", "", a.screened, a.errors, ratio(a.errors, a.screened)],
    ],
  };
  const out = [];
  const bold = new Set();
  const head = (cells) => { bold.add(out.length); out.push(cells); };
  const gap = () => out.push([]);
  const rateRow = ([k, v]) => [k, v.shifts, v.screened, v.errors, ratio(v.errors, v.screened), v.drp];
  const drpTotal = s.drp.reduce((n, [, c]) => n + c, 0);
  const cross = [...s.byShift, ...s.byUnit].map(([k]) => k);
  head([OFFHOUR_TITLE]);
  out.push([`ช่วงเวลา: ${periodLabel}`], [`ดาวน์โหลดเมื่อ ${when(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))} โดย ${me.full_name}`]);
  gap();
  head(["สรุป", "ค่า"]);
  out.push(["จำนวนเวรที่บันทึก", a.shifts], ["ใบสั่งยาที่คัดกรอง (ใบ)", a.screened], ["ใบสั่งยาที่มีความคลาดเคลื่อนทางยา (ใบ)", a.errors],
    ["ร้อยละของความคลาดเคลื่อน", ratio(a.errors, a.screened)], ["เวรที่พบ DRP", a.drp]);
  gap();
  head(["รายเดือน", "เวร", "คัดกรอง (ใบ)", "คลาดเคลื่อน (ใบ)", "ร้อยละ", "เวรที่พบ DRP"]);
  s.byMonth.forEach(([k, v]) => out.push(rateRow([monthLabel(k), v])));
  gap();
  head(["เวร / หน่วยบริการ", "เวร", "คัดกรอง (ใบ)", "คลาดเคลื่อน (ใบ)", "ร้อยละ", "เวรที่พบ DRP"]);
  [...s.byShift, ...s.byUnit].forEach((e) => out.push(rateRow(e)));
  gap();
  head(["ประเภท DRP", "จำนวนครั้ง", "ร้อยละของ DRP ทั้งหมด", ...cross]);
  s.drp.forEach(([type, c]) => out.push([type, c, ratio(c, drpTotal), ...cross.map((k) =>
    s.rows.filter((r) => (r.data.drp_type || []).includes(type) && (r.data.shift === k || r.data.unit === k)).length)]));
  if (!s.drp.length) out.push(["ไม่พบ DRP"]);
  gap();
  head(["ยาที่เกิด DRP", "จำนวนครั้ง"]);
  s.drugs.forEach(([k, c]) => out.push([titleCase(k), c]));
  if (!s.drugs.length) out.push(["ไม่มีข้อมูลยา"]);
  gap();
  head(["ผู้คัดกรอง", "เวร", "คัดกรอง (ใบ)", "คลาดเคลื่อน (ใบ)", "ร้อยละ", "เวรที่พบ DRP"]);
  s.byScreener.forEach((e) => out.push(rateRow(e)));
  return buildXlsx([data, { name: "สรุป", widths: [36, 12, 18, 18, 12, 14, 12, 12], bold, rows: out }]);
}

function printOffhour(s, periodLabel, withDetail) {
  const rows = [...s.rows].sort((a, b) => a.record_date.localeCompare(b.record_date) || a.id - b.id);
  const detail = withDetail ? `<h2 class="report-section">รายการบันทึก (${num(rows.length)} เวร)</h2>
    <table class="report-detail"><thead><tr><th>วันที่</th><th>เวร</th><th>หน่วย</th><th class="num">คัดกรอง</th>
      <th class="num">คลาดเคลื่อน</th><th>DRP</th><th>ยาที่เกิด DRP</th><th>หมายเหตุ</th><th>ผู้คัดกรอง</th></tr></thead>
    <tbody>${rows.map((r) => {
      const d = r.data;
      return `<tr><td>${when(r.record_date, false)}</td><td>${esc(d.shift)}</td><td>${esc(d.unit || "")}</td>
        <td class="num">${num(d.total_rx)}</td><td class="num">${num(d.error_rx)}</td>
        <td>${esc((d.drp_type || []).join(", ") || "No DRP")}</td><td class="pre">${esc(d.drp_drugs || "")}</td>
        <td class="pre">${esc(d.problems || "")}</td><td>${esc(d.screener || "")}</td></tr>`;
    }).join("")}</tbody></table>` : "";
  $("#print").innerHTML = `<div class="report">
    <div class="report-head">
      <img src="logo.png" alt="">
      <div>
        <h1>รายงานผลการตรวจใบสั่งยานอกเวลาราชการ</h1>
        <p>กลุ่มงานเภสัชกรรม โรงพยาบาลตาพระยา</p>
        <p>ช่วงเวลา: <b>${esc(periodLabel)}</b> · พิมพ์เมื่อ ${longDate()} โดย ${esc(me.full_name)}</p>
      </div>
    </div>
    ${offhourAnalysis(s)}
    ${detail}
  </div>`;
  // ชื่อไฟล์ PDF ที่เบราว์เซอร์เสนอมาจากชื่อหน้าเว็บ
  const title = document.title;
  document.title = safeFileName(`รายงานผลการตรวจใบสั่งยานอกเวลาราชการ ${periodLabel}`);
  window.addEventListener("afterprint", () => { document.title = title; }, { once: true });
  window.print();
}

function offhourDownloadPdf(s, periodLabel) {
  openForm({
    title: "ดาวน์โหลด PDF",
    intro: `<p class="hint">ในหน้าต่างที่เปิดขึ้น ให้เลือกปลายทาง (Destination) เป็น <b>บันทึกเป็น PDF</b> หรือ <b>Save as PDF</b> แล้วกดบันทึก</p>`,
    fields: [{
      name: "detail", label: "เนื้อหา", type: "select", noBlank: true,
      options: [["0", "สรุปและกราฟ"], ["1", `สรุป กราฟ และรายการบันทึกทั้งหมด (${num(s.rows.length)} เวร)`]],
    }],
    submitLabel: "สร้าง PDF",
    onSubmit: async (d) => { setTimeout(() => printOffhour(s, periodLabel, d.detail === "1"), 100); },
  });
}

// สรุปย่อในหน้า Dashboard
async function offhourPanel(month) {
  const box = $("#offhour-panel");
  if (!MOD.offhour_rx || !box) return;
  const rows = await api("GET", `/records?module=offhour_rx&month=${month}`);
  if (!rows.length || !box.isConnected) return;
  const s = offhourStats(rows);
  box.innerHTML = `<div class="panel-head"><h2>${esc(MOD.offhour_rx.title)} <small>${monthLabel(month)}</small></h2>
      ${btn("go", "ดูการวิเคราะห์ทั้งหมด", "offhour_rx")}</div>
    <section class="kpis">
      ${kpi("ใบสั่งยาที่คัดกรอง", num(s.all.screened), "ใบ")}
      ${kpi("ร้อยละของความคลาดเคลื่อน", pct(s.all.errors, s.all.screened), `${num(s.all.errors)} ใบ`)}
      ${kpi("เวรที่พบ DRP", num(s.all.drp), `จาก ${num(s.all.shifts)} เวร`)}
    </section>
    <div class="grid2 analysis">
      <div><h3>ประเภท DRP</h3>${barList(s.drp.slice(0, 5).map(([k, c]) => ({ label: k, value: c, sub: "ครั้ง" })), "ไม่พบ DRP")}</div>
      <div><h3>ยาที่เกิด DRP</h3>${barList(s.drugs.slice(0, 5).map(([k, c]) => ({ label: titleCase(k), value: c, sub: "ครั้ง" })), "ยังไม่มีข้อมูลยา")}</div>
    </div>`;
  box.hidden = false;
}

// ---------- บัญชียาโรงพยาบาล ----------
// แยกตามปีงบประมาณ (ช่อง fiscal_year) นำเข้าจากไฟล์แผนจัดซื้อยา โดยหาคอลัมน์จากชื่อหัวตาราง

const drugKey = (fy, name) => `${fy}|${String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
const baht = (v) => Number(v || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// หาแถวหัวตารางที่มี "ลำดับ" "รายการ" และ "วิธีการจัดซื้อ" แล้วจับคู่คอลัมน์ตามชื่อ
function findFormularySheets(sheets) {
  const found = [];
  for (const sheet of sheets) {
    for (let h = 0; h < Math.min(sheet.rows.length, 15); h++) {
      const head = (sheet.rows[h] || []).map((c) => cellText(c).replace(/\s+/g, " "));
      const at = (test) => head.findIndex((c) => c && test(c));
      const cols = {
        seq: at((c) => c.startsWith("ลำดับ")),
        drug: at((c) => c.startsWith("รายการ")),
        category: at((c) => c.startsWith("ประเภท")),
        estimate: at((c) => c.startsWith("ประมาณการจัดซื้อ")),
        method: at((c) => c.includes("วิธีการจัดซื้อ")),
      };
      if (cols.drug < 0 || cols.method < 0) continue;
      const fy = Number(head[cols.estimate]?.match(/25\d\d/)?.[0]) || null;
      found.push({ sheet, head: h, cols, fy });
      break;
    }
  }
  return found;
}

function mapFormularyRows(m, target, fy) {
  const catOptions = fieldOf(m, "category").options;
  const methodOptions = fieldOf(m, "method").options;
  const match = (options, v) => options.find((o) => o.toLowerCase() === v.toLowerCase());
  const { sheet, head, cols } = target;
  const rows = [];
  const skipped = [];
  for (let i = head + 1; i < sheet.rows.length; i++) {
    const c = sheet.rows[i] || [];
    const drug = cellText(c[cols.drug]);
    if (!drug || /^รวม/.test(drug)) continue; // แถวว่างหรือแถวรวมท้ายตาราง
    const where = `ชีต ${sheet.name} แถว ${i + 1}`;
    const catText = cols.category >= 0 ? cellText(c[cols.category]) : "";
    const methodText = cellText(c[cols.method]);
    const category = catText ? match(catOptions, catText) : "";
    const method = methodText ? match(methodOptions, methodText) : "";
    if (category === undefined) { skipped.push(`${where}: ประเภท "${catText}" ไม่อยู่ในรายการ (${catOptions.join(", ")})`); continue; }
    if (method === undefined) { skipped.push(`${where}: วิธีการจัดซื้อ "${methodText}" ไม่อยู่ในรายการ`); continue; }
    const estimate = cols.estimate >= 0 ? cellNum(c[cols.estimate]) : null;
    rows.push({
      _row: `${i + 1} ชีต ${sheet.name}`, fiscal_year: fy,
      seq: cols.seq >= 0 ? cellNum(c[cols.seq]) : null, drug,
      category, estimate: estimate == null ? null : Math.round(estimate * 100) / 100, method,
    });
  }
  return { rows, skipped };
}

async function importFormulary(m, currentFy, onDone) {
  const file = await pickFile(".xlsx,.csv");
  if (!file) return;
  let targets;
  let existing;
  try {
    [targets, existing] = await Promise.all([readSpreadsheet(file).then(findFormularySheets), api("GET", `/records?module=${m.key}`)]);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!targets.length) return toast('ไม่พบหัวตารางที่มีคอลัมน์ "รายการ" และ "วิธีการจัดซื้อ" ในไฟล์นี้', true);
  const admin = me.role === "admin";
  dlg.className = "wide";
  dlg.innerHTML = dialogShell("นำเข้าบัญชียาจาก Excel", `
    <p class="hint">${esc(file.name)}</p>
    <div class="fields two">
      ${fieldHtml({ name: "sheet", label: "ชีต", type: "select", noBlank: true, options: targets.map((t, i) => [i, t.sheet.name]) })}
      ${fieldHtml({ name: "fy", label: "ปีงบประมาณ", type: "number", required: true, min: 2560, max: 2700, value: targets[0].fy || currentFy })}
      ${fieldHtml({ name: "mode", label: "วิธีนำเข้า", type: "select", noBlank: true, options: [
        ["add", "เพิ่มเฉพาะรายการที่ยังไม่มีในปีงบนี้"],
        ...(admin ? [["replace", "แทนที่บัญชียาทั้งปีงบนี้ (ลบรายการเดิมของปีงบนี้ก่อน)"]] : []),
      ] })}
    </div>
    <div id="import-preview"></div>`, "นำเข้า");
  const form = $("form", dlg);
  let plan = null;
  const preview = () => {
    const target = targets[Number(form.sheet.value)];
    const fy = Number(form.fy.value);
    const mode = form.mode.value;
    const parsed = mapFormularyRows(m, target, fy);
    const have = new Set(existing.filter((r) => Number(r.data.fiscal_year) === fy).map((r) => drugKey(fy, r.data.drug)));
    const fresh = mode === "replace" ? parsed.rows : parsed.rows.filter((r) => !have.has(drugKey(fy, r.drug)));
    plan = { fy, mode, rows: fresh };
    const total = fresh.reduce((s, r) => s + (r.estimate || 0), 0);
    const info = (label, value) => `<div><small>${label}</small><div>${value}</div></div>`;
    $("#import-preview").innerHTML = `
      <div class="info-grid">
        ${info("จะนำเข้า", `<b>${num(fresh.length)}</b> รายการ`)}
        ${info("มูลค่าประมาณการรวม", `${baht(total)} บาท`)}
        ${mode === "replace" ? info("รายการเดิมของปีงบนี้ (จะถูกแทนที่)", `${num(have.size)} รายการ`)
          : info("มีในปีงบนี้แล้ว (ข้าม)", `${num(parsed.rows.length - fresh.length)} รายการ`)}
        ${info("ข้อมูลไม่ครบ (ข้าม)", `${num(parsed.skipped.length)} แถว`)}
      </div>
      ${parsed.skipped.length ? `<details><summary>ดูแถวที่ข้าม</summary><ul class="history">${parsed.skipped.slice(0, 50)
        .map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}
      ${mode === "replace" && have.size ? `<p class="form-error">รายการเดิมของปีงบ ${fy} จำนวน ${num(have.size)} รายการจะถูกลบ (ยังดูย้อนหลังได้ในประวัติ) แล้วแทนที่ด้วยรายการจากไฟล์นี้</p>` : ""}`;
    $("button[type=submit]", form).textContent = fresh.length ? `นำเข้า ${num(fresh.length)} รายการ` : "ไม่มีรายการใหม่";
    $("button[type=submit]", form).disabled = !fresh.length;
  };
  form.onchange = preview;
  form.fy.oninput = preview;
  preview();
  wireDialog(async (_, f) => {
    if (!plan.rows.length) throw new Error("ไม่มีรายการที่จะนำเข้า");
    const submit = $("button[type=submit]", f);
    let done = 0;
    let replaced = 0;
    try {
      for (let i = 0; i < plan.rows.length; i += 500) {
        submit.textContent = `กำลังนำเข้า ${num(done)} / ${num(plan.rows.length)}`;
        const res = await api("POST", "/records/import", {
          module: m.key, rows: plan.rows.slice(i, i + 500),
          ...(plan.mode === "replace" && i === 0 ? { replace: plan.fy } : {}),
        });
        done += res.inserted;
        replaced += res.replaced || 0;
      }
    } catch (err) {
      if (done) onDone(plan.fy);
      throw new Error(done ? `นำเข้าแล้ว ${num(done)} รายการ แล้วเกิดข้อผิดพลาด: ${err.message}` : err.message);
    }
    toast(`นำเข้าแล้ว ${num(done)} รายการ${replaced ? ` (แทนที่รายการเดิม ${num(replaced)} รายการ)` : ""}`);
    onDone(plan.fy);
  });
}

function formularyWorkbook(rows, fy) {
  const total = rows.reduce((s, r) => s + (Number(r.data.estimate) || 0), 0);
  return buildXlsx([{
    name: `บัญชียา ปีงบ ${fy}`,
    widths: [9, 48, 10, 22, 18],
    bold: new Set([0, 1, rows.length + 2]),
    rows: [
      [`บัญชียาโรงพยาบาลตาพระยา ปีงบประมาณ ${fy}`],
      ["ลำดับที่", "รายการยา", "ประเภท", `ประมาณการจัดซื้อปีงบ ${fy} (บาท)`, "วิธีการจัดซื้อ"],
      ...rows.map((r) => [r.data.seq ?? "", r.data.drug, r.data.category || "", r.data.estimate ?? "", r.data.method || ""]),
      ["", `รวม ${rows.length} รายการ`, "", Math.round(total * 100) / 100, ""],
    ],
  }]);
}

let formularyFy = null;

async function formularyView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <select id="fy" aria-label="ปีงบประมาณ"></select>
      <input type="search" id="q" placeholder="ค้นหาชื่อยา ประเภท หรือวิธีจัดซื้อ">
      <button class="btn" data-act="import">นำเข้า Excel</button>
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn primary" data-act="new">+ เพิ่มรายการ</button>
    </div>
    <div id="formulary-summary"></div>
    <div class="list" id="list"></div>`;
  const all = await api("GET", `/records?module=${m.key}`);
  const thisFy = fiscalYear(isoDate());
  const years = [...new Set([...all.map((r) => Number(r.data.fiscal_year)), thisFy])].sort((a, b) => b - a);
  if (!years.includes(formularyFy)) formularyFy = all.some((r) => Number(r.data.fiscal_year) === thisFy) ? thisFy : years[0];
  $("#fy").innerHTML = years.map((y) => option(y, `ปีงบประมาณ ${y}`, formularyFy)).join("");
  let shown = [];
  const draw = () => {
    formularyFy = Number($("#fy").value);
    const fy = formularyFy;
    const q = $("#q").value.trim().toLowerCase();
    const rows = all.filter((r) => Number(r.data.fiscal_year) === fy)
      .sort((a, b) => (a.data.seq ?? 1e9) - (b.data.seq ?? 1e9) || String(a.data.drug).localeCompare(String(b.data.drug)));
    shown = q ? rows.filter((r) => recordText(r).includes(q)) : rows;
    const total = shown.reduce((s, r) => s + (Number(r.data.estimate) || 0), 0);
    const groupSum = (field) => {
      const map = new Map();
      for (const r of shown) {
        const k = r.data[field] || "ไม่ระบุ";
        const e = map.get(k) || { n: 0, sum: 0 };
        e.n++;
        e.sum += Number(r.data.estimate) || 0;
        map.set(k, e);
      }
      return [...map].sort((a, b) => b[1].sum - a[1].sum).map(([k, e]) => ({
        label: k, value: e.sum, text: `${baht(e.sum)} บาท`, sub: `${num(e.n)} รายการ · ${total ? (e.sum * 100 / total).toFixed(1) : 0}%`,
      }));
    };
    $("#formulary-summary").innerHTML = rows.length ? `
      <section class="kpis">
        ${kpi("จำนวนรายการยา", num(shown.length), "รายการ")}
        ${kpi(`ประมาณการจัดซื้อปีงบ ${fy}`, baht(total), "บาท")}
      </section>
      <div class="grid2 analysis">
        <section class="card"><h2>มูลค่าตามวิธีการจัดซื้อ</h2>${barList(groupSum("method"))}</section>
        <section class="card"><h2>มูลค่าตามประเภท</h2>${barList(groupSum("category"))}</section>
      </div>` : `<p class="hint">ยังไม่มีบัญชียาปีงบประมาณ ${fy} กด "นำเข้า Excel" เพื่อนำเข้าไฟล์แผนจัดซื้อยา หรือกด "+ เพิ่มรายการ"</p>`;
    $("#list").innerHTML = table(
      [["ลำดับที่", "num"], "รายการยา", "ประเภท", [`ประมาณการจัดซื้อปีงบ ${fy} (บาท)`, "num"], "วิธีการจัดซื้อ", ""],
      [
        ...shown.map((r) => [[num(r.data.seq), "num"], esc(r.data.drug), esc(r.data.category || "-"),
          [r.data.estimate == null ? "-" : baht(r.data.estimate), "num"], esc(r.data.method || "-"), actions(btn("open", "ดู", r.id))]),
        ...(shown.length ? [["", `<b>รวม ${num(shown.length)} รายการ</b>`, "", [`<b>${baht(total)}</b>`, "num"], "", ""]] : []),
      ],
      q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการ");
  };
  $("#fy").onchange = draw;
  $("#q").oninput = draw;
  bind({
    new: () => openRecordForm(m, null, { fiscal_year: formularyFy }),
    open: (id) => openRecord(id),
    import: () => importFormulary(m, formularyFy, (fy) => { formularyFy = fy; refresh(); }),
    xlsx: () => (shown.length ? downloadBlob(formularyWorkbook(shown, formularyFy), `บัญชียาโรงพยาบาล ปีงบ ${formularyFy}.xlsx`)
      : toast("ไม่มีข้อมูลในปีงบที่เลือก", true)),
  });
  draw();
}

// ---------- นำเข้า Excel แบบทั่วไป (ใช้กับงานที่มี "import": "generic") ----------
// หาแถวหัวตารางที่ชื่อคอลัมน์ตรงกับชื่อช่อง (label) หรือชื่ออื่น (aliases) ในนิยามงาน

const normHead = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

function findGenericSheet(m, sheets) {
  const fields = allFields(m);
  const names = (f) => [f.label, ...(f.aliases || [])].map(normHead);
  for (const sheet of sheets) {
    for (let h = 0; h < Math.min(sheet.rows.length, 15); h++) {
      const head = (sheet.rows[h] || []).map(normHead);
      const cols = {};
      const used = new Set();
      // จับคู่แบบตรงทุกตัวอักษรก่อน แล้วค่อยจับคู่แบบขึ้นต้นด้วยชื่อ
      for (const exact of [true, false]) {
        for (const f of fields) {
          if (f.name in cols) continue;
          const i = head.findIndex((c, idx) => c && !used.has(idx) &&
            names(f).some((n) => (exact ? c === n : n.length >= 3 && c.startsWith(n))));
          if (i >= 0) { cols[f.name] = i; used.add(i); }
        }
      }
      const required = fields.filter((f) => f.required);
      if (Object.keys(cols).length >= 2 && required.every((f) => f.name in cols)) return { sheet, head: h, cols };
    }
  }
  return null;
}

function mapGenericRows(m, target) {
  const fields = allFields(m).filter((f) => f.name in target.cols);
  const rows = [];
  const skipped = [];
  const { sheet, head, cols } = target;
  for (let i = head + 1; i < sheet.rows.length; i++) {
    const c = sheet.rows[i] || [];
    if (fields.every((f) => cellText(c[cols[f.name]]) === "")) continue; // แถวว่าง
    const where = `ชีต ${sheet.name} แถว ${i + 1}`;
    const row = { _row: `${i + 1} ชีต ${sheet.name}` };
    let problem = null;
    for (const f of fields) {
      const raw = c[cols[f.name]];
      const text = cellText(raw);
      if (!text) {
        if (f.required) problem = `ไม่มี${f.label}`;
        continue;
      }
      if (f.type === "number") {
        const n = cellNum(raw);
        if (n == null) problem = `${f.label} "${text}" ไม่ใช่ตัวเลข`;
        else row[f.name] = n;
      } else if (f.type === "date") {
        const d = excelDate(raw);
        if (!d) problem = `${f.label} "${text}" ไม่ใช่วันที่`;
        else row[f.name] = fixYear(d, null);
      } else if (f.type === "select") {
        const hit = f.options.find((o) => o.toLowerCase() === text.toLowerCase());
        if (!hit) problem = `${f.label} "${text}" ไม่อยู่ในตัวเลือก (${f.options.join(", ")})`;
        else row[f.name] = hit;
      } else if (f.type === "multi") {
        row[f.name] = text.split(/[,\/;\n]+/).map((s) => s.trim()).filter(Boolean)
          .map((s) => f.options.find((o) => o.toLowerCase() === s.toLowerCase())).filter(Boolean);
      } else {
        row[f.name] = text;
      }
      if (problem) break;
    }
    if (problem) skipped.push(`${where}: ${problem}`);
    else rows.push(row);
  }
  return { rows, skipped };
}

const uniqueKey = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

async function importGeneric(m) {
  const file = await pickFile(".xlsx,.csv");
  if (!file) return;
  let target;
  let existing;
  try {
    [target, existing] = await Promise.all([
      readSpreadsheet(file).then((sheets) => findGenericSheet(m, sheets)),
      api("GET", `/records?module=${m.key}`),
    ]);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!target) {
    const need = allFields(m).filter((f) => f.required).map((f) => `"${f.label}"`).join(", ");
    return toast(`ไม่พบแถวหัวตารางที่มีคอลัมน์ ${need} ในไฟล์นี้ (ดาวน์โหลด Excel เพื่อดูรูปแบบ)`, true);
  }
  const parsed = mapGenericRows(m, target);
  const have = new Set(m.unique ? existing.map((r) => uniqueKey(r.data[m.unique])) : []);
  const fresh = m.unique ? parsed.rows.filter((r) => !have.has(uniqueKey(r[m.unique]))) : parsed.rows;
  const matched = allFields(m).filter((f) => f.name in target.cols).map((f) => f.label);
  const info = (label, value) => `<div><small>${label}</small><div>${value}</div></div>`;
  dlg.className = "wide";
  dlg.innerHTML = dialogShell(`นำเข้า${esc(m.title)}จาก Excel`, `
    <p class="hint">${esc(file.name)} · ชีต ${esc(target.sheet.name)} · คอลัมน์ที่พบ: ${esc(matched.join(", "))}</p>
    <div class="info-grid">
      ${info("จะนำเข้า", `<b>${num(fresh.length)}</b> รายการ`)}
      ${m.unique ? info("มีอยู่แล้ว (ข้าม)", `${num(parsed.rows.length - fresh.length)} รายการ`) : ""}
      ${info("ข้อมูลไม่ครบ (ข้าม)", `${num(parsed.skipped.length)} แถว`)}
    </div>
    ${parsed.skipped.length ? `<details><summary>ดูแถวที่ข้าม</summary><ul class="history">${parsed.skipped.slice(0, 50)
      .map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}`,
    fresh.length ? `นำเข้า ${num(fresh.length)} รายการ` : null, fresh.length ? "ยกเลิก" : "ปิด");
  wireDialog(async (_, form) => {
    const submit = $("button[type=submit]", form);
    let done = 0;
    try {
      for (let i = 0; i < fresh.length; i += 500) {
        submit.textContent = `กำลังนำเข้า ${num(done)} / ${num(fresh.length)}`;
        done += (await api("POST", "/records/import", { module: m.key, rows: fresh.slice(i, i + 500) })).inserted;
      }
    } catch (err) {
      if (done) refresh();
      throw new Error(done ? `นำเข้าแล้ว ${num(done)} รายการ แล้วเกิดข้อผิดพลาด: ${err.message}` : err.message);
    }
    toast(`นำเข้าแล้ว ${num(done)} รายการ`);
    refresh();
  });
}

// Excel รูปแบบเดียวกับที่นำเข้าได้ (หัวตาราง = ชื่อช่อง) ถ้าไม่มีข้อมูลจะได้แบบฟอร์มเปล่า
function genericWorkbook(m, list) {
  const fields = allFields(m);
  return buildXlsx([{
    name: m.title,
    widths: fields.map((f) => (f.type === "textarea" ? 40 : f.type === "number" ? 10 : 22)),
    bold: new Set([0]),
    rows: [
      fields.map((f) => f.label),
      ...list.map((r) => {
        const v = flat(r);
        return fields.map((f) => (v[f.name] == null ? "" : Array.isArray(v[f.name]) ? v[f.name].join(", ") : v[f.name]));
      }),
    ],
  }]);
}

// ---------- ทำเนียบเภสัชกร (การ์ดรายบุคคล) ----------

const NAME_PREFIX = /^(ภก\.|ภญ\.|นพ\.|พญ\.|นางสาว|นาง|นาย|ดร\.)\s*/;
const initials = (name) => (String(name ?? "").replace(NAME_PREFIX, "").trim().charAt(0) || "?");

async function directoryView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <input type="search" id="q" placeholder="ค้นหาชื่อ ตำแหน่ง หรืองานที่รับผิดชอบ">
      <button class="btn" data-act="import">นำเข้า Excel</button>
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn primary" data-act="new">+ เพิ่มรายชื่อ</button>
    </div>
    <div id="dir-summary"></div>
    <div id="people"></div>`;
  const all = (await api("GET", `/records?module=${m.key}`))
    .sort((a, b) => (a.data.seq ?? 1e9) - (b.data.seq ?? 1e9) || String(a.data.full_name).localeCompare(String(b.data.full_name), "th"));
  let shown = [];
  const field = (name) => fieldOf(m, name);
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    shown = q ? all.filter((r) => recordText(r).includes(q)) : all;
    const active = all.filter((r) => !r.data.status || r.data.status === "ปฏิบัติงาน").length;
    $("#dir-summary").innerHTML = all.length ? `<p class="hint">ทั้งหมด ${num(all.length)} คน · ปฏิบัติงาน ${num(active)} คน${
      q ? ` · พบ ${num(shown.length)} คน` : ""}</p>` : "";
    const canEdit = (r) => me.role === "admin" || r.created_by === me.id;
    $("#people").innerHTML = shown.length ? `<div class="people">${shown.map((r) => {
      const d = r.data;
      const away = d.status && d.status !== "ปฏิบัติงาน";
      return `<article class="person${away ? " away" : ""}">
        <div class="person-head">
          <span class="avatar" aria-hidden="true">${esc(initials(d.full_name))}</span>
          <div><h3>${esc(d.full_name)}</h3><p>${esc(d.position || "")}</p></div>
          ${away ? badge(d.status, "muted") : ""}
        </div>
        <dl>
          ${d.license ? `<dt>${esc(field("license").label)}</dt><dd>${esc(d.license)}</dd>` : ""}
          ${d.duty ? `<dt>${esc(field("duty").label)}</dt><dd class="pre">${esc(d.duty)}</dd>` : ""}
          ${d.phone ? `<dt>${esc(field("phone").label)}</dt><dd><a href="tel:${esc(d.phone.replace(/[^\d+]/g, ""))}">${esc(d.phone)}</a></dd>` : ""}
          ${d.email ? `<dt>${esc(field("email").label)}</dt><dd><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></dd>` : ""}
          ${d.note ? `<dt>${esc(field("note").label)}</dt><dd class="pre">${esc(d.note)}</dd>` : ""}
        </dl>
        <div class="person-actions">
          ${canEdit(r) ? btn("edit", "แก้ไข", r.id) : btn("open", "ดู", r.id)}
          ${me.role === "admin" ? btn("delete", "ลบ", r.id, "danger") : ""}
        </div>
      </article>`;
    }).join("")}</div>` : `<p class="empty">${q ? "ไม่พบรายชื่อที่ค้นหา" : 'ยังไม่มีรายชื่อ กด "+ เพิ่มรายชื่อ" หรือ "นำเข้า Excel" (กด "ดาวน์โหลด Excel" เพื่อรับแบบฟอร์ม)'}</p>`;
  };
  $("#q").oninput = draw;
  const byId = (id) => all.find((r) => String(r.id) === String(id));
  bind({
    new: () => openRecordForm(m),
    open: (id) => openRecord(id),
    edit: (id) => openRecordForm(m, byId(id)),
    delete: async (id) => {
      const r = byId(id);
      if (!confirm(`ลบ ${r.data.full_name} ออกจากทำเนียบ? (ข้อมูลยังเก็บไว้ในประวัติ)`)) return;
      try { await api("POST", `/records/${id}/delete`, {}); toast("ลบแล้ว"); refresh(); } catch (err) { toast(err.message, true); }
    },
    import: () => importGeneric(m),
    xlsx: () => downloadBlob(genericWorkbook(m, shown), `${m.title}.xlsx`),
  });
  draw();
}

// ตารางเวร: แสดงเป็นปฏิทินรายเดือน (มือถือแสดงเป็นรายการวัน)
async function calendarView(m) {
  if (!currentMonth) currentMonth = isoDate().slice(0, 7);
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      ${monthInput()}
      <button class="btn" data-act="csv">ส่งออก CSV</button>
      <button class="btn primary" data-act="new">+ เพิ่มเวร</button>
    </div>
    <div id="cal"></div>
    <div id="stats"></div>`;
  const [first, second] = m.list.map((n) => fieldOf(m, n));
  const DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  let list = [];
  const load = async () => {
    if (!currentMonth) { currentMonth = isoDate().slice(0, 7); $("#month").value = currentMonth; }
    list = await api("GET", `/records?module=${m.key}&month=${currentMonth}`);
    const order = (r) => (first.options || []).indexOf(r.data[first.name]);
    const byDate = new Map();
    for (const r of [...list].sort((a, b) => order(a) - order(b))) {
      if (!byDate.has(r.record_date)) byDate.set(r.record_date, []);
      byDate.get(r.record_date).push(r);
    }
    const [y, mo] = currentMonth.split("-").map(Number);
    const days = new Date(y, mo, 0).getDate();
    const today = isoDate();
    let cells = DOW.map((d) => `<div class="cal-head">${d}</div>`).join("") +
      `<div class="cal-blank"></div>`.repeat(new Date(y, mo - 1, 1).getDay());
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${pad(mo)}-${pad(d)}`;
      const dow = new Date(y, mo - 1, d).getDay();
      cells += `<div class="cal-day${iso === today ? " today" : ""}${dow === 0 || dow === 6 ? " weekend" : ""}">
        <div class="cal-date"><b>${d}</b> <span class="dow">${DOW[dow]}</span>
          <button type="button" class="cal-add" data-act="add" data-id="${iso}" aria-label="เพิ่มเวรวันที่ ${d}">+</button></div>
        ${(byDate.get(iso) || []).map((r) => `<button type="button" class="cal-entry" data-act="open" data-id="${r.id}">
          <small>${esc(String(r.data[first.name] ?? "").split(" (")[0])}</small> ${esc(r.data[second.name] ?? "")}</button>`).join("")}
      </div>`;
    }
    $("#cal").innerHTML = `<div class="calendar">${cells}</div>`;
    $("#stats").innerHTML = statsHtml(m, list);
  };
  wireMonth(load);
  bind({
    new: () => openRecordForm(m),
    add: (iso) => openRecordForm(m, null, { record_date: iso }),
    open: (id) => openRecord(id),
    csv: () => exportCsv(m, list),
  });
  await load();
}

// ---------- ค้นหาทั้งระบบ ----------

let searchText = "";

function openSearch(text) {
  searchText = text;
  if (current === "search") refresh(); else show("search");
}

async function searchView() {
  view.innerHTML = `<div class="toolbar">
      <h2>ค้นหา</h2>
      <form id="search-page-form" class="inline-form">
        <input type="search" name="q" placeholder="HN ชื่อผู้ป่วย ชื่อยา หรือชื่องาน" value="${esc(searchText)}" required aria-label="ค้นหา" autocomplete="off">
        <button class="btn primary">ค้นหา</button>
      </form>
    </div>
    <div id="result"></div>`;
  $("#search-page-form").onsubmit = (e) => {
    e.preventDefault();
    searchText = e.target.q.value.trim();
    searchView().catch((err) => toast(err.message, true));
  };
  if (!searchText) {
    $("#result").innerHTML = `<p class="hint">พิมพ์คำที่ต้องการค้นหา เช่น HN ชื่อผู้ป่วย ชื่อยา หน่วยงาน หรือชื่องาน</p>`;
    $("[name=q]").focus();
    return;
  }
  const q = searchText.toLowerCase();
  const menus = MODULES.filter((m) => `${m.title} ${m.group}`.toLowerCase().includes(q));
  // เซิร์ฟเวอร์ค้นใน JSON ทั้งก้อนซึ่งรวมชื่อช่องด้วย จึงกรองซ้ำเฉพาะค่าที่กรอกจริง
  const list = (await api("GET", `/records?q=${encodeURIComponent(searchText)}`))
    .filter((r) => `${recordText(r)} ${r.created_by_name}`.includes(q));
  const shown = list.slice(0, 300);
  $("#result").innerHTML = `
    ${menus.length ? `<section class="card"><h2>งานที่ตรงกับคำค้น</h2><div class="row">${menus.map((m) =>
      btn("go", m.title, m.key, "primary")).join("")}</div></section>` : ""}
    <p class="hint">พบ ${num(list.length)} บันทึกที่มีคำว่า "<b>${esc(searchText)}</b>"${list.length > shown.length ? ` (แสดง ${num(shown.length)} รายการล่าสุด)` : ""}</p>
    <div class="list">${table(["วันที่", "งาน", "HN", "ชื่อผู้ป่วย", "สรุป", "ผู้บันทึก", ""],
      shown.map((r) => {
        const m = MOD[r.module];
        return [when(r.record_date, false), esc(m?.title || r.module), esc(r.hn || "-"), esc(r.patient_name || "-"),
          m ? summaryText(m, r) : "-", esc(r.created_by_name), actions(btn("open", "ดู", r.id))];
      }), "ไม่พบบันทึกที่ตรงกับคำค้น")}</div>`;
  bind({ go: (key) => show(key), open: (id) => openRecord(id) });
}

// ---------- ประวัติผู้ป่วย ----------

let patientHN = "";

function openPatient(hn) {
  patientHN = hn;
  if (current === "patient") refresh(); else show("patient");
}

async function patientView() {
  view.innerHTML = `<div class="toolbar">
      <h2>ประวัติผู้ป่วย</h2>
      <form id="hn-form" class="inline-form">
        <input type="search" name="hn" placeholder="ใส่ HN" value="${esc(patientHN)}" required aria-label="HN" autocomplete="off">
        <button class="btn primary">ค้นหา</button>
      </form>
    </div>
    <div id="result"></div>`;
  $("#hn-form").onsubmit = (e) => {
    e.preventDefault();
    patientHN = e.target.hn.value.trim();
    patientView().catch((err) => toast(err.message, true));
  };
  if (!patientHN) {
    $("#result").innerHTML = `<p class="hint">ใส่ HN เพื่อดูประวัติแพ้ยาและบันทึกทุกงานของผู้ป่วยรายนั้น</p>`;
    $("[name=hn]").focus();
    return;
  }
  const list = await api("GET", `/records?hn=${encodeURIComponent(patientHN)}`);
  const name = list.find((r) => r.patient_name)?.patient_name || "";
  const patientModules = MODULES.filter((m) => m.patient);
  $("#result").innerHTML = `<section class="card">
      <h2>HN ${esc(patientHN)}${name ? ` · ${esc(name)}` : ""}</h2>
      ${patientAlert(list)}
      <div class="row">
        <select id="new-mod" aria-label="งานที่จะบันทึก">${patientModules.map((m) => option(m.key, m.title)).join("")}</select>
        <button class="btn primary" data-act="new">+ บันทึกใหม่ให้ผู้ป่วยรายนี้</button>
      </div>
    </section>
    <div class="list">${table(["วันที่", "งาน", "สรุป", "ผู้บันทึก", ""],
      list.map((r) => {
        const m = MOD[r.module];
        return [when(r.record_date, false), esc(m?.title || r.module), m ? summaryText(m, r) : "-",
          esc(r.created_by_name), actions(btn("open", "ดู", r.id))];
      }), "ยังไม่มีบันทึกของ HN นี้")}</div>`;
  bind({
    new: () => openRecordForm(MOD[$("#new-mod").value], null, { hn: patientHN, patient_name: name }),
    open: (id) => openRecord(id),
  });
}

// ---------- ไอคอนและภาพประกอบ (SVG ในหน้า ไม่ต้องโหลดไฟล์) ----------

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>',
  adr: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8v5M12 16.5v.01"/>',
  med_error: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4M12 17v.01"/>',
  offhour_rx: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  counsel: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  medrec: '<path d="M9 3h6v3H9z"/><path d="M7 4.5H5V21h14V4.5h-2"/><path d="M8.5 13.5l2 2 4.5-4.5"/>',
  warfarin: '<path d="M12 3c3.5 4.5 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.5-6.5 6-11z"/>',
  copd: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  dm: '<path d="M15 3l6 6M18 6l-9.5 9.5-4-4L14 2M4.5 19.5l2-2M8 11l2 2M11 8l2 2"/>',
  stock_check: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  purchase: '<path d="M3 4h2l2.5 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  duty: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
const icon = (key) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key] || ICONS.home}</svg>`;

// ภาพขวดยา Rx แคปซูล และเม็ดยา สีมาจากตัวแปร CSS (--ill-*)
const pillArt = (cls = "") => `<svg class="pill-art ${cls}" viewBox="0 0 320 220" aria-hidden="true">
  <circle class="ill-glow" cx="175" cy="112" r="96"/>
  <path class="ill-spark" d="M58 46v18M49 55h18M282 160v12M276 166h12"/>
  <rect class="ill-cap" x="130" y="34" width="62" height="26" rx="6"/>
  <rect class="ill-bottle" x="117" y="56" width="88" height="134" rx="18"/>
  <rect class="ill-shine" x="127" y="68" width="8" height="108" rx="4"/>
  <rect class="ill-label" x="131" y="94" width="62" height="60" rx="9"/>
  <text class="ill-rx" x="162" y="134" text-anchor="middle">Rx</text>
  <g transform="rotate(-32 255 92)">
    <rect class="ill-capsule-a" x="215" y="77" width="80" height="30" rx="15"/>
    <path class="ill-capsule-b" d="M255 77h25a15 15 0 0 1 0 30h-25z"/>
  </g>
  <circle class="ill-pill" cx="62" cy="168" r="22"/>
  <path class="ill-line" d="M47 168h30"/>
  <circle class="ill-pill-b" cx="99" cy="194" r="13"/>
  <circle class="ill-pill-b" cx="248" cy="196" r="9"/>
</svg>`;

const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
function longDate(d = new Date()) {
  return `วัน${TH_DAYS[d.getDay()]}ที่ ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
}

// ---------- หน้าแรก ----------

async function dashboardView() {
  const s = await api("GET", `/summary${currentMonth ? "?month=" + currentMonth : ""}`);
  const groups = [];
  for (const m of MODULES) {
    if (groups.at(-1)?.[0] !== m.group) groups.push([m.group, []]);
    groups.at(-1)[1].push(m);
  }
  view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="hero-kicker">${longDate()}</p>
        <h1>${greeting()}, ${esc(me.full_name)}</h1>
        <p>งานบริการเภสัชกรรม โรงพยาบาลตาพระยา</p>
        <form class="hero-search" id="search-form">
          <input type="search" name="q" required placeholder="ค้นหาในระบบ เช่น HN ชื่อผู้ป่วย ชื่อยา" aria-label="ค้นหา" autocomplete="off">
          <button class="btn">ค้นหา</button>
        </form>
      </div>
      ${pillArt("hero-art")}
    </section>
    <div class="toolbar"><h2>สรุปเดือน${monthLabel(s.month)}</h2>${monthInput()}</div>
    ${groups.map(([g, mods], gi) => `<h3 class="group-title g${gi}"><i></i>${esc(g)}</h3>
      <section class="mod-grid">${mods.map((m) => `<button type="button" class="mod-card g${gi}" data-act="go" data-id="${m.key}">
        <span class="mod-icon">${icon(m.key)}</span>
        <span><b>${num((m.no_date ? s.totals?.[m.key] : s.counts[m.key]) || 0)}</b><span>${esc(m.title)}${
          m.no_date ? ` <small>(${esc(m.count_unit || "รายการ")})</small>` : ""}</span></span></button>`).join("")}</section>`).join("")}
    <section class="card offhour-panel" id="offhour-panel" hidden></section>
    <div class="grid2">
      <section class="card"><h2>เวรวันนี้ <small>${when(s.today, false)}</small></h2>
        ${table(["เวร", "เภสัชกร", "หมายเหตุ"], s.duty_today.map((r) =>
          [esc(r.data.shift), esc(r.data.staff), esc(r.data.note || "")]), "ยังไม่ได้ลงเวรวันนี้")}</section>
      <section class="card"><h2>นัดหมายคลินิก <small>ขาดนัด 30 วัน และนัดใน 14 วัน</small></h2>
        ${table(["วันนัด", "คลินิก", "HN", "ชื่อ", ""], s.appointments.map((r) => {
          const d = r.data.next_visit;
          const tag = d < s.today ? badge("ขาดนัด", "bad") : d === s.today ? badge("วันนี้", "warn") : "";
          return [`${when(d, false)} ${tag}`, esc(MOD[r.module]?.title || r.module), esc(r.hn), esc(r.patient_name),
            actions(btn("open", "ดู", r.id))];
        }), "ไม่มีนัดในช่วงนี้")}</section>
    </div>`;
  $("#search-form").onsubmit = (e) => { e.preventDefault(); openSearch(e.target.q.value.trim()); };
  wireMonth(dashboardView);
  bind({ go: (key) => show(key), open: (id) => openRecord(id) });
  offhourPanel(s.month).catch(() => {});
}

// ---------- ผู้ใช้ (ผู้ดูแลระบบ) ----------

const ROLE_LABEL = { admin: "ผู้ดูแลระบบ", pharmacist: "เภสัชกร" };

async function usersView() {
  const users = await api("GET", "/users");
  view.innerHTML = `<div class="toolbar"><h2>ผู้ใช้</h2><button class="btn primary" data-act="new">+ เพิ่มผู้ใช้</button></div>
    <p class="hint"><b>เภสัชกร</b> บันทึกและดูข้อมูลได้ทุกงาน แก้ไขได้เฉพาะบันทึกของตัวเอง <b>ผู้ดูแลระบบ</b> แก้ไขและลบได้ทุกบันทึก และจัดการผู้ใช้</p>
    <div class="list">${table(["ชื่อผู้ใช้", "ชื่อ-นามสกุล", "สิทธิ์", "สถานะ", ""],
      users.map((u) => [esc(u.username), esc(u.full_name), u.role === "admin" ? badge(ROLE_LABEL.admin, "info") : ROLE_LABEL[u.role],
        u.active ? badge("ใช้งาน", "ok") : badge("ปิดใช้งาน", "muted"), actions(btn("edit", "แก้ไข", u.id))]), "ยังไม่มีผู้ใช้")}</div>`;
  const form = (u) => openForm({
    title: u ? `แก้ไขผู้ใช้ ${u.username}` : "เพิ่มผู้ใช้",
    fields: [
      ...(u ? [] : [{ name: "username", label: "ชื่อผู้ใช้ (ใช้ล็อกอิน)", required: true, placeholder: "เช่น pharm01", autocomplete: "off",
        hint: "ภาษาอังกฤษ ตัวเลข . _ - เท่านั้น" }]),
      { name: "full_name", label: "ชื่อ-นามสกุล", required: true, placeholder: "เช่น ภก.สมชาย ใจดี", hint: "ชื่อนี้ใช้ในตารางเวรและผู้บันทึก" },
      { name: "role", label: "สิทธิ์", type: "select", noBlank: true, options: Object.entries(ROLE_LABEL).reverse() },
      ...(u ? [{ name: "active", label: "สถานะ", type: "select", noBlank: true, options: [["1", "ใช้งาน"], ["0", "ปิดใช้งาน"]] }] : []),
      { name: "password", label: u ? "ตั้งรหัสผ่านใหม่" : "รหัสผ่าน", type: "password", required: !u, autocomplete: "new-password",
        hint: u ? "เว้นว่างถ้าไม่เปลี่ยน" : "อย่างน้อย 6 ตัวอักษร" },
    ],
    values: u ? { ...u, active: String(u.active) } : { role: "pharmacist" },
    onSubmit: async (v) => {
      await api(u ? "PUT" : "POST", u ? `/users/${u.id}` : "/users", { ...v, active: v.active !== "0" });
      STAFF = await api("GET", "/staff");
      toast("บันทึกแล้ว"); refresh();
    },
  });
  bind({ new: () => form(), edit: (id) => form(users.find((u) => String(u.id) === id)) });
}

// ---------- เข้าสู่ระบบ ----------

function authScreen(setupMode) {
  document.body.classList.add("auth");
  $("#tabs").innerHTML = "";
  $("#userbox").innerHTML = "";
  view.onclick = null;
  view.innerHTML = `<form class="card auth-card" id="auth-form">
      <div class="auth-head">
        <img src="logo.png" alt="โรงพยาบาลตาพระยา" width="640" height="270">
        ${pillArt("auth-art")}
      </div>
      <p class="auth-title">Rx-TPY · งานบริการเภสัชกรรม</p>
      <h2>${setupMode ? "ตั้งค่าระบบครั้งแรก" : "เข้าสู่ระบบ"}</h2>
      ${setupMode ? `<p class="hint">สร้างบัญชีผู้ดูแลระบบคนแรก จากนั้นเพิ่มบัญชีเภสัชกรได้ในเมนู "ผู้ใช้"</p>` : ""}
      <div class="fields">
        ${setupMode ? fieldHtml({ name: "full_name", label: "ชื่อ-นามสกุล", required: true }) : ""}
        ${fieldHtml({ name: "username", label: "ชื่อผู้ใช้", required: true, autocomplete: "username" })}
        ${fieldHtml({ name: "password", label: "รหัสผ่าน", type: "password", required: true,
          autocomplete: setupMode ? "new-password" : "current-password", hint: setupMode ? "อย่างน้อย 6 ตัวอักษร" : "" })}
      </div>
      <p class="form-error" hidden></p>
      <button type="submit" class="btn primary block">${setupMode ? "สร้างบัญชีและเข้าสู่ระบบ" : "เข้าสู่ระบบ"}</button>
    </form>`;
  const form = $("#auth-form");
  $("input", form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const error = $(".form-error", form);
    error.hidden = true;
    try {
      me = await api("POST", setupMode ? "/setup" : "/login", Object.fromEntries(new FormData(form)));
      await startApp();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
}

function changePassword() {
  openForm({
    title: "เปลี่ยนรหัสผ่าน",
    fields: [
      { name: "old_password", label: "รหัสผ่านเดิม", type: "password", required: true, autocomplete: "current-password" },
      { name: "new_password", label: "รหัสผ่านใหม่", type: "password", required: true, autocomplete: "new-password", hint: "อย่างน้อย 6 ตัวอักษร" },
    ],
    onSubmit: async (d) => { await api("POST", "/me/password", d); toast("เปลี่ยนรหัสผ่านแล้ว"); },
  });
}

// ---------- เมนูและการสลับหน้า ----------

let VIEWS = {};
let current = null;

function buildViews() {
  VIEWS = {
    home: { title: "Dashboard", render: dashboardView },
    // สองหน้านี้ไม่แสดงในเมนู: เข้าจากช่องค้นหาใน Dashboard และปุ่มในหน้าบันทึก
    search: { title: "ค้นหา", render: searchView, hidden: true },
    patient: { title: "ประวัติผู้ป่วย", render: patientView, hidden: true },
  };
  for (const m of MODULES) VIEWS[m.key] = { title: m.title, group: m.group, render: () => moduleView(m) };
  VIEWS.users = { title: "ผู้ใช้", group: "ตั้งค่า", render: usersView, role: "admin" };
}
const allowed = (key) => Boolean(VIEWS[key]) && (!VIEWS[key].role || me?.role === VIEWS[key].role);

function setNav(open) {
  document.body.classList.toggle("nav-open", open);
  $("#menu-btn").setAttribute("aria-expanded", String(open));
}

async function show(tab) {
  if (!me) return;
  if (!allowed(tab)) tab = "home";
  current = tab;
  if (dlg.open) dlg.close();
  setNav(false);
  view.onkeydown = view.onchange = null;
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  let html = "";
  let group = null;
  for (const [key, v] of Object.entries(VIEWS)) {
    if (!allowed(key) || v.hidden) continue;
    if (v.group && v.group !== group) { group = v.group; html += `<div class="nav-group">${esc(group)}</div>`; }
    html += `<button type="button" data-tab="${key}" ${key === tab ? 'aria-current="page"' : ""}>${esc(v.title)}</button>`;
  }
  $("#tabs").innerHTML = html;
  try {
    await VIEWS[tab].render();
  } catch (e) {
    if (me) view.innerHTML = `<p class="form-error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</p>`;
  }
}

// โหลดหน้าปัจจุบันใหม่โดยไม่ปิดกล่องข้อความที่เปิดอยู่
function refresh() {
  if (current && me) VIEWS[current].render().catch((e) => toast(e.message, true));
}

async function startApp() {
  await loadMeta();
  buildViews();
  document.body.classList.remove("auth");
  $("#userbox").innerHTML = `<span><b>${esc(me.full_name)}</b><small>${esc(ROLE_LABEL[me.role] || "")}</small></span>
    <button class="btn small" id="pw">เปลี่ยนรหัสผ่าน</button>
    <button class="btn small" id="logout">ออกจากระบบ</button>`;
  $("#pw").onclick = changePassword;
  $("#logout").onclick = async () => {
    try { await api("POST", "/logout", {}); } catch {}
    me = null;
    authScreen(false);
  };
  show(location.hash.slice(1));
}

unauthorized = () => {
  if (!me) return;
  me = null;
  if (dlg.open) dlg.close();
  toast("หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่", true);
  authScreen(false);
};

$("#tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); };
$("#menu-btn").onclick = () => setNav(!document.body.classList.contains("nav-open"));
window.addEventListener("hashchange", () => { if (location.hash.slice(1) !== current) show(location.hash.slice(1)); });

(async function boot() {
  try {
    const { needs_setup } = await api("GET", "/setup");
    if (needs_setup) return authScreen(true);
    me = await api("GET", "/me");
    await startApp();
  } catch {
    authScreen(false);
  }
})();
