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
    { name: "record_date", label: m.date_label || "วันที่", type: "date", required: true },
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
  const ACTION = { create: "สร้างบันทึก", update: "แก้ไข", delete: "ลบ" };
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

async function moduleView(m) {
  if (m.view === "calendar") return calendarView(m);
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      ${monthInput()}
      <input type="search" id="q" placeholder="${m.patient ? "ค้นหา HN ชื่อ หรือข้อความ" : "ค้นหา"}">
      <button class="btn" data-act="csv">ส่งออก CSV</button>
      <button class="btn primary" data-act="new">+ บันทึกใหม่</button>
    </div>
    <div id="stats"></div>
    <div class="list" id="list"></div>`;
  const listFields = m.list.map((n) => fieldOf(m, n));
  let list = [];
  let shown = [];
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    shown = q ? list.filter((r) => recordText(r).includes(q)) : list;
    $("#stats").innerHTML = statsHtml(m, shown);
    $("#list").innerHTML = table(
      [m.date_label || "วันที่", ...(m.patient ? ["HN", "ชื่อผู้ป่วย"] : []),
        ...listFields.map((f) => (f.type === "number" ? [f.label, "num"] : f.label)), "ผู้บันทึก", ""],
      shown.map((r) => [
        when(r.record_date, false),
        ...(m.patient ? [esc(r.hn || "-"), esc(r.patient_name || "-")] : []),
        ...listFields.map((f) => (f.type === "number" ? [showValue(f, r.data[f.name]), "num"] : showValue(f, r.data[f.name]))),
        esc(r.created_by_name),
        actions(btn("open", "ดู", r.id)),
      ]),
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
        <form class="hero-search" id="hn-form">
          <input name="hn" required placeholder="ค้นหาประวัติผู้ป่วยด้วย HN" aria-label="HN" autocomplete="off">
          <button class="btn">ค้นหา</button>
        </form>
      </div>
      ${pillArt("hero-art")}
    </section>
    <div class="toolbar"><h2>สรุปเดือน${monthLabel(s.month)}</h2>${monthInput()}</div>
    ${groups.map(([g, mods], gi) => `<h3 class="group-title g${gi}"><i></i>${esc(g)}</h3>
      <section class="mod-grid">${mods.map((m) => `<button type="button" class="mod-card g${gi}" data-act="go" data-id="${m.key}">
        <span class="mod-icon">${icon(m.key)}</span>
        <span><b>${num(s.counts[m.key] || 0)}</b><span>${esc(m.title)}</span></span></button>`).join("")}</section>`).join("")}
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
  $("#hn-form").onsubmit = (e) => { e.preventDefault(); openPatient(e.target.hn.value.trim()); };
  wireMonth(dashboardView);
  bind({ go: (key) => show(key), open: (id) => openRecord(id) });
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
    home: { title: "หน้าแรก", render: dashboardView },
    patient: { title: "ค้นหาผู้ป่วย", render: patientView },
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
    if (!allowed(key)) continue;
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
