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
  return (f.section ? `<h3 class="form-section full">${esc(f.section)}</h3>` : "") + fieldControl(f, values);
}

function fieldControl(f, values = {}) {
  const v = values[f.name] ?? f.value ?? "";
  const label = `${esc(f.label)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ""}${f.required ? " *" : ""}`;
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
  if (f.type === "file") {
    const cur = v && typeof v === "object" ? v : null;
    return `<div class="field full"><span>${label}</span>
      <input type="hidden" name="${f.name}" value="${cur ? Number(cur.id) : ""}">
      ${cur ? `<div class="file-current">${fileLink(cur)} <small>${fileSize(cur.size)}</small>
        <button type="button" class="btn small" data-clear-file="${f.name}">เอาไฟล์ออก</button></div>` : ""}
      <input type="file" name="${f.name}__upload" accept="${esc(f.accept || ".pdf")}" aria-label="${esc(f.label)}">
      <small>${cur ? "เลือกไฟล์ใหม่ถ้าต้องการแทนที่ไฟล์เดิม" : "รองรับไฟล์ PDF ขนาดไม่เกิน 20 MB"}</small>${hint}</div>`;
  }
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
    input = `<textarea rows="${Number(f.rows) || 3}" ${attrs}>${esc(v)}</textarea>`;
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
  if (f.type === "answers") return html ? `<small class="muted">ผลรายข้อ ${num(Object.keys(v).length)} ค่า</small>` : "ผลรายข้อ";
  if (f.type === "file") return html ? `${fileLink(v)} <small>${fileSize(v.size)}</small>` : v.name;
  if (Array.isArray(v)) text = v.join(", ");
  else if (f.type === "date") text = when(v, false);
  else if (f.type === "number") text = (f.be_year ? String(v) : num(v)) + (f.unit ? " " + f.unit : "");
  else text = String(v);
  return html ? esc(text) : text;
}

const recordText = (r) => [r.hn, r.patient_name, ...Object.values(r.data).flat()
  .map((v) => (v && typeof v === "object" ? v.name : v))].join(" ").toLowerCase();

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

// ตรวจค่าในฟอร์มเพิ่มเติมเฉพาะงาน (นอกจากที่เซิร์ฟเวอร์ตรวจ) คืนข้อความผิดพลาด หรือค่าว่างถ้าผ่าน
const FORM_CHECKS = {
  renal_drugs: (body) => {
    const { bands, errors } = parseBands(body.bands);
    return errors[0] || (bands.length ? "" : "กรุณาใส่ช่วงค่าการทำงานของไตอย่างน้อย 1 ช่วง");
  },
};

function openRecordForm(m, rec = null, preset = {}) {
  if (m.view === "due") return openDueForm(m, rec, preset);
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
      const problem = FORM_CHECKS[m.key]?.(body);
      if (problem) throw new Error(problem);
      // อัปโหลดไฟล์ที่เลือกใหม่ก่อน แล้วส่ง id ไฟล์ไปกับบันทึก
      for (const field of fields.filter((x) => x.type === "file")) {
        const file = f.querySelector(`[name="${field.name}__upload"]`)?.files[0];
        if (!file) continue;
        const submit = $("button[type=submit]", f);
        const up = await uploadFile(file, (p) => { submit.textContent = `กำลังอัปโหลด ${Math.round(p * 100)}%`; });
        body[field.name] = up.id;
        f.querySelector(`[name="${field.name}"]`).value = up.id;
        f.querySelector(`[name="${field.name}__upload"]`).value = "";
      }
      await api(rec ? "PUT" : "POST", rec ? `/records/${rec.id}` : "/records", body);
      toast(rec ? "บันทึกการแก้ไขแล้ว" : "บันทึกแล้ว");
      refresh();
    },
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-clear-file]");
    if (!b) return;
    form.querySelector(`[name="${b.dataset.clearFile}"]`).value = "";
    b.closest(".file-current").remove();
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
  if (m.view === "due") return openDueRecord(rec);
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
  if (m.view === "documents") return documentsView(m);
  if (m.view === "stockcheck") return stockcheckView(m);
  if (m.view === "drugsafety") return drugsafetyView(m);
  if (m.view === "renal") return renalView(m);
  if (m.view === "due") return dueView(m);
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
  if (y < 100) y += 2500; // ปีย่อ 2 หลักถือเป็น พ.ศ. 25xx เช่น 68 = 2568
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
  const safety = await loadSafetyMap().catch(() => new Map());
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
        ...shown.map((r) => [[num(r.data.seq), "num"], `${esc(r.data.drug)} ${safetyFlags(safety.get(safetyKey(r.data.drug))?.data)}`, esc(r.data.category || "-"),
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
      if (f.be_year) {
        const y = beYear(raw);
        if (y == null) problem = `${f.label} "${text}" ไม่ใช่ปี พ.ศ.`;
        else row[f.name] = y;
      } else if (f.type === "number") {
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

// ปี พ.ศ. จากค่าใน Excel: 2560, ค.ศ. 2017, วันที่ 1/6/2560 หรือวันที่ที่ Excel เก็บเป็นตัวเลข
function beYear(raw) {
  const n = cellNum(raw);
  if (n != null && Number.isInteger(n)) {
    if (n >= 2400 && n <= 2800) return n;
    if (n >= 1900 && n <= 2200) return n + 543;
  }
  const d = excelDate(raw);
  return d ? Number(fixYear(d, null).slice(0, 4)) + 543 : null;
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
    .sort((a, b) => (a.data.start_year ?? 1e9) - (b.data.start_year ?? 1e9) || (a.data.seq ?? 1e9) - (b.data.seq ?? 1e9) ||
      String(a.data.full_name).localeCompare(String(b.data.full_name), "th"));
  const thisYear = new Date().getFullYear() + 543;
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
          ${d.start_year ? `<dt>เริ่มปฏิบัติงาน</dt><dd>พ.ศ. ${esc(d.start_year)}${
            d.start_year < thisYear ? ` <small>(${num(thisYear - d.start_year)} ปี)</small>` : d.start_year === thisYear ? " <small>(ปีแรก)</small>" : ""}</dd>` : ""}
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

// ---------- ไฟล์แนบ (PDF) ----------
// อัปโหลดทีละส่วนเป็น base64 แล้วเซิร์ฟเวอร์เก็บไว้ในฐานข้อมูล เปิดไฟล์โดยดึงทุกส่วนมาประกอบเป็น Blob

const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fileLink = (f) => `<button type="button" class="link-btn" data-open-file="${Number(f.id)}">📄 ${esc(f.name)}</button>`;

function blobToBase64(blob) {
  const read = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    reader.readAsDataURL(blob);
  });
  return withTimeout(read, 20000, "อ่านไฟล์ไม่ได้ ถ้าไฟล์นี้เปิดอยู่ในโปรแกรมอื่นให้ปิดก่อนแล้วลองใหม่");
}

function base64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function uploadFile(file, onProgress = () => {}) {
  if (!/\.pdf$/i.test(file.name)) throw new Error(`${file.name}: รองรับเฉพาะไฟล์ PDF`);
  if (!file.size) throw new Error(`${file.name}: ไฟล์ว่างเปล่า`);
  const meta = await api("POST", "/files", { name: file.name, size: file.size });
  for (let n = 0; n < meta.chunks; n++) {
    const data = await blobToBase64(file.slice(n * meta.chunk_size, (n + 1) * meta.chunk_size));
    await api("POST", `/files/${meta.id}/chunks`, { n, data });
    onProgress((n + 1) / meta.chunks);
  }
  return api("POST", `/files/${meta.id}/finish`, {});
}

async function openFile(id, download = false) {
  // เปิดแท็บใหม่ทันทีตอนกด (ถ้ารอโหลดเสร็จก่อน เบราว์เซอร์จะบล็อกป๊อปอัป)
  const win = download ? null : window.open("", "_blank");
  if (win) win.document.write('<p style="font-family:sans-serif;padding:1rem">กำลังโหลดไฟล์...</p>');
  try {
    toast("กำลังโหลดไฟล์...");
    const meta = await api("GET", `/files/${id}`);
    const parts = [];
    for (let n = 0; n < meta.chunks; n++) parts.push(base64ToBytes((await api("GET", `/files/${id}/chunks/${n}`)).data));
    const url = URL.createObjectURL(new Blob(parts, { type: meta.mime }));
    if (win) {
      win.location.href = url;
    } else {
      const a = Object.assign(document.createElement("a"), { href: url, download: meta.name });
      document.body.append(a);
      a.click();
      a.remove();
    }
    $("#toast").hidden = true;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    if (win) win.close();
    toast(err.message, true);
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-file]");
  if (!b) return;
  e.preventDefault();
  openFile(Number(b.dataset.openFile), b.hasAttribute("data-download"));
});

function pickFiles(accept) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple: true, hidden: true });
    const done = (files) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done([...input.files]), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    document.body.append(input);
    input.click();
  });
}

// ---------- แนวทางปฏิบัติด้านระบบยา (เอกสาร PDF แยกหมวด) ----------

const MAX_PDF = 20 * 1024 * 1024;

function guessCategory(name, options) {
  const rules = [
    [/นโยบาย/, "นโยบาย"],
    [/ระเบียบ/, "ระเบียบปฏิบัติ"],
    [/(^|[^a-z])wi([^a-z]|$)|วิธีปฏิบัติ/i, "WI (วิธีปฏิบัติงาน)"],
    [/คู่มือ/, "คู่มือ"],
    [/แบบฟอร์ม|form/i, "แบบฟอร์ม"],
    [/แนวทาง|sop|มาตรการ/i, "แนวทางปฏิบัติ"],
  ];
  const hit = rules.find(([re]) => re.test(name));
  return hit && options.includes(hit[1]) ? hit[1] : options.includes("อื่น ๆ") ? "อื่น ๆ" : options[0];
}

const titleFromFile = (name) => name.replace(/\.pdf$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();

async function importPdfs(m) {
  const files = await pickFiles(".pdf");
  if (!files.length) return;
  const existing = await api("GET", `/records?module=${m.key}`);
  const have = new Set(existing.map((r) => uniqueKey(r.data.title)));
  const options = fieldOf(m, "category").options;
  const rows = files.map((file, i) => {
    const title = titleFromFile(file.name);
    const problem = !/\.pdf$/i.test(file.name) ? "ไม่ใช่ไฟล์ PDF" : file.size > MAX_PDF ? `ใหญ่เกิน ${fileSize(MAX_PDF)}` : !file.size ? "ไฟล์ว่าง" : "";
    return { i, file, title, category: guessCategory(file.name, options), problem, dup: have.has(uniqueKey(title)) };
  });
  dlg.className = "wide";
  dlg.innerHTML = dialogShell("นำเข้าไฟล์ PDF", `
    <p class="hint">ตรวจชื่อเอกสารและหมวดหมู่ที่ระบบเดาจากชื่อไฟล์ แก้ได้ก่อนกดนำเข้า ไฟล์ที่ชื่อซ้ำกับเอกสารที่มีอยู่จะไม่ถูกเลือกไว้</p>
    <div class="table-wrap"><table class="pdf-import"><thead><tr><th></th><th>ไฟล์</th><th>ชื่อเอกสาร</th><th>หมวดหมู่</th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td><input type="checkbox" data-pick="${r.i}" ${r.problem || r.dup ? "" : "checked"} ${r.problem ? "disabled" : ""} aria-label="นำเข้า ${esc(r.file.name)}"></td>
      <td><small>${esc(r.file.name)}<br>${fileSize(r.file.size)}</small>${r.problem ? `<br>${badge(r.problem, "bad")}` : r.dup ? `<br>${badge("มีชื่อนี้แล้ว", "warn")}` : ""}</td>
      <td><input data-title="${r.i}" value="${esc(r.title)}" aria-label="ชื่อเอกสาร"></td>
      <td><select data-cat="${r.i}" aria-label="หมวดหมู่">${options.map((o) => option(o, o, r.category)).join("")}</select></td>
    </tr>`).join("")}</tbody></table></div>
    <p class="meta" id="pdf-progress"></p>`, "นำเข้าไฟล์ที่เลือก");
  wireDialog(async (_, form) => {
    const chosen = rows.filter((r) => form.querySelector(`[data-pick="${r.i}"]`).checked);
    if (!chosen.length) throw new Error("ยังไม่ได้เลือกไฟล์");
    const submit = $("button[type=submit]", form);
    const progress = $("#pdf-progress", form);
    const failed = [];
    let done = 0;
    for (const [k, r] of chosen.entries()) {
      const title = form.querySelector(`[data-title="${r.i}"]`).value.trim() || titleFromFile(r.file.name);
      const category = form.querySelector(`[data-cat="${r.i}"]`).value;
      try {
        const up = await uploadFile(r.file, (p) => {
          submit.textContent = `กำลังอัปโหลด ${k + 1} / ${chosen.length} (${Math.round(p * 100)}%)`;
        });
        await api("POST", "/records", { module: m.key, title, category, file: up.id });
        done++;
        // กันนำเข้าซ้ำถ้ากดลองใหม่หลังมีบางไฟล์ไม่สำเร็จ
        Object.assign(form.querySelector(`[data-pick="${r.i}"]`), { checked: false, disabled: true });
      } catch (err) {
        failed.push(`${r.file.name}: ${err.message}`);
      }
      progress.textContent = `นำเข้าแล้ว ${done} / ${chosen.length}${failed.length ? ` · ไม่สำเร็จ ${failed.length}` : ""}`;
    }
    refresh();
    if (failed.length) {
      submit.textContent = "ปิด";
      throw new Error(`นำเข้าแล้ว ${done} ไฟล์ ไม่สำเร็จ ${failed.length} ไฟล์: ${failed.join(" · ")}`);
    }
    toast(`นำเข้าแล้ว ${done} ไฟล์`);
  });
}

async function documentsView(m) {
  const options = fieldOf(m, "category").options;
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <select id="cat" aria-label="หมวดหมู่">${option("", "ทุกหมวดหมู่")}${options.map((o) => option(o, o)).join("")}</select>
      <input type="search" id="q" placeholder="ค้นหาชื่อเอกสาร หรือเลขที่">
      <button class="btn" data-act="import">นำเข้า PDF</button>
      <button class="btn primary" data-act="new">+ เพิ่มเอกสาร</button>
    </div>
    <div id="docs"></div>`;
  const all = (await api("GET", `/records?module=${m.key}`))
    .sort((a, b) => String(a.data.title).localeCompare(String(b.data.title), "th"));
  const byId = (id) => all.find((r) => String(r.id) === String(id));
  const draw = () => {
    const cat = $("#cat").value;
    const q = $("#q").value.trim().toLowerCase();
    const shown = all.filter((r) => (!cat || r.data.category === cat) && (!q || recordText(r).includes(q)));
    const canEdit = (r) => me.role === "admin" || r.created_by === me.id;
    const groups = options.map((o) => [o, shown.filter((r) => r.data.category === o)]).filter(([, list]) => list.length);
    $("#docs").innerHTML = shown.length ? groups.map(([o, list]) => `
      <section class="doc-group">
        <h3 class="group-title">${esc(o)} <small>(${num(list.length)})</small></h3>
        <ul class="doc-list">${list.map((r) => {
          const d = r.data;
          const meta = [d.doc_no, d.effective_date && `มีผล ${when(d.effective_date, false)}`, d.revision && `ฉบับที่ ${d.revision}`, d.owner]
            .filter(Boolean).map(esc).join(" · ");
          return `<li class="doc-item">
            <div class="doc-main">
              <b>${esc(d.title)}</b>
              ${meta ? `<small>${meta}</small>` : ""}
              ${d.note ? `<small class="pre">${esc(d.note)}</small>` : ""}
            </div>
            <div class="doc-actions">
              ${d.file ? `<button type="button" class="btn small primary" data-open-file="${Number(d.file.id)}">เปิด PDF</button>
                <button type="button" class="btn small" data-open-file="${Number(d.file.id)}" data-download>ดาวน์โหลด</button>` : `<small>ยังไม่มีไฟล์</small>`}
              ${canEdit(r) ? btn("edit", "แก้ไข", r.id) : ""}
              ${me.role === "admin" ? btn("delete", "ลบ", r.id, "danger") : ""}
            </div>
          </li>`;
        }).join("")}</ul>
      </section>`).join("")
      : `<p class="empty">${all.length ? "ไม่พบเอกสารที่ค้นหา" : 'ยังไม่มีเอกสาร กด "นำเข้า PDF" เพื่ออัปโหลดไฟล์ได้หลายไฟล์พร้อมกัน หรือกด "+ เพิ่มเอกสาร"'}</p>`;
  };
  $("#cat").onchange = draw;
  $("#q").oninput = draw;
  bind({
    new: () => openRecordForm(m, null, { category: $("#cat").value || undefined }),
    edit: (id) => openRecordForm(m, byId(id)),
    delete: async (id) => {
      if (!confirm(`ลบ "${byId(id).data.title}"? (ข้อมูลยังเก็บไว้ในประวัติ)`)) return;
      try { await api("POST", `/records/${id}/delete`, {}); toast("ลบแล้ว"); refresh(); } catch (err) { toast(err.message, true); }
    },
    import: () => importPdfs(m),
  });
  draw();
}

// ---------- ตรวจสอบ stock หน่วยบริการ (แบบตรวจ 1 = ผ่าน, 0 = ไม่ผ่าน, ว่าง = ไม่ประเมิน) ----------
// 1 บันทึก = ผลตรวจ 1 หน่วยบริการใน 1 รอบ (วันที่ตรวจ) แสดงรวมเป็นตาราง ข้อตรวจ × หน่วยบริการ เหมือนใน Excel

const criteriaOf = (m) => m.fields.filter((f) => f.criterion);

function stockScore(m, d) {
  const done = criteriaOf(m).filter((f) => d[f.name]);
  return { pass: done.filter((f) => d[f.name] === "ผ่าน").length, total: done.length };
}

const unitOrder = (m) => (a, b) => {
  const opts = fieldOf(m, "unit").options;
  return opts.indexOf(a.data.unit) - opts.indexOf(b.data.unit);
};

// อ่านทุกชีตที่มีหัวตารางเป็นชื่อหน่วยบริการ ได้ 1 รอบการตรวจต่อชีต
function parseStockSheets(m, sheets) {
  const unitOpts = fieldOf(m, "unit").options;
  const unitOf = (t) => unitOpts.find((u) => u.toUpperCase() === String(t).trim().toUpperCase());
  const crit = criteriaOf(m);
  const rounds = [];
  const skipped = [];
  for (const sheet of sheets) {
    const rows = sheet.rows;
    let h = -1;
    let unitCols = [];
    for (let i = 0; i < Math.min(rows.length, 15) && h < 0; i++) {
      const cols = (rows[i] || []).map((c, j) => [j, unitOf(cellText(c))]).filter(([, u]) => u);
      if (cols.length) { h = i; unitCols = cols; }
    }
    if (h < 0) continue;
    // วันที่ตรวจ: ข้อความแบบ "วันที่ตรวจสอบ 21/10/68" หรือเซลล์วันที่ในแถวต้นตาราง
    let date = null;
    for (let i = 0; i <= h + 1 && !date; i++) {
      for (const c of rows[i] || []) {
        const text = cellText(c);
        const found = text.match(/(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/);
        const d = found ? excelDate(found[1]) : typeof c === "number" ? excelDate(c) : null;
        if (d) { date = fixYear(d, null); break; }
      }
    }
    const values = Object.fromEntries(unitCols.map(([, u]) => [u, {}]));
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const label = r.slice(0, unitCols[0][0]).map(cellText).find(Boolean) || "";
      const no = label.match(/^(\d+)\s*\.\s*(\d+)/);
      if (!no) continue;
      const f = crit.find((x) => x.criterion === `${no[1]}.${no[2]}`);
      if (!f) { skipped.push(`ชีต ${sheet.name}: ไม่รู้จักข้อ "${label.slice(0, 40)}"`); continue; }
      for (const [j, u] of unitCols) {
        const v = cellNum(r[j]);
        if (v === 1) values[u][f.name] = "ผ่าน";
        else if (v === 0) values[u][f.name] = "ไม่ผ่าน";
      }
    }
    // หมายเหตุ: บรรทัด "Ward - ..." "ER - ..." แยกตามหน่วย บรรทัดที่ไม่มีชื่อหน่วยต่อท้ายหน่วยก่อนหน้า
    const notes = Object.fromEntries(unitCols.map(([, u]) => [u, []]));
    let noteCol = -1;
    let noteRow = -1;
    for (let i = 0; i <= h && noteCol < 0; i++) {
      const j = (rows[i] || []).findIndex((c) => cellText(c).startsWith("หมายเหตุ"));
      if (j >= 0) { noteCol = j; noteRow = i; }
    }
    if (noteCol >= 0) {
      let last = null;
      for (let i = noteRow + 1; i < rows.length; i++) {
        for (const line of cellText((rows[i] || [])[noteCol]).split("\n")) {
          const s = line.trim();
          if (!s) continue;
          const pre = s.match(/^([A-Za-z]+)\s*[-–:]\s*(.*)$/);
          const u = pre && unitOf(pre[1]);
          if (u && notes[u]) { notes[u].push(pre[2]); last = u; }
          else if (last) notes[last].push(s);
          else unitCols.forEach(([, uu]) => notes[uu].push(s));
        }
      }
    }
    const units = unitCols.map(([, u]) => u).filter((u) => Object.keys(values[u]).length || notes[u].length);
    if (!units.length) { skipped.push(`ชีต ${sheet.name}: ไม่พบคะแนน`); continue; }
    rounds.push({ sheet: sheet.name, date, units: units.map((u) => ({ unit: u, ...values[u], findings: notes[u].join("\n") })) });
  }
  return { rounds, skipped };
}

async function importStockCheck(m) {
  const file = await pickFile(".xlsx,.csv");
  if (!file) return;
  let parsed;
  let existing;
  try {
    [parsed, existing] = await Promise.all([readSpreadsheet(file).then((s) => parseStockSheets(m, s)), api("GET", `/records?module=${m.key}`)]);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!parsed.rounds.length) return toast("ไม่พบตารางผลตรวจในไฟล์นี้ (ต้องมีหัวคอลัมน์ชื่อหน่วยบริการ เช่น WARD ER LR PCU)", true);
  const have = new Set(existing.map((r) => `${r.record_date}|${r.data.unit}`));
  dlg.className = "wide";
  dlg.innerHTML = dialogShell("นำเข้าผลตรวจสอบ stock จาก Excel", `
    <p class="hint">${esc(file.name)} · พบ ${num(parsed.rounds.length)} รอบการตรวจ ตรวจวันที่ก่อนกดนำเข้า หน่วยที่มีผลตรวจวันเดียวกันอยู่แล้วจะถูกข้าม</p>
    <div class="table-wrap"><table><thead><tr><th>ชีต</th><th>วันที่ตรวจสอบ</th><th>หน่วยบริการ (คะแนน)</th></tr></thead><tbody>
    ${parsed.rounds.map((r, i) => `<tr>
      <td>${esc(r.sheet)}</td>
      <td><input type="date" data-round-date="${i}" value="${esc(r.date || "")}" required aria-label="วันที่ตรวจสอบ"></td>
      <td>${r.units.map((u) => { const s = stockScore(m, u); return `${esc(u.unit)} <b>${s.pass}/${s.total}</b>`; }).join(" · ")}
        <div class="meta" data-dup="${i}"></div></td>
    </tr>`).join("")}</tbody></table></div>
    ${parsed.skipped.length ? `<details><summary>ดูรายการที่ข้าม</summary><ul class="history">${parsed.skipped.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}`,
    "นำเข้า");
  const form = $("form", dlg);
  const plan = () => parsed.rounds.flatMap((r, i) => {
    const date = form.querySelector(`[data-round-date="${i}"]`).value;
    return r.units.filter((u) => !have.has(`${date}|${u.unit}`)).map((u) => ({ _row: `${r.sheet} ${u.unit}`, record_date: date, ...u }));
  });
  const update = () => {
    parsed.rounds.forEach((r, i) => {
      const date = form.querySelector(`[data-round-date="${i}"]`).value;
      const dups = r.units.filter((u) => have.has(`${date}|${u.unit}`)).map((u) => u.unit);
      form.querySelector(`[data-dup="${i}"]`).textContent = dups.length ? `มีผลตรวจวันนี้แล้ว (ข้าม): ${dups.join(", ")}` : "";
    });
    const n = plan().length;
    $("button[type=submit]", form).textContent = n ? `นำเข้า ${num(n)} หน่วยบริการ` : "ไม่มีรายการใหม่";
    $("button[type=submit]", form).disabled = !n;
  };
  form.oninput = update;
  update();
  wireDialog(async () => {
    const rows = plan();
    if (rows.some((r) => !r.record_date)) throw new Error("กรุณาใส่วันที่ตรวจสอบให้ครบทุกรอบ");
    const res = await api("POST", "/records/import", { module: m.key, rows });
    stockRound = rows[0].record_date;
    toast(`นำเข้าแล้ว ${num(res.inserted)} หน่วยบริการ`);
    refresh();
  });
}

// Excel รูปแบบเดียวกับแบบตรวจต้นฉบับ 1 ชีตต่อ 1 รอบการตรวจ (นำกลับเข้าระบบได้)
function stockWorkbook(m, all) {
  const crit = criteriaOf(m);
  const dates = [...new Set(all.map((r) => r.record_date))].sort();
  return buildXlsx(dates.map((date) => {
    const recs = all.filter((r) => r.record_date === date).sort(unitOrder(m));
    const units = recs.map((r) => r.data.unit);
    const noteCol = units.length + 1;
    const rows = [
      [`ตารางแสดงผลการตรวจสอบคุณภาพยา stock ที่จุดบริการ ปีงบประมาณ ${fiscalYear(date)}`],
      [`วันที่ตรวจสอบ ${when(date, false)}`, "คะแนนที่ได้ในแต่ละหน่วยบริการ", ...Array(units.length - 1).fill(""), "หมายเหตุ"],
      ["", ...units],
    ];
    const bold = new Set([0, 1, 2]);
    for (const f of crit) {
      if (f.section) { bold.add(rows.length); rows.push([f.section]); }
      rows.push([f.label, ...recs.map((r) => (r.data[f.name] === "ผ่าน" ? 1 : r.data[f.name] === "ไม่ผ่าน" ? 0 : ""))]);
    }
    bold.add(rows.length);
    rows.push(["คะแนนรวม", ...recs.map((r) => { const s = stockScore(m, r.data); return `${s.pass}/${s.total}`; })]);
    // หมายเหตุใส่คอลัมน์ขวาสุด เริ่มที่แถวชื่อหน่วย
    let line = 2;
    for (const r of recs) {
      for (const text of String(r.data.findings || "").split("\n").filter(Boolean)) {
        rows[line][noteCol] = `${r.data.unit} - ${text}`;
        line++;
        if (!rows[line]) rows[line] = [];
      }
    }
    return { name: when(date, false).replace(/\//g, "-"), widths: [46, ...units.map(() => 10), 50], bold, rows };
  }));
}

let stockRound = null;

async function stockcheckView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <button class="btn" data-act="import">นำเข้า Excel</button>
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn primary" data-act="new">+ บันทึกผลตรวจ</button>
    </div>
    <div id="matrix"></div>
    <div id="stock-summary"></div>`;
  const all = await api("GET", `/records?module=${m.key}`);
  const crit = criteriaOf(m);
  const dates = [...new Set(all.map((r) => r.record_date))].sort().reverse();
  if (!dates.includes(stockRound)) stockRound = dates[0] || null;
  const roundOptions = () => dates.map((d, i) => option(d,
    `รอบที่ ${dates.length - i} · ${when(d, false)} (${all.filter((r) => r.record_date === d).length} หน่วย)`, stockRound)).join("");
  const draw = () => {
    const recs = all.filter((r) => r.record_date === stockRound).sort(unitOrder(m));
    if (!recs.length) {
      $("#matrix").innerHTML = `<p class="empty">ยังไม่มีผลตรวจ กด "นำเข้า Excel" เพื่อนำเข้าแบบตรวจ หรือกด "+ บันทึกผลตรวจ" เพื่อบันทึกทีละหน่วยบริการ</p>`;
      $("#stock-summary").innerHTML = "";
      return;
    }
    const mark = (v) => (v === "ผ่าน" ? `<td class="mk ok" title="ผ่าน">✓</td>` : v === "ไม่ผ่าน" ? `<td class="mk bad" title="ไม่ผ่าน">✗</td>`
      : `<td class="mk na" title="ไม่ประเมิน">–</td>`);
    const scores = recs.map((r) => stockScore(m, r.data));
    $("#matrix").innerHTML = `<section class="card">
      <div class="panel-head">
        <h2>ผลการตรวจสอบคุณภาพยา stock ที่จุดบริการ</h2>
        <div class="round-picker">
          <button type="button" class="btn small" data-act="older" ${dates.indexOf(stockRound) >= dates.length - 1 ? "disabled" : ""}
            aria-label="รอบการตรวจก่อนหน้า">◀ รอบก่อน</button>
          <select id="round" aria-label="รอบการตรวจ">${roundOptions()}</select>
          <button type="button" class="btn small" data-act="newer" ${dates.indexOf(stockRound) <= 0 ? "disabled" : ""}
            aria-label="รอบการตรวจถัดไป">รอบถัดไป ▶</button>
        </div>
      </div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>ข้อตรวจ</th>${recs.map((r) =>
        `<th class="mk"><button type="button" class="link-btn" data-act="open" data-id="${r.id}">${esc(r.data.unit)}</button></th>`).join("")}</tr></thead>
      <tbody>${crit.map((f) => `${f.section ? `<tr class="sec"><td colspan="${recs.length + 1}">${esc(f.section)}</td></tr>` : ""}
        <tr><td>${esc(f.label)}</td>${recs.map((r) => mark(r.data[f.name])).join("")}</tr>`).join("")}
        <tr class="total"><td>คะแนนรวม</td>${scores.map((s) => `<td class="mk">${s.pass}/${s.total}${
          s.total ? `<br><small>${Math.round(s.pass * 100 / s.total)}%</small>` : ""}</td>`).join("")}</tr>
      </tbody></table></div>
      ${recs.some((r) => r.data.findings || r.data.action) ? `<h3>หมายเหตุ</h3><ul class="notes">${recs.filter((r) => r.data.findings || r.data.action)
        .map((r) => `<li><b>${esc(r.data.unit)}</b> <span class="pre">${esc(r.data.findings || "")}</span>${
          r.data.action ? `<br><small>การแก้ไข: ${esc(r.data.action)}</small>` : ""}</li>`).join("")}</ul>` : ""}
      <p class="meta">กดชื่อหน่วยบริการเพื่อดูหรือแก้ไขผลตรวจของหน่วยนั้น</p>
    </section>`;
    // สรุปทั้งปีงบประมาณของรอบที่เลือก
    const fy = fiscalYear(stockRound);
    const yearRecs = all.filter((r) => fiscalYear(r.record_date) === fy);
    const units = fieldOf(m, "unit").options.filter((u) => yearRecs.some((r) => r.data.unit === u));
    const byUnit = units.map((u) => {
      const list = yearRecs.filter((r) => r.data.unit === u).map((r) => stockScore(m, r.data));
      const pass = list.reduce((s, x) => s + x.pass, 0);
      const total = list.reduce((s, x) => s + x.total, 0);
      return { label: u, value: total ? pass * 100 / total : 0, text: total ? `${(pass * 100 / total).toFixed(1)}%` : "-", sub: `${pass}/${total} ข้อ · ${list.length} ครั้ง` };
    });
    const fails = crit.map((f) => ({ label: f.label, value: yearRecs.filter((r) => r.data[f.name] === "ไม่ผ่าน").length }))
      .filter((x) => x.value).sort((a, b) => b.value - a.value).map((x) => ({ ...x, sub: "ครั้ง" }));
    const roundCount = new Set(yearRecs.map((r) => r.record_date)).size;
    $("#stock-summary").innerHTML = `<div class="grid2 analysis">
      <section class="card"><h2>ร้อยละผ่านเกณฑ์ ปีงบประมาณ ${fy} <small>${num(roundCount)} รอบ</small></h2>${barList(byUnit)}</section>
      <section class="card"><h2>ข้อที่ไม่ผ่านบ่อย ปีงบประมาณ ${fy}</h2>${barList(fails, "ผ่านทุกข้อ")}</section>
    </div>`;
    $("#round").onchange = () => { stockRound = $("#round").value; draw(); };
  };
  const step = (dir) => {
    const i = dates.indexOf(stockRound) + dir;
    if (i >= 0 && i < dates.length) { stockRound = dates[i]; draw(); }
  };
  bind({
    older: () => step(1),
    newer: () => step(-1),
    new: () => openRecordForm(m, null, { record_date: isoDate() }),
    open: (id) => openRecord(id),
    import: () => importStockCheck(m),
    xlsx: () => (all.length ? downloadBlob(stockWorkbook(m, all), `${m.title}.xlsx`) : toast("ยังไม่มีผลตรวจ", true)),
  });
  draw();
}

// ---------- ข้อมูลยาเพื่อความปลอดภัย (หญิงตั้งครรภ์ หญิงให้นมบุตร การป้องกันแสง) ----------
// รายการยาตั้งต้นมาจากบัญชียาโรงพยาบาลปีงบล่าสุด ข้อมูลความปลอดภัยเภสัชกรเป็นผู้กรอก (ไม่เดาให้)

const SAFETY_TONE = {
  "ห้ามใช้": "bad",
  "มีความเสี่ยงสูง ควรหลีกเลี่ยง": "warn",
  "พิจารณาประโยชน์และความเสี่ยง": "info",
  "ใช้ได้อย่างปลอดภัย": "ok",
  "ต้องใส่ซองสีชา": "warn",
  "ป้องกันแสง แต่มีแผงยา": "info",
  "ไม่ต้องป้องกันแสง": "ok",
};
const safetyBadge = (v) => (v ? badge(v, SAFETY_TONE[v] || "muted") : `<span class="muted">ยังไม่มีข้อมูล</span>`);
const safetyKey = (name) => String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const DRAFT = "ร่าง – รอเภสัชกรตรวจสอบ";
const draftBadge = (d) => (d?.status === DRAFT ? ` ${badge("ร่าง รอตรวจสอบ", "warn")}` : "");

const SAFETY_FILTERS = [
  ["all", "ทั้งหมด", () => true],
  ["preg", "🤰 ห้ามใช้ในหญิงตั้งครรภ์", (d) => d?.preg_level === "ห้ามใช้"],
  ["lact", "🍼 ห้ามใช้ในหญิงให้นมบุตร", (d) => d?.lact_level === "ห้ามใช้"],
  ["light", "🟫 ต้องใส่ซองสีชา", (d) => d?.light === "ต้องใส่ซองสีชา"],
  ["draft", "⚠ ร่าง รอตรวจสอบ", (d) => d?.status === DRAFT],
  ["missing", "ยังไม่มีข้อมูล", (d) => !d || (!d.preg_level && !d.lact_level && !d.light)],
];

// ป้ายเตือนสั้น ๆ ใช้ในหน้าบัญชียา
function safetyFlags(d) {
  if (!d) return "";
  return [
    d.preg_level === "ห้ามใช้" && badge("🤰 ห้ามใช้ตั้งครรภ์", "bad"),
    d.lact_level === "ห้ามใช้" && badge("🍼 ห้ามใช้ให้นมบุตร", "bad"),
    d.light === "ต้องใส่ซองสีชา" && badge("🟫 ซองสีชา", "warn"),
  ].filter(Boolean).join(" ") + (d.preg_level === "ห้ามใช้" || d.lact_level === "ห้ามใช้" || d.light === "ต้องใส่ซองสีชา" ? draftBadge(d) : "");
}

async function loadSafetyMap() {
  const list = await api("GET", "/records?module=drug_safety");
  return new Map(list.map((r) => [safetyKey(r.data.drug), r]));
}

let safetyFilter = "all";

async function drugsafetyView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <input type="search" id="q" placeholder="ค้นหาชื่อยา">
      <button class="btn" data-act="print">พิมพ์ / PDF</button>
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn" data-act="import">นำเข้า Excel</button>
      <button class="btn primary" data-act="new">+ เพิ่มยา</button>
    </div>
    <div class="chips-bar" id="filters"></div>
    <div class="list" id="list"></div>`;
  const [safety, formulary] = await Promise.all([api("GET", `/records?module=${m.key}`), api("GET", "/records?module=formulary")]);
  // รายการยา = ยาในบัญชียาปีงบล่าสุด รวมกับยาที่มีข้อมูลความปลอดภัยแล้ว
  const fy = Math.max(0, ...formulary.map((r) => Number(r.data.fiscal_year) || 0));
  const byKey = new Map(safety.map((r) => [safetyKey(r.data.drug), r]));
  const names = new Map();
  for (const r of formulary.filter((x) => Number(x.data.fiscal_year) === fy)) names.set(safetyKey(r.data.drug), r.data.drug);
  for (const r of safety) if (!names.has(safetyKey(r.data.drug))) names.set(safetyKey(r.data.drug), r.data.drug);
  const rows = [...names].map(([key, name]) => ({ key, name, rec: byKey.get(key) || null }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  let shown = [];
  const draw = () => {
    const test = SAFETY_FILTERS.find(([k]) => k === safetyFilter)?.[2] || (() => true);
    const q = $("#q").value.trim().toLowerCase();
    shown = rows.filter((r) => test(r.rec?.data) && (!q || r.key.includes(q)));
    $("#filters").innerHTML = SAFETY_FILTERS.map(([k, label, t]) =>
      `<button type="button" class="chip-btn${k === safetyFilter ? " on" : ""}" data-act="filter" data-id="${k}">${esc(label)} <b>${num(rows.filter((r) => t(r.rec?.data)).length)}</b></button>`).join("");
    $("#list").innerHTML = table(
      ["ชื่อยา", "หญิงตั้งครรภ์", "หญิงให้นมบุตร", "การป้องกันแสง", ""],
      shown.map((r) => {
        const d = r.rec?.data || {};
        const canEdit = r.rec && (me.role === "admin" || r.rec.created_by === me.id);
        return [esc(r.name) + draftBadge(d), safetyBadge(d.preg_level), safetyBadge(d.lact_level), safetyBadge(d.light),
          actions(r.rec ? `${btn("open", "ดู", r.rec.id)}${canEdit ? btn("edit", "แก้ไข", r.rec.id) : ""}`
            : btn("fill", "กรอกข้อมูล", r.key, "primary"))];
      }),
      q ? "ไม่พบยาที่ค้นหา" : rows.length ? "ไม่มียาในกลุ่มนี้" : 'ยังไม่มีรายการยา นำเข้าบัญชียาโรงพยาบาลก่อน หรือกด "+ เพิ่มยา"');
  };
  $("#q").oninput = draw;
  const filterLabel = () => SAFETY_FILTERS.find(([k]) => k === safetyFilter)[1].replace(/^\S+\s/, "");
  bind({
    filter: (k) => { safetyFilter = k; draw(); },
    fill: (key) => openRecordForm(m, null, { drug: names.get(key) }),
    new: () => openRecordForm(m),
    open: (id) => openRecord(id),
    edit: (id) => openRecordForm(m, safety.find((r) => String(r.id) === String(id))),
    import: () => importGeneric(m),
    xlsx: () => downloadBlob(genericWorkbook(m, shown.map((r) => r.rec || { data: { drug: r.name } })),
      `${m.title} - ${filterLabel()}.xlsx`),
    print: () => {
      $("#print").innerHTML = `<div class="report">
        <div class="report-head"><img src="logo.png" alt="">
          <div><h1>${esc(m.title)}: ${esc(filterLabel())}</h1>
          <p>กลุ่มงานเภสัชกรรม โรงพยาบาลตาพระยา · ${num(shown.length)} รายการ · พิมพ์เมื่อ ${longDate()}</p></div></div>
        <table><thead><tr><th>ชื่อยา</th><th>หญิงตั้งครรภ์</th><th>หญิงให้นมบุตร</th><th>การป้องกันแสง</th></tr></thead>
        <tbody>${shown.map((r) => {
          const d = r.rec?.data || {};
          const cell = (level, note) => `${esc(level || "-")}${note ? `<br><small class="pre">${esc(note)}</small>` : ""}`;
          return `<tr><td>${esc(r.name)}${d.status === DRAFT ? "<br><small>(ร่าง รอตรวจสอบ)</small>" : ""}</td><td>${cell(d.preg_level, d.preg_note)}</td>
            <td>${cell(d.lact_level, [d.mp_ratio && `M/P ratio ${d.mp_ratio}`, d.lact_note].filter(Boolean).join("\n"))}</td>
            <td>${esc(d.light || "-")}</td></tr>`;
        }).join("")}</tbody></table></div>`;
      window.print();
    },
  });
  draw();
}

// ---------- รายงานการประเมิน DUE (Drug Use Evaluation) ----------
// เกณฑ์ของแต่ละยาอยู่ใน modules.json (forms ของงาน due) ตามแบบประเมินของกลุ่มงานเภสัชกรรม
// คำตอบรายข้อเก็บในช่อง answers: {รหัสข้อ: "Y" | "N" | "NA", รหัสข้อ_v: ค่าที่วัดได้, รหัสข้อ_n: หมายเหตุ}
// สรุปผล: ต้องตอบ "ใช่" ทุกข้อที่ประเมินจึง "เหมาะสม" ข้อที่ไม่เกี่ยวกับข้อบ่งใช้ที่เลือกจะไม่แสดง

const DUE_ANSWER = { Y: "ใช่", N: "ไม่ใช่", NA: "ไม่ประเมิน" };
const dueForm = (drug) => (MOD.due?.forms || []).find((f) => f.drug === drug);
const dueIndicationLabel = (form, key) => (form.indications || []).find(([k]) => k === key)?.[1] || "";
const dueIndicationKey = (form, label) => (form.indications || []).find(([, l]) => l === label)?.[0] || "";

// ข้อที่ต้องประเมินตามข้อบ่งใช้ที่เลือก
function dueSections(form, ind) {
  return form.sections.map((s) => ({ ...s, items: s.items.filter((it) => !it.for || it.for.includes(ind)) }))
    .filter((s) => s.items.length);
}

// สรุปผลรายหมวดและภาพรวม
function dueEvaluate(form, ind, answers) {
  const sections = dueSections(form, ind).map((s) => {
    const vals = s.items.map((it) => answers[it.id]);
    const status = vals.some((v) => !v) ? "incomplete" : vals.includes("N") ? "bad" : vals.every((v) => v === "NA") ? "na" : "ok";
    return { ...s, status, missing: vals.filter((v) => !v).length };
  });
  const missing = sections.reduce((n, s) => n + s.missing, 0) + (form.indications && !ind ? 1 : 0);
  const failed = [...new Set(sections.filter((s) => s.status === "bad").map((s) => s.cat))];
  return { sections, missing, failed, result: missing ? "" : failed.length ? "ไม่เหมาะสม" : "เหมาะสม" };
}

const DUE_SECTION_BADGE = { ok: ["เหมาะสม", "ok"], bad: ["ไม่เหมาะสม", "bad"], na: ["ไม่ประเมิน", "muted"], incomplete: ["ยังตอบไม่ครบ", "warn"] };
const dueResultBadge = (r) => (r ? badge(r, r === "เหมาะสม" ? "ok" : "bad") : badge("ยังประเมินไม่ครบ", "warn"));

function dueSummaryHtml(ev) {
  return `<ul class="due-summary">${ev.sections.map((s) => `<li><span>${esc(s.summary)}</span>${badge(...DUE_SECTION_BADGE[s.status])}</li>`).join("")}
    <li class="total"><span>สรุปผลการประเมินการใช้ยา</span>${dueResultBadge(ev.result)}</li></ul>`;
}

// เลือกยาที่จะประเมินก่อนเปิดแบบประเมิน
function chooseDueDrug(m, preset = {}) {
  const forms = m.forms || [];
  dlg.className = "";
  dlg.innerHTML = dialogShell("เลือกยาที่จะประเมิน", `<div class="due-pick">${forms.map((f, i) =>
    `<button type="button" class="btn" data-pick="${i}"><b>${esc(f.drug)}</b><small>${esc(f.heading)}</small></button>`).join("")}</div>`, null);
  const form = wireDialog(() => {});
  form.onclick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) openDueForm(m, null, { ...preset, drug: forms[Number(b.dataset.pick)].drug });
  };
}

function openDueForm(m, rec = null, preset = {}) {
  const v = rec ? flat(rec) : { record_date: isoDate(), evaluator: me.full_name, ...preset };
  const form = dueForm(v.drug);
  if (!form) return chooseDueDrug(m, preset);
  const answers = { ...(v.answers || {}) };
  let ind = dueIndicationKey(form, v.indication) || (form.indications?.length === 1 ? form.indications[0][0] : "");
  const patientFields = [
    { name: "record_date", label: "วันที่ประเมิน", type: "date", required: true },
    { name: "hn", label: "HN", required: true, autocomplete: "off" },
    { name: "patient_name", label: "ชื่อ-นามสกุลผู้ป่วย", required: true },
    { name: "an", label: "AN" },
    { name: "dept", label: "แผนก", type: "select", options: ["OPD", "IPD"] },
    { name: "physician", label: "แพทย์ผู้ทำการรักษา" },
  ];
  const tailFields = [
    { name: "action", label: "การดำเนินการ / ข้อเสนอแนะ", type: "textarea" },
    { name: "evaluator", label: "ผู้ประเมิน", type: "staff", required: true },
  ];
  dlg.className = "wide";
  dlg.innerHTML = dialogShell(`${rec ? "แก้ไข" : ""}แบบประเมินความเหมาะสมในการใช้ยา (DUE)`, `
    <p class="hint"><b>${esc(form.heading)}</b><br>ตอบ "ใช่" ทุกข้อที่ประเมินจึงสรุปว่า "เหมาะสม" · ข้อที่ไม่เกี่ยวข้องเลือก "ไม่ประเมิน"</p>
    ${form.criteria ? `<details class="due-ref"><summary>ดูเกณฑ์มาตรฐานการใช้ยา ${esc(form.drug)}</summary>${dueCriteriaHtml(form)}</details>` : ""}
    <div class="hn-info" hidden></div>
    <div class="fields two">${patientFields.map((f) => fieldHtml(f, v)).join("")}
      ${form.indications ? `<label class="field full"><span>ข้อบ่งใช้ที่ประเมิน *</span><select id="due-ind">
        ${option("", "— เลือกข้อบ่งใช้ —", ind)}${form.indications.map(([k, l]) => option(k, l, ind)).join("")}</select></label>` : ""}
    </div>
    <div id="due-criteria"></div>
    <h3 class="form-section">5. สรุปผลการประเมินความเหมาะสมในการใช้ยา</h3>
    <div id="due-live"></div>
    <div class="fields two">${tailFields.map((f) => fieldHtml(f, v)).join("")}</div>`, "บันทึกผลการประเมิน");
  const box = $("#due-criteria", dlg);
  const live = () => { $("#due-live", dlg).innerHTML = dueSummaryHtml(dueEvaluate(form, ind, answers)); };
  const drawCriteria = () => {
    if (form.indications && !ind) {
      box.innerHTML = `<p class="alert warn">เลือกข้อบ่งใช้ก่อน ระบบจะแสดงเกณฑ์ที่ต้องประเมินตามข้อบ่งใช้นั้น</p>`;
      return live();
    }
    box.innerHTML = dueSections(form, ind).map((s) => {
      let sub = "";
      return `<h3 class="form-section">${esc(s.title)}</h3><div class="due-items">${s.items.map((it) => {
        const head = it.sub && it.sub !== sub ? `<div class="due-sub">${esc((sub = it.sub))}</div>` : "";
        return `${head}<div class="due-item" data-id="${esc(it.id)}">
          <div class="due-text"><b>${esc(it.id.replace(/-\d+$/, ""))}</b> ${esc(it.text)}</div>
          <div class="due-answer" role="radiogroup" aria-label="${esc(it.id)}">${Object.entries(DUE_ANSWER).map(([k, l]) =>
            `<label class="due-opt ${k}"><input type="radio" name="due_${esc(it.id)}" value="${k}" ${answers[it.id] === k ? "checked" : ""}>${l}</label>`).join("")}</div>
          ${it.input ? `<label class="due-input"><span>${esc(it.input)}</span><input ${it.number ? 'type="number" step="any"' : ""} data-val="${esc(it.id)}" value="${esc(answers[it.id + "_v"] || "")}"></label>` : ""}
          <input class="due-note" data-note="${esc(it.id)}" placeholder="หมายเหตุ" value="${esc(answers[it.id + "_n"] || "")}" aria-label="หมายเหตุข้อ ${esc(it.id)}">
        </div>`;
      }).join("")}</div>`;
    }).join("");
    live();
  };
  drawCriteria();
  const indSelect = $("#due-ind", dlg);
  if (indSelect) indSelect.onchange = () => { ind = indSelect.value; drawCriteria(); };
  box.addEventListener("change", (e) => {
    const t = e.target;
    if (t.type === "radio") answers[t.name.slice(4)] = t.value;
    if (t.dataset.val) {
      const it = form.sections.flatMap((s) => s.items).find((x) => x.id === t.dataset.val);
      answers[`${it.id}_v`] = t.value.trim();
      // ค่าที่วัดได้ตามเกณฑ์ (เช่น mMRC ≥2) เลือก ใช่/ไม่ใช่ ให้อัตโนมัติ แก้เองได้
      if (t.value.trim() !== "") {
        answers[it.id] = it.auto_min == null || Number(t.value) >= it.auto_min ? "Y" : "N";
        const radio = $(`[name="due_${CSS.escape(it.id)}"][value="${answers[it.id]}"]`, box);
        if (radio) radio.checked = true;
      }
    }
    if (t.dataset.note) answers[`${t.dataset.note}_n`] = t.value.trim();
    live();
  });
  box.addEventListener("input", (e) => {
    if (e.target.dataset.note) answers[`${e.target.dataset.note}_n`] = e.target.value.trim();
  });
  const formEl = wireDialog(async (_, f) => {
    const ev = dueEvaluate(form, ind, answers);
    if (form.indications && !ind) throw new Error("กรุณาเลือกข้อบ่งใช้ที่ประเมิน");
    if (ev.missing) throw new Error(`ยังประเมินไม่ครบ ${num(ev.missing)} ข้อ (เลือก ใช่ / ไม่ใช่ / ไม่ประเมิน ทุกข้อ)`);
    // เก็บเฉพาะคำตอบของข้อที่ประเมินตามข้อบ่งใช้ที่เลือก
    const ids = new Set(ev.sections.flatMap((s) => s.items.map((it) => it.id)));
    const kept = Object.fromEntries(Object.entries(answers).filter(([k, val]) => val && ids.has(k.replace(/_[vn]$/, ""))));
    const body = {
      module: m.key, ...formValues(f, [...patientFields, ...tailFields]), drug: form.drug,
      indication: dueIndicationLabel(form, ind), answers: kept, result: ev.result, failed: ev.failed,
    };
    await api(rec ? "PUT" : "POST", rec ? `/records/${rec.id}` : "/records", body);
    toast(`บันทึกแล้ว: ${ev.result}`);
    refresh();
  });
  const hn = $("[name=hn]", formEl);
  hn.onchange = () => lookupHN(formEl);
  if (hn.value) lookupHN(formEl);
}

function openDueRecord(rec) {
  const m = MOD.due;
  const form = dueForm(rec.data.drug);
  const d = rec.data;
  const ans = d.answers || {};
  const ev = form ? dueEvaluate(form, dueIndicationKey(form, d.indication), ans) : null;
  const info = (label, value) => `<div><small>${esc(label)}</small><div>${value}</div></div>`;
  const criteria = ev ? ev.sections.map((s) => `<h3 class="form-section">${esc(s.title)}</h3>
    ${table(["ข้อ", "เกณฑ์การประเมิน", "ผล", "หมายเหตุ"], s.items.map((it) => [
      esc(it.id.replace(/-\d+$/, "")),
      `${it.sub ? `<small class="muted">${esc(it.sub)}</small><br>` : ""}${esc(it.text)}${ans[it.id + "_v"] ? `<br><small>${esc(it.input || "ค่าที่ได้")}: <b>${esc(ans[it.id + "_v"])}</b></small>` : ""}`,
      ans[it.id] ? badge(DUE_ANSWER[ans[it.id]], ans[it.id] === "Y" ? "ok" : ans[it.id] === "N" ? "bad" : "muted") : "-",
      esc(ans[it.id + "_n"] || ""),
    ]), "-")}`).join("") : `<p class="alert warn">ไม่พบแบบประเมินของยานี้</p>`;
  const buttons = [
    (me.role === "admin" || rec.created_by === me.id) && btn("edit", "แก้ไข", "", "primary"),
    btn("print", "พิมพ์แบบประเมิน"),
    btn("history", "ประวัติการแก้ไข"),
    btn("patient", "ประวัติผู้ป่วยรายนี้"),
    me.role === "admin" && btn("delete", "ลบ", "", "danger"),
  ].filter(Boolean);
  dlg.className = "wide";
  dlg.innerHTML = dialogShell(`แบบประเมิน DUE · ${esc(d.drug)}`, `
    <div class="info-grid">
      ${info("วันที่ประเมิน", when(rec.record_date, false))}${info("HN", esc(rec.hn))}${info("ชื่อผู้ป่วย", esc(rec.patient_name))}
      ${info("AN", esc(d.an || "-"))}${info("แผนก", esc(d.dept || "-"))}${info("แพทย์ผู้ทำการรักษา", esc(d.physician || "-"))}
      ${d.indication ? info("ข้อบ่งใช้ที่ประเมิน", esc(d.indication)) : ""}${info("ผู้ประเมิน", esc(d.evaluator || "-"))}
      ${info("สรุปผล", dueResultBadge(d.result))}
    </div>
    ${criteria}
    ${ev ? `<h3 class="form-section">5. สรุปผลการประเมินความเหมาะสมในการใช้ยา</h3>${dueSummaryHtml(ev)}` : ""}
    ${d.action ? `<h3 class="form-section">การดำเนินการ / ข้อเสนอแนะ</h3><p class="pre">${esc(d.action)}</p>` : ""}
    <p class="meta">บันทึกโดย ${esc(rec.created_by_name)} ${when(rec.created_at)}${rec.updated_at ? ` · แก้ไขล่าสุดโดย ${esc(rec.updated_by_name)} ${when(rec.updated_at)}` : ""}</p>
    <div class="doc-actions">${buttons.join("")}</div>`, null, "ปิด");
  const formEl = wireDialog(() => {});
  formEl.onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "edit") return openDueForm(m, rec);
    if (act === "print") return printDue(rec);
    if (act === "history") return openHistory(m, rec);
    if (act === "patient") { dlg.close(); return openPatient(rec.hn); }
    if (act === "delete") {
      if (!confirm("ลบแบบประเมินนี้? (ข้อมูลยังเก็บไว้ในประวัติการแก้ไข)")) return;
      try { await api("POST", `/records/${rec.id}/delete`, {}); toast("ลบแล้ว"); dlg.close(); refresh(); }
      catch (err) { toast(err.message, true); }
    }
  };
}

// พิมพ์ตามรูปแบบแบบประเมินกระดาษ
function printDue(rec) {
  const d = rec.data;
  const form = dueForm(d.drug);
  if (!form) return toast("ไม่พบแบบประเมินของยานี้", true);
  const ans = d.answers || {};
  const ev = dueEvaluate(form, dueIndicationKey(form, d.indication), ans);
  const mark = (id, k) => (ans[id] === k ? "✓" : "");
  $("#print").innerHTML = `<div class="report due-print">
    <h1>แบบประเมินความเหมาะสมในการใช้ยา (Drug Use Evaluation; DUE)</h1>
    <p class="center">กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค โรงพยาบาลตาพระยา</p>
    <p class="center"><b>${esc(form.heading)}</b></p>
    <p>ชื่อ-นามสกุล: <b>${esc(rec.patient_name)}</b> &nbsp; HN: <b>${esc(rec.hn)}</b> &nbsp; AN: ${esc(d.an || "-")} &nbsp; แผนก: ${esc(d.dept || "-")}
      &nbsp; แพทย์ผู้ทำการรักษา: ${esc(d.physician || "-")} &nbsp; วันที่ประเมิน: ${when(rec.record_date, false)}
      ${d.indication ? `<br>ข้อบ่งใช้ที่ประเมิน: ${esc(d.indication)}` : ""}</p>
    <table><thead><tr><th>ลำดับ</th><th>เกณฑ์การประเมิน</th><th>ใช่</th><th>ไม่ใช่</th><th>หมายเหตุ</th></tr></thead><tbody>
      ${ev.sections.map((s) => `<tr class="sec"><td colspan="5"><b>${esc(s.title)}</b></td></tr>${s.items.map((it) => `<tr>
        <td>${esc(it.id.replace(/-\d+$/, ""))}</td>
        <td>${it.sub ? `<small>${esc(it.sub)}</small><br>` : ""}${esc(it.text)}${ans[it.id + "_v"] ? ` [${esc(it.input || "ได้เท่ากับ")} ${esc(ans[it.id + "_v"])}]` : ""}</td>
        <td class="center">${mark(it.id, "Y")}</td><td class="center">${mark(it.id, "N")}</td>
        <td>${ans[it.id] === "NA" ? "ไม่ประเมิน " : ""}${esc(ans[it.id + "_n"] || "")}</td></tr>`).join("")}`).join("")}
      <tr class="sec"><td colspan="5"><b>สรุปผลการประเมินความเหมาะสมในการใช้ยา (ต้องตอบ “ใช่” ทุกข้อเท่านั้นจึงจะสรุปการประเมินว่า “เหมาะสม”)</b></td></tr>
      ${ev.sections.map((s) => `<tr><td colspan="2">${esc(s.summary)}</td><td colspan="3">${esc(DUE_SECTION_BADGE[s.status][0])}</td></tr>`).join("")}
      <tr><td colspan="2"><b>สรุปผลการประเมินการใช้ยา ${esc(d.drug)}</b></td><td colspan="3"><b>${esc(d.result || "-")}</b></td></tr>
    </tbody></table>
    ${d.action ? `<p><b>การดำเนินการ / ข้อเสนอแนะ:</b> <span class="pre">${esc(d.action)}</span></p>` : ""}
    <div class="signs one"><div class="sign"><div>ลงชื่อ ....................................... ผู้ประเมิน</div>
      <div>( ${esc(d.evaluator || "")} )</div></div></div>
  </div>`;
  window.print();
}

// ---------- หน้าวิเคราะห์ผลการประเมิน DUE ----------

let duePeriod = "all";
let dueDrug = "all";

async function dueView(m) {
  view.innerHTML = `<div class="toolbar">
      <h2>${esc(m.title)}</h2>
      <select id="period" aria-label="ช่วงเวลา"></select>
      <input type="search" id="q" placeholder="ค้นหา HN ชื่อ แพทย์">
      <button class="btn" data-act="xlsx">ดาวน์โหลด Excel</button>
      <button class="btn primary" data-act="new">+ ประเมินใหม่</button>
    </div>
    <div class="chips-bar" id="drugs"></div>
    <div id="analysis"></div>
    <h3 class="group-title">รายละเอียดการประเมินรายยา</h3>
    <div id="due-detail"></div>
    <h3 class="group-title">รายการแบบประเมิน</h3>
    <div class="list" id="list"></div>`;
  const all = await api("GET", `/records?module=${m.key}`);
  const years = [...new Set(all.map((r) => fiscalYear(r.record_date)))].sort((a, b) => b - a);
  const months = [...new Set(all.map((r) => r.record_date.slice(0, 7)))].sort().reverse();
  const periods = [["all", "ทั้งหมด"], ...years.map((y) => [`fy:${y}`, `ปีงบประมาณ ${y}`]), ...months.map((k) => [`m:${k}`, monthLabel(k)])];
  if (!periods.some(([k]) => k === duePeriod)) duePeriod = "all";
  $("#period").innerHTML = periods.map(([k, t]) => option(k, t, duePeriod)).join("");
  let shown = [];
  const draw = () => {
    duePeriod = $("#period").value;
    const [kind, val] = duePeriod.split(":");
    const inPeriod = all.filter((r) => (kind === "fy" ? fiscalYear(r.record_date) === Number(val) : kind === "m" ? r.record_date.startsWith(val) : true));
    const drugs = (m.forms || []).map((f) => f.drug);
    $("#drugs").innerHTML = [["all", "ทุกยา"], ...drugs.map((d) => [d, d])].map(([k, label]) =>
      `<button type="button" class="chip-btn${k === dueDrug ? " on" : ""}" data-act="drug" data-id="${esc(k)}">${esc(label)}
        <b>${num(inPeriod.filter((r) => k === "all" || r.data.drug === k).length)}</b></button>`).join("");
    const rows = inPeriod.filter((r) => dueDrug === "all" || r.data.drug === dueDrug);
    const q = $("#q").value.trim().toLowerCase();
    shown = q ? rows.filter((r) => recordText(r).includes(q) || String(r.data.physician || "").toLowerCase().includes(q)) : rows;
    $("#analysis").innerHTML = all.length ? dueAnalysis(m, rows) : `<p class="hint">ยังไม่มีแบบประเมิน กด "+ ประเมินใหม่" เพื่อเริ่มประเมินการสั่งใช้ยา</p>`;
    $("#due-detail").innerHTML = dueDetailHtml(m, rows);
    $("#list").innerHTML = table(["วันที่ประเมิน", "HN", "ชื่อผู้ป่วย", "ยา", "ผล", "เกณฑ์ที่ไม่เหมาะสม", "ผู้ประเมิน", ""], shown.map((r) => [
      when(r.record_date, false), esc(r.hn || "-"), esc(r.patient_name || "-"),
      `${esc(r.data.drug)}${r.data.indication ? `<br><small class="muted">${esc(r.data.indication)}</small>` : ""}`,
      dueResultBadge(r.data.result), esc((r.data.failed || []).join(", ") || "-"), esc(r.data.evaluator || "-"),
      actions(btn("open", "ดู", r.id)),
    ]), q ? "ไม่พบแบบประเมินที่ค้นหา" : "ยังไม่มีแบบประเมินในช่วงนี้");
  };
  $("#period").onchange = draw;
  $("#q").oninput = draw;
  bind({
    drug: (k) => { dueDrug = k; draw(); },
    printCriteria: (drug) => printDueCriteria(drug),
    new: () => (dueDrug !== "all" ? openDueForm(m, null, { drug: dueDrug }) : chooseDueDrug(m)),
    open: (id) => openRecord(id),
    xlsx: () => (shown.length ? downloadBlob(dueWorkbook(m, shown), `ผลการประเมิน DUE - ${$("#period").selectedOptions[0].text}.xlsx`)
      : toast("ไม่มีข้อมูลในช่วงที่เลือก", true)),
  });
  draw();
}

// เกณฑ์มาตรฐานการใช้ยา (จากเอกสารของกลุ่มงาน)
function dueCriteriaHtml(form) {
  if (!form.criteria) return `<p class="empty">ยังไม่มีเกณฑ์มาตรฐานของยานี้</p>`;
  const line = (t) => (/^\d+(\.\d+)+\s/.test(t) ? `<li class="h">${esc(t)}</li>` : `<li>${esc(t.replace(/^•\s*/, ""))}</li>`);
  return `<div class="due-criteria">${form.criteria.map(([h, lines]) => `<h4>${esc(h)}</h4><ul>${lines.map(line).join("")}</ul>`).join("")}
    ${form.references?.length ? `<h4>เอกสารอ้างอิง</h4><ol class="refs">${form.references.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}
    ${form.source ? `<p class="meta">ที่มา: ${esc(form.source)}</p>` : ""}</div>`;
}

// ผลการประเมินรายข้อของยา 1 ตัว: จำนวน ใช่ / ไม่ใช่ / ไม่ประเมิน และร้อยละที่ผ่านของแต่ละหมวด
function dueItemStatsHtml(form, rows) {
  if (!rows.length) return `<p class="empty">ยังไม่มีการประเมินยานี้ในช่วงที่เลือก</p>`;
  const evals = rows.map((r) => dueEvaluate(form, dueIndicationKey(form, r.data.indication), r.data.answers || {}));
  const pct = (a, b) => (b ? `${(a * 100 / b).toFixed(1)}%` : "-");
  return form.sections.map((s) => {
    const statuses = evals.map((ev) => ev.sections.find((x) => x.title === s.title)?.status).filter((st) => st === "ok" || st === "bad");
    const good = statuses.filter((st) => st === "ok").length;
    const body = s.items.map((it) => {
      const vals = rows.map((r) => r.data.answers?.[it.id]).filter(Boolean);
      const y = vals.filter((v) => v === "Y").length;
      const n = vals.filter((v) => v === "N").length;
      const na = vals.filter((v) => v === "NA").length;
      const nums = it.number ? rows.map((r) => r.data.answers?.[`${it.id}_v`]).filter((x) => x != null && x !== "" && Number.isFinite(Number(x))).map(Number) : [];
      const avg = nums.length ? `<br><small class="muted">${esc(it.input)} เฉลี่ย ${num(nums.reduce((a, b) => a + b, 0) / nums.length)} (${nums.length} ราย)</small>` : "";
      return [esc(it.id.replace(/-\d+$/, "")), `${it.sub ? `<small class="muted">${esc(it.sub)}</small><br>` : ""}${esc(it.text)}${avg}`,
        [vals.length ? num(y) : "-", "num"], [vals.length ? `<span class="${n ? "bad-text" : ""}">${num(n)}</span>` : "-", "num"],
        [vals.length ? num(na) : "-", "num"], [vals.length ? pct(y, y + n) : "-", "num"]];
    });
    return `<h4>${esc(s.title)} <small>${statuses.length ? `เหมาะสม ${good}/${statuses.length} ราย (${pct(good, statuses.length)})` : "ยังไม่มีการประเมินหมวดนี้"}</small></h4>
      ${table(["ข้อ", "เกณฑ์การประเมิน", ["ใช่", "num"], ["ไม่ใช่", "num"], ["ไม่ประเมิน", "num"], ["ร้อยละผ่าน", "num"]], body, "-")}`;
  }).join("");
}

function dueDetailHtml(m, rows) {
  const forms = (m.forms || []).filter((f) => dueDrug === "all" || f.drug === dueDrug);
  return forms.map((f) => {
    const list = rows.filter((r) => r.data.drug === f.drug);
    const good = list.filter((r) => r.data.result === "เหมาะสม").length;
    return `<details class="card due-detail" ${dueDrug !== "all" ? "open" : ""}>
      <summary><b>${esc(f.drug)}</b> <small>${esc(f.heading)}</small>
        <span class="due-detail-count">${list.length ? `ประเมิน ${num(list.length)} ราย · เหมาะสม ${list.length ? ((good * 100) / list.length).toFixed(1) : 0}%` : "ยังไม่มีการประเมิน"}</span></summary>
      <div class="due-detail-body">
        <h3>ผลการประเมินรายข้อ</h3>${dueItemStatsHtml(f, list)}
        <h3>เกณฑ์มาตรฐานการใช้ยา ${esc(f.drug)}</h3>${dueCriteriaHtml(f)}
        <div class="doc-actions">${btn("printCriteria", "พิมพ์เกณฑ์มาตรฐาน", f.drug)}</div>
      </div></details>`;
  }).join("");
}

function printDueCriteria(drug) {
  const f = dueForm(drug);
  $("#print").innerHTML = `<div class="report"><h1>เกณฑ์มาตรฐานการใช้ยา ${esc(f.drug)}</h1>
    <p class="center">กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค โรงพยาบาลตาพระยา</p>${dueCriteriaHtml(f)}</div>`;
  window.print();
}

function dueAnalysis(m, rows) {
  const total = rows.length;
  const ok = rows.filter((r) => r.data.result === "เหมาะสม").length;
  const rate = (a, b) => (b ? (a * 100 / b).toFixed(1) + "%" : "-");
  const patients = new Set(rows.map((r) => r.hn)).size;
  // ร้อยละเหมาะสมแยกตามยา
  const byDrug = (m.forms || []).map((f) => {
    const list = rows.filter((r) => r.data.drug === f.drug);
    const good = list.filter((r) => r.data.result === "เหมาะสม").length;
    return { label: f.drug, value: list.length ? good * 100 / list.length : 0, text: rate(good, list.length), sub: `${good}/${list.length} ราย` };
  }).filter((x) => x.sub !== "0/0 ราย");
  // เกณฑ์ที่ไม่เหมาะสมบ่อย
  const catCount = new Map();
  for (const r of rows) for (const c of r.data.failed || []) catCount.set(c, (catCount.get(c) || 0) + 1);
  const cats = [...catCount].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, sub: `ราย (${rate(value, total)})` }));
  // ข้อที่ตอบ "ไม่ใช่" บ่อย (รายข้อของทุกแบบประเมินในช่วงนี้)
  const itemCount = new Map();
  for (const r of rows) {
    const f = dueForm(r.data.drug);
    if (!f) continue;
    for (const s of f.sections) for (const it of s.items) {
      if (r.data.answers?.[it.id] !== "N") continue;
      const key = `${f.drug}|${it.id}`;
      const cur = itemCount.get(key) || { label: `${dueDrug === "all" ? f.drug.split(" ")[0] + " · " : ""}ข้อ ${it.id.replace(/-\d+$/, "")}`, title: it.text, value: 0 };
      cur.value += 1;
      itemCount.set(key, cur);
    }
  }
  const items = [...itemCount.values()].sort((a, b) => b.value - a.value).slice(0, 10).map((x) => ({ ...x, sub: "ครั้ง" }));
  // แนวโน้มรายเดือน
  const months = [...new Set(rows.map((r) => r.record_date.slice(0, 7)))].sort();
  const trend = months.map((k) => {
    const list = rows.filter((r) => r.record_date.startsWith(k));
    const good = list.filter((r) => r.data.result === "เหมาะสม").length;
    return { label: shortMonth(k), value: good * 100 / list.length, text: rate(good, list.length), title: `${monthLabel(k)}: เหมาะสม ${good}/${list.length} ราย` };
  });
  const byDept = ["OPD", "IPD"].map((d) => {
    const list = rows.filter((r) => r.data.dept === d);
    const good = list.filter((r) => r.data.result === "เหมาะสม").length;
    return { label: d, value: list.length ? good * 100 / list.length : 0, text: rate(good, list.length), sub: `${good}/${list.length} ราย` };
  }).filter((x) => x.sub !== "0/0 ราย");
  return `<section class="kpis">
      ${kpi("จำนวนที่ประเมิน", num(total), `ผู้ป่วย ${num(patients)} คน`)}
      ${kpi("เหมาะสม", rate(ok, total), `${num(ok)} ราย`)}
      ${kpi("ไม่เหมาะสม", rate(total - ok, total), `${num(total - ok)} ราย`)}
      ${kpi("เกณฑ์ที่ไม่เหมาะสมบ่อยที่สุด", cats[0] ? `${num(cats[0].value)} ราย` : "-", esc(cats[0]?.label || "ไม่มี"))}
    </section>
    <div class="grid2 analysis">
      <section class="card"><h2>ร้อยละความเหมาะสมแยกตามยา</h2>${barList(byDrug)}</section>
      <section class="card"><h2>เกณฑ์ที่ประเมินว่าไม่เหมาะสม</h2>${barList(cats, "ไม่พบเกณฑ์ที่ไม่เหมาะสม")}</section>
      <section class="card"><h2>ข้อที่ตอบ "ไม่ใช่" บ่อย <small>เลื่อนเมาส์เพื่อดูเกณฑ์</small></h2>${barList(items, "ไม่มีข้อที่ตอบไม่ใช่")}</section>
      <section class="card"><h2>ร้อยละความเหมาะสมรายเดือน</h2>${columnChart(trend)}
        ${byDept.length ? `<h3>แยกตามแผนก</h3>${barList(byDept)}` : ""}</section>
    </div>`;
}

function dueWorkbook(m, rows) {
  const sheets = [];
  const head = ["วันที่ประเมิน", "HN", "ชื่อผู้ป่วย", "AN", "แผนก", "แพทย์ผู้ทำการรักษา", "ยา", "ข้อบ่งใช้", "สรุปผล", "เกณฑ์ที่ไม่เหมาะสม", "การดำเนินการ", "ผู้ประเมิน"];
  const base = (r) => [when(r.record_date, false), r.hn || "", r.patient_name || "", r.data.an || "", r.data.dept || "", r.data.physician || "",
    r.data.drug, r.data.indication || "", r.data.result || "", (r.data.failed || []).join(", "), r.data.action || "", r.data.evaluator || ""];
  sheets.push({ name: "สรุปทุกยา", bold: new Set([0]), widths: [12, 10, 22, 10, 7, 20, 30, 24, 11, 30, 30, 20], rows: [head, ...rows.map(base)] });
  // ชีตรายยา: คำตอบรายข้อ
  for (const f of m.forms || []) {
    const list = rows.filter((r) => r.data.drug === f.drug);
    if (!list.length) continue;
    const items = f.sections.flatMap((s) => s.items);
    sheets.push({
      name: f.drug.split(" ")[0], bold: new Set([0]),
      rows: [[...head.slice(0, 3), "ข้อบ่งใช้", "สรุปผล", ...items.map((it) => `ข้อ ${it.id.replace(/-\d+$/, "")} ${it.text.slice(0, 60)}`)],
        ...list.map((r) => [when(r.record_date, false), r.hn || "", r.patient_name || "", r.data.indication || "", r.data.result || "",
          ...items.map((it) => {
            const a = r.data.answers?.[it.id];
            const val = r.data.answers?.[it.id + "_v"];
            return a ? DUE_ANSWER[a] + (val ? ` (${val})` : "") : "";
          })])],
    });
  }
  return buildXlsx(sheets);
}

// ---------- การใช้ยาในผู้ป่วยที่มีภาวะไตบกพร่อง ----------
// ตารางยา (งาน renal_drugs): 1 บันทึกต่อยา 1 ตัว ช่วงค่าไตเก็บในช่อง bands บรรทัดละช่วง เช่น "10-30: 250 mg q 12 hr"
// ตรวจรายการสั่งยาในเบราว์เซอร์ ข้อมูลผู้ป่วยไม่ถูกบันทึกจนกว่าจะกด "บันทึกผล" (บันทึกเฉพาะผลที่ไม่เหมาะสม/ควรทบทวน)

const RENAL_LEVEL = { avoid: ["ห้ามใช้/ไม่แนะนำ", "bad"], caution: ["ไม่ควรเริ่มยา", "warn"], adjust: ["ปรับขนาดยา", "info"], ok: ["ไม่ต้องปรับขนาด", "ok"] };
const RENAL_STATUS = { bad: ["ไม่เหมาะสม", "bad"], review: ["ควรทบทวน", "warn"], ok: ["เหมาะสม", "ok"], none: ["ไม่อยู่ในตาราง", "muted"] };
const RENAL_N = String.raw`\d[\d,]*(?:\.\d+)?`;
const PER_DAY = { od: 1, qd: 1, hs: 1, daily: 1, once: 1, bid: 2, tid: 3, qid: 4 };
const round3 = (x) => Math.round(x * 1000) / 1000;
const renalNum = (s) => {
  const t = String(s ?? "").replace(/,/g, "").trim();
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
};
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ข้อความคำแนะนำ → ระดับ และตัวเลขที่ตรวจอัตโนมัติได้ (ขนาดสูงสุด/วัน, จำนวนครั้งสูงสุด/วัน, mg/kg ต่อครั้ง)
function renalRule(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const low = t.toLowerCase();
  const level = /ห้ามใช้|ไม่แนะนำให้ใช้/.test(t) ? "avoid" : /ไม่แนะนำให้เริ่ม|ไม่ควรเริ่ม/.test(t) ? "caution"
    : /ไม่จำเป็นต้องปรับ/.test(t) ? "ok" : "adjust";
  const rule = { level, maxDailyMg: null, maxPerDay: null, maxMgKg: null, partial: t.includes("%") };
  const unit = (u) => (u === "g" ? 1000 : 1);
  const N = RENAL_N;
  let m = low.match(/(\d+)(?:\s*-\s*\d+)?\s*(?:hrs?|h|ชม|ชั่วโมง)(?![a-z])/);
  if (m && Number(m[1]) > 0) rule.maxPerDay = round3(24 / Number(m[1]));
  m = low.match(/(?<![a-z])(od|bid|tid|qid)(?![a-z])/);
  if (m) rule.maxPerDay = PER_DAY[m[1]];
  m = t.match(/(\d+)(?:\s*-\s*(\d+))?\s*ครั้ง\s*\/\s*สัปดาห์/);
  if (m) rule.maxPerDay = round3(Number(m[2] || m[1]) / 7);
  const mk = low.match(new RegExp(`(${N})(?:\\s*[-–]\\s*(${N}))?\\s*mg\\s*/\\s*kg`));
  if (mk) {
    rule.maxMgKg = renalNum(mk[2] || mk[1]);
  } else if (!low.includes("loading") && !t.replace("ไม่แนะนำให้เริ่มยา", "").includes("เริ่มยา")) {
    // ขนาดยาเริ่มต้น และ loading dose ไม่ใช่ขนาดสูงสุด จึงไม่ตรวจ
    const md = low.match(new RegExp(`(${N})(?:\\s*[-–]\\s*(${N}))?\\s*(mg|g)\\s*/\\s*(?:day|วัน)`));
    const mq = low.match(new RegExp(`(${N})(?:\\s*[-–]\\s*(${N}))?\\s*(mg|g)\\s*(?:iv\\s*)?(?:q|ทุก)\\s*(\\d+)(?:\\s*-\\s*\\d+)?\\s*(?:hrs?|h|ชม)`));
    const mf = low.match(new RegExp(`(${N})(?:\\s*[-–]\\s*(${N}))?\\s*(mg|g)\\s*(?:iv\\s*)?(od|bid|tid|qid)(?![a-z])`));
    if (md) rule.maxDailyMg = renalNum(md[2] || md[1]) * unit(md[3]);
    else if (mq) rule.maxDailyMg = round2(renalNum(mq[2] || mq[1]) * unit(mq[3]) * 24 / Number(mq[4]));
    else if (mf) rule.maxDailyMg = renalNum(mf[2] || mf[1]) * unit(mf[3]) * PER_DAY[mf[4]];
  }
  const mx = low.match(new RegExp(`maximum\\s*:?\\s*(${N})\\s*(mg|g)\\s*/\\s*(?:day|วัน)`));
  if (mx) rule.maxDailyMg = renalNum(mx[1]) * unit(mx[2]);
  if (level === "adjust" && rule.maxDailyMg == null && rule.maxPerDay == null && rule.maxMgKg == null) rule.partial = true;
  return rule;
}

// "10-30" "<10" ">=30" "≥30" → [ต่ำสุด, สูงสุด] สูงสุด null = ไม่จำกัด
function renalRange(text) {
  const t = String(text ?? "").replace(/[–—]/g, "-").replace(/\s+/g, "").replace("≥", ">").replace("≤", "<");
  let m;
  if ((m = t.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) return [Number(m[1]), Number(m[2])];
  if ((m = t.match(/^<=?(\d+(?:\.\d+)?)$/))) return [0, Number(m[1])];
  if ((m = t.match(/^>=?(\d+(?:\.\d+)?)$/))) return [Number(m[1]), null];
  return null;
}
const rangeLabel = (lo, hi) => (hi == null ? `≥${lo}` : !lo ? `<${hi}` : `${lo}-${hi}`);

// ช่อง bands → ช่วงที่เรียงแล้ว ช่วง a-b หมายถึง a ≤ ค่าไต < b ช่องว่างระหว่างช่วง (เช่น 10-29 กับ 30-49) นับรวมกับช่วงล่าง
function parseBands(text) {
  const bands = [];
  const errors = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    const range = m && renalRange(m[1]);
    if (!range) return errors.push(`บรรทัด ${i + 1} "${line}": ต้องขึ้นต้นด้วยช่วงค่าไต แล้วตามด้วย : เช่น 10-30: ...`);
    if (range[1] != null && range[1] <= range[0]) return errors.push(`บรรทัด ${i + 1}: ค่าสูงสุดของช่วงต้องมากกว่าค่าต่ำสุด`);
    bands.push({ min: range[0], max: range[1], range, label: m[1].trim(), text: m[2].trim(), ...renalRule(m[2]) });
  });
  bands.sort((a, b) => a.min - b.min);
  for (let i = 0; i + 1 < bands.length; i++) {
    const [a, b] = [bands[i], bands[i + 1]];
    if (a.max == null || a.max > b.min) errors.push(`ช่วง ${a.label} ซ้อนกับช่วง ${b.label}`);
    else a.max = b.min;
  }
  return { bands, errors };
}

const renalDrugList = (recs) => recs.map((r) => ({
  rec: r, name: r.data.drug, aliases: r.data.aliases || "", measure: r.data.measure || "CrCl",
  draft: r.data.status !== "ตรวจสอบแล้ว", ...parseBands(r.data.bands),
})).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

// ความถี่หรือวิธีใช้ → [ครั้งต่อวัน, จำนวนต่อครั้ง]
function renalFreq(text) {
  const t = String(text ?? "").toLowerCase().replace(/×/g, "x").replace(/\*/g, "x");
  let perDose = null;
  let m;
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+)/))) return [Number(m[2]), Number(m[1])];
  if ((m = t.match(/ครั้งละ\s*(\d+(?:\.\d+)?)/))) perDose = Number(m[1]);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:เม็ด|แคปซูล|tab|cap)/))) perDose ??= Number(m[1]);
  if ((m = t.match(/วันละ\s*(\d+(?:\.\d+)?)\s*ครั้ง|(\d+(?:\.\d+)?)\s*ครั้ง\s*(?:\/|ต่อ)\s*วัน/))) return [Number(m[1] || m[2]), perDose];
  if ((m = t.match(/สัปดาห์ละ\s*(\d+)\s*ครั้ง|(\d+)\s*ครั้ง\s*(?:\/|ต่อ)\s*สัปดาห์/))) return [round3(Number(m[1] || m[2]) / 7), perDose];
  if ((m = t.match(/(?:q|ทุก)\s*(\d+(?:\.\d+)?)\s*(?:hrs?|h|ชม|ชั่วโมง)/))) return [round3(24 / Number(m[1])), perDose];
  if ((m = t.match(/(?<![a-z])(od|bid|tid|qid|hs|qd|daily|once)(?![a-z])/))) return [PER_DAY[m[1]], perDose];
  if (t.replace(/\s/g, "").includes("เช้าเย็น") || t.includes("เช้า-เย็น")) return [2, perDose];
  if (/^\s*\d+(?:\.\d+)?\s*$/.test(t)) return [Number(t), perDose];
  return [null, perDose];
}

// "500 mg" "1 g" "875/125 mg" "300" → mg
function renalMg(text) {
  const t = String(text ?? "").toLowerCase().replace(/,/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(mg|g|mcg)(?![a-z])/);
  if (m) return Number(m[1]) * { mg: 1, g: 1000, mcg: 0.001 }[m[2]];
  return /^\s*\d+(?:\.\d+)?\s*$/.test(t) ? Number(t) : null;
}

const RENAL_FORM_WORDS = new Set(["tablet", "tablets", "tab", "capsule", "capsules", "cap", "injection", "inj", "sodium",
  "sulfate", "sulphate", "hydrochloride", "hcl", "and", "with"]);
const RENAL_INJ = /(?<![a-z])(inj|injection|iv|im|vial|amp|ampoule)(?![a-z])|ฉีด/;
const RENAL_TOPICAL = /(?<![a-z])(cream|ointment|oint|gel|lotion|eye|ear|drops?|ophthalmic|topical|patch|spray|inhaler)(?![a-z])|ทา|หยอด/;

// จับคู่ชื่อยาที่สั่งกับตาราง: ทุกคำหลักของชื่อในตารางต้องอยู่ในชื่อที่สั่ง (เทียบ 7 ตัวอักษรแรก เช่น clavulanate/clavulanic)
// หรือตรงกับชื่ออื่น และรูปแบบยา (ฉีด/กิน) ต้องตรงกัน ยาใช้ภายนอกไม่ตรวจ
function renalMatch(drugs, name) {
  const low = String(name ?? "").toLowerCase();
  if (!low.trim() || RENAL_TOPICAL.test(low)) return null;
  const tokens = low.split(/[^a-z0-9ก-๙]+/).filter(Boolean);
  const inj = RENAL_INJ.test(low);
  let best = null;
  let score = 0;
  for (const d of drugs) {
    const dn = d.name.toLowerCase();
    if (RENAL_INJ.test(dn) !== inj && /tablet|capsule|tab|cap|injection|inj/.test(dn)) continue;
    const aliases = [...d.aliases.split(/[,;\n]/), ...[...d.name.matchAll(/\(([^)]+)\)/g)].map((x) => x[1])]
      .map((a) => a.trim().toLowerCase()).filter(Boolean);
    const words = (dn.replace(/\([^)]*\)/g, " ").match(/[a-z]{3,}/g) || []).filter((w) => !RENAL_FORM_WORDS.has(w));
    const has = (w) => tokens.some((t) => (w.length > 7 ? t.startsWith(w.slice(0, 7)) : t === w));
    let s = words.length && words.every(has) ? 10 * words.length : 0;
    if (aliases.some((a) => new RegExp(`(?<![a-z0-9ก-๙])${reEscape(a)}(?![a-z0-9ก-๙])`).test(low))) s = s ? s + 1 : 5;
    if (s > score) [best, score] = [d, s];
  }
  return best;
}

// Cockcroft-Gault: CrCl = (140 - อายุ) × น้ำหนัก / (72 × SCr) × 0.85 ถ้าเป็นหญิง
function cockcroftGault(age, weight, scr, sex) {
  if (!(age > 0 && weight > 0 && scr > 0)) return null;
  const female = /^(หญิง|ญ|f|female|2|w)$/i.test(String(sex ?? "").trim());
  return Math.round((140 - age) * weight / (72 * scr) * (female ? 0.85 : 1) * 10) / 10;
}

// ตรวจ 1 รายการสั่งยา status: bad = ไม่เหมาะสม, review = ควรทบทวน, ok = เหมาะสม, none = ไม่อยู่ในตาราง
function renalCheck(drugs, p) {
  const res = renalCheckCore(drugs, p);
  if (res.draft) res.reasons.push("ข้อมูลยานี้ในตารางยังเป็นร่าง รอเภสัชกรตรวจสอบ");
  return res;
}

function renalCheckCore(drugs, p) {
  const res = { ...p, status: "none", reasons: [], matched: null, draft: false, renal: null, renalLabel: "", band: "",
    level: null, doseMg: null, perDay: null, dailyMg: null };
  const d = renalMatch(drugs, p.drug);
  if (!d) return res;
  Object.assign(res, { matched: d.name, draft: d.draft });
  const calc = cockcroftGault(renalNum(p.age), renalNum(p.weight), renalNum(p.scr), p.sex);
  let order = [["CrCl", renalNum(p.crcl), "CrCl"], ["CrCl", calc, "CrCl (คำนวณจาก SCr)"], ["eGFR", renalNum(p.egfr), "eGFR"]];
  if (d.measure === "eGFR") order = [order[2], order[0], order[1]];
  const pick = order.find(([, v]) => v != null);
  if (!pick) {
    res.status = "review";
    res.reasons.unshift("ไม่มีค่าการทำงานของไต (CrCl, eGFR หรือ SCr + อายุ + น้ำหนัก + เพศ)");
    return res;
  }
  const [kind, value, label] = pick;
  Object.assign(res, { renal: value, renalLabel: label });
  if (kind !== d.measure) res.reasons.push(`ตารางใช้ ${d.measure} แต่ไม่มีค่านี้ จึงใช้ ${label} แทน`);
  if (label.includes("คำนวณ") && !String(p.sex ?? "").trim()) res.reasons.push("ไม่ระบุเพศ คำนวณ CrCl แบบเพศชาย");
  const band = d.bands.find((b) => b.min <= value && (b.max == null || value < b.max));
  if (!band) {
    if (d.bands.length && value < d.bands[0].min) {
      res.status = "review";
      res.reasons.unshift(`ตารางไม่มีคำแนะนำเมื่อ ${d.measure} ต่ำกว่า ${d.bands[0].min}`);
    } else {
      res.status = "ok";
      res.reasons.unshift("ค่าการทำงานของไตอยู่นอกช่วงที่ต้องปรับขนาดยา");
    }
    return res;
  }
  Object.assign(res, { band: `${d.measure} ${band.label}: ${band.text}`, level: band.level });
  let [perDay, perDose] = p.freq ? renalFreq(p.freq) : [null, null];
  if (p.sig) {
    const [pd2, dose2] = renalFreq(p.sig);
    perDay ??= pd2;
    perDose ??= dose2;
  }
  const qty = renalNum(p.qty) ?? perDose;
  let dose = renalMg(p.dose);
  if (dose == null) {
    const strength = renalMg(p.drug);
    dose = strength != null ? strength * (qty || 1) : null;
  }
  Object.assign(res, { doseMg: dose, perDay, dailyMg: dose != null && perDay != null ? round2(dose * perDay) : null });
  const bad = [];
  const missing = [];
  if (band.level === "avoid") bad.push(`ไม่แนะนำ/ห้ามใช้เมื่อ ${label} ${num(value)}`);
  if (band.maxDailyMg != null) {
    if (res.dailyMg == null) missing.push("ขนาดยาต่อวัน");
    else if (res.dailyMg > band.maxDailyMg * 1.001) bad.push(`ขนาดยา ${num(res.dailyMg)} mg/วัน เกินที่แนะนำ ${num(band.maxDailyMg)} mg/วัน`);
  }
  if (band.maxPerDay != null) {
    if (perDay == null) missing.push("ความถี่");
    else if (perDay > band.maxPerDay * 1.001) bad.push(`ให้ยาวันละ ${num(perDay)} ครั้ง ถี่กว่าที่แนะนำ (ไม่เกิน ${num(band.maxPerDay)} ครั้ง/วัน)`);
  }
  if (band.maxMgKg != null) {
    const w = renalNum(p.weight);
    if (dose == null || !w) missing.push("ขนาดยาต่อครั้งและน้ำหนัก");
    else if (dose > band.maxMgKg * w * 1.001) bad.push(`ขนาดยา ${num(dose)} mg/ครั้ง เกิน ${num(band.maxMgKg)} mg/kg (${num(band.maxMgKg * w)} mg)`);
  }
  if (bad.length) {
    res.status = "bad";
    res.reasons.unshift(...bad);
  } else if (band.level === "ok") {
    res.status = "ok";
  } else if (band.level === "caution" || band.partial || missing.length) {
    res.status = "review";
    if (missing.length) res.reasons.unshift(`ตรวจอัตโนมัติไม่ได้ ขาดข้อมูล: ${missing.join(", ")}`);
    res.reasons.unshift(`ตรวจสอบตามคำแนะนำ: ${band.text}`);
  } else {
    res.status = "ok";
  }
  return res;
}

// ---------- อ่านไฟล์รายการสั่งยาผู้ป่วย ----------

const renalHead = (s) => String(s ?? "").toLowerCase().replace(/[\s*_\-().:/]/g, "");
const RENAL_ORDER_COLUMNS = {
  hn: ["hn", "เลขhn", "เลขที่ผู้ป่วย", "หมายเลขผู้ป่วย", "an", "vn"],
  name: ["ชื่อผู้ป่วย", "ชื่อสกุล", "ชื่อนามสกุล", "ชื่อสกุลผู้ป่วย", "patientname", "ผู้ป่วย"],
  date: ["วันที่", "วันที่สั่ง", "วันที่สั่งยา", "date", "orderdate"],
  drug: ["ชื่อยา", "รายการยา", "ยา", "drug", "drugname", "ชื่อยาที่สั่ง", "ยาที่สั่ง"],
  dose: ["ขนาดยาต่อครั้งmg", "ขนาดยาmg", "ขนาดยาต่อครั้ง", "ขนาดยา", "dose", "dosemg"],
  qty: ["จำนวนต่อครั้ง", "เม็ดต่อครั้ง", "จำนวนเม็ดต่อครั้ง", "qtyperdose"],
  freq: ["ความถี่", "ครั้งต่อวัน", "ความถี่ต่อวัน", "frequency", "freq"],
  sig: ["วิธีใช้", "วิธีใช้ยา", "sig", "usage", "drugusage"],
  crcl: ["crcl", "crclmlmin", "creatinineclearance"],
  egfr: ["egfr", "egfrmlmin173m2", "gfr"],
  scr: ["scr", "creatinine", "serumcreatinine", "cr", "ครีเอตินิน"],
  age: ["อายุ", "อายุปี", "age"],
  weight: ["น้ำหนัก", "น้ำหนักkg", "bw", "weight", "weightkg"],
  sex: ["เพศ", "sex", "gender"],
};

// หาแถวหัวตาราง: จับคู่ชื่อคอลัมน์แบบตรงทั้งคำก่อน แล้วค่อยแบบขึ้นต้นด้วยชื่อ
function findHeader(sheets, columns, ok) {
  for (const sheet of sheets) {
    for (let h = 0; h < Math.min(sheet.rows.length, 15); h++) {
      const head = (sheet.rows[h] || []).map(renalHead);
      const cols = {};
      const used = new Set();
      for (const exact of [true, false]) {
        for (const [key, names] of Object.entries(columns)) {
          if (key in cols) continue;
          const i = head.findIndex((c, idx) => c && !used.has(idx) && names.some((n) => (exact ? c === n : n.length >= 3 && c.startsWith(n))));
          if (i >= 0) { cols[key] = i; used.add(i); }
        }
      }
      if (ok(cols)) return { sheet, head: h, cols };
    }
  }
  return null;
}

function renalOrderRows(target) {
  const { sheet, head, cols } = target;
  const rows = [];
  for (let i = head + 1; i < sheet.rows.length; i++) {
    const c = sheet.rows[i] || [];
    const r = { _row: i + 1 };
    for (const [k, j] of Object.entries(cols)) {
      const text = cellText(c[j]);
      if (!text) continue;
      const d = k === "date" ? excelDate(c[j]) : null;
      r[k] = k === "date" ? (d ? fixYear(d, null) : "") : text;
    }
    if (r.drug) rows.push(r);
  }
  // ค่าไต อายุ น้ำหนัก เพศ ชื่อ ที่ว่าง ใช้ค่าจากแถวบนของผู้ป่วย (HN) เดียวกัน
  const last = {};
  for (const r of rows) {
    if (!r.hn) continue;
    const prev = (last[r.hn] ??= {});
    for (const k of ["name", "crcl", "egfr", "scr", "age", "weight", "sex", "date"]) {
      if (r[k]) prev[k] = r[k];
      else if (prev[k]) r[k] = prev[k];
    }
  }
  return rows;
}

// ---------- หน้าจอ ----------

let renalTab = "check";
let renalResults = null; // ผลตรวจล่าสุด เก็บในหน่วยความจำเท่านั้น
let renalSource = "";
let renalFilter = "flag";
let renalDrugQuery = "";

const RENAL_FILTERS = [
  ["flag", "ต้องแจ้งเตือน", (r) => r.status === "bad" || r.status === "review"],
  ["bad", "ไม่เหมาะสม", (r) => r.status === "bad"],
  ["review", "ควรทบทวน", (r) => r.status === "review"],
  ["ok", "เหมาะสม", (r) => r.status === "ok"],
  ["none", "ไม่อยู่ในตาราง", (r) => r.status === "none"],
  ["all", "ทั้งหมด", () => true],
];
const renalValueText = (r) => (r.renal != null ? `${r.renalLabel} ${num(r.renal)}` : "");
const renalDoseText = (r) => [
  r.doseMg != null && `${num(r.doseMg)} mg/ครั้ง`,
  r.perDay != null && `${num(r.perDay)} ครั้ง/วัน`,
  r.dailyMg != null && `รวม ${num(r.dailyMg)} mg/วัน`,
].filter(Boolean).join(" · ") || [r.dose, r.freq, r.sig].filter(Boolean).join(" ");

async function renalView(m) {
  const recs = await api("GET", "/records?module=renal_drugs");
  const drugs = renalDrugList(recs);
  const tabs = [["check", "ตรวจการสั่งยา"], ["saved", "ผลที่บันทึกไว้"], ["drugs", `ตารางยาปรับขนาดตามไต (${num(drugs.length)})`]];
  view.innerHTML = `<div class="toolbar"><h2>${esc(m.title)}</h2></div>
    <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="tab${k === renalTab ? " on" : ""}"
      aria-selected="${k === renalTab}" data-act="tab" data-id="${k}">${esc(t)}</button>`).join("")}</div>
    <div id="renal-body"></div>`;
  const handlers = renalTab === "saved" ? await renalSavedTab(m) : renalTab === "drugs" ? renalDrugsTab(drugs) : renalCheckTab(m, drugs);
  bind({ tab: (k) => { renalTab = k; renalView(m).then(decorateTitle).catch((e) => toast(e.message, true)); }, ...handlers });
}

function renalCheckTab(m, drugs) {
  const drafts = drugs.filter((d) => d.draft).length;
  $("#renal-body").innerHTML = `<section class="card">
      <div class="panel-head"><h2>ตรวจขนาดยาตามการทำงานของไต</h2>
        <div class="btn-row">${btn("import", "นำเข้า Excel รายการสั่งยา", "", "primary")}${btn("single", "ตรวจทีละรายการ")}${btn("template", "ดาวน์โหลดแม่แบบ")}</div></div>
      <p class="hint">ไฟล์ต้องมีคอลัมน์ <b>ชื่อยา</b> และค่าการทำงานของไต (<b>CrCl</b> หรือ <b>eGFR</b> หรือ <b>SCr + อายุ + น้ำหนัก + เพศ</b>
        ระบบคำนวณ CrCl ด้วย Cockcroft-Gault) ควรมี HN ขนาดยา และความถี่/วิธีใช้ เพื่อตรวจขนาดยาได้ครบ
        ระบบตรวจในเครื่องนี้ ข้อมูลผู้ป่วยยังไม่ถูกบันทึกจนกว่าจะกด "บันทึกผลที่ต้องแจ้งเตือน"</p>
      ${!drugs.length ? `<p class="alert bad">ยังไม่มีตารางยาที่ต้องปรับขนาดตามไต ${me.role === "admin" ? 'ไปที่แท็บ "ตารางยาปรับขนาดตามไต" เพื่อนำเข้า' : "แจ้งผู้ดูแลระบบให้นำเข้าตารางยา"}</p>`
        : drafts ? `<p class="alert warn">ตารางยามี ${num(drafts)} รายการที่ยังเป็นร่าง รอเภสัชกรตรวจสอบ ผลตรวจของยาเหล่านี้ใช้ประกอบการพิจารณาเท่านั้น</p>` : ""}
    </section>
    <div id="renal-results"></div>`;
  const draw = () => renalDrawResults(m);
  draw();
  const run = (rows, source) => {
    renalResults = rows.map((p) => renalCheck(drugs, p));
    renalSource = source;
    renalFilter = "flag";
    draw();
  };
  return {
    import: async () => {
      if (!drugs.length) return toast("ยังไม่มีตารางยาที่ต้องปรับขนาดตามไต", true);
      const file = await pickFile(".xlsx,.csv");
      if (!file) return;
      try {
        const target = findHeader(await readSpreadsheet(file), RENAL_ORDER_COLUMNS,
          (c) => "drug" in c && ("crcl" in c || "egfr" in c || "scr" in c));
        if (!target) throw new Error("ไม่พบหัวตาราง ต้องมีคอลัมน์ ชื่อยา และ CrCl, eGFR หรือ SCr (ดาวน์โหลดแม่แบบเพื่อดูรูปแบบ)");
        const rows = renalOrderRows(target);
        if (!rows.length) throw new Error("ไม่พบรายการยาในไฟล์");
        run(rows, `${file.name} · ชีต ${target.sheet.name}`);
        toast(`ตรวจแล้ว ${num(rows.length)} รายการ`);
      } catch (err) {
        toast(err.message, true);
      }
    },
    single: () => {
      if (!drugs.length) return toast("ยังไม่มีตารางยาที่ต้องปรับขนาดตามไต", true);
      openForm({
        title: "ตรวจขนาดยาทีละรายการ", wide: true, submitLabel: "ตรวจ",
        fields: [
          { name: "hn", label: "HN" }, { name: "name", label: "ชื่อผู้ป่วย" },
          { name: "drug", label: "ชื่อยาที่สั่ง", required: true, placeholder: "เช่น Allopurinol 100 mg tablet" },
          { name: "dose", label: "ขนาดยาต่อครั้ง", placeholder: "เช่น 300 mg" },
          { name: "freq", label: "ความถี่ / วิธีใช้", placeholder: "เช่น OD, BID, q 12 hr, 1x3" },
          { name: "crcl", label: "CrCl", type: "number", unit: "ml/min", section: "ค่าการทำงานของไต: ใส่ CrCl หรือ eGFR หรือ SCr + อายุ + น้ำหนัก + เพศ" },
          { name: "egfr", label: "eGFR", type: "number", unit: "ml/min/1.73 m²" },
          { name: "scr", label: "SCr", type: "number", unit: "mg/dL" },
          { name: "age", label: "อายุ", type: "number", unit: "ปี" },
          { name: "weight", label: "น้ำหนัก", type: "number", unit: "kg" },
          { name: "sex", label: "เพศ", type: "select", options: ["ชาย", "หญิง"] },
        ],
        onSubmit: async (data) => {
          const p = Object.fromEntries(Object.entries(data).filter(([, v]) => String(v).trim() !== ""));
          if (!p.crcl && !p.egfr && !(p.scr && p.age && p.weight)) throw new Error("กรุณาใส่ CrCl หรือ eGFR หรือ SCr + อายุ + น้ำหนัก");
          p.date = isoDate();
          const r = renalCheck(drugs, p);
          renalResults = [r, ...(renalResults || [])];
          renalSource ||= "ตรวจทีละรายการ";
          renalFilter = "all";
          draw();
          toast(`ผลตรวจ: ${RENAL_STATUS[r.status][0]}`, r.status === "bad");
        },
      });
    },
    template: () => downloadBlob(renalTemplate(), "แม่แบบรายการสั่งยาผู้ป่วยไต.xlsx"),
    filter: (k) => { renalFilter = k; draw(); },
    save: () => saveRenalResults(m).catch((e) => toast(e.message, true)),
    xlsx: () => downloadBlob(renalResultsWorkbook(renalResults), `ผลตรวจยาผู้ป่วยไต_${when(isoDate(), false).replace(/\//g, "-")}.xlsx`),
    clear: () => {
      if (!confirm("ล้างผลตรวจที่แสดงอยู่? (ผลที่บันทึกแล้วยังอยู่ในแท็บผลที่บันทึกไว้)")) return;
      renalResults = null;
      renalSource = "";
      draw();
    },
  };
}

function renalDrawResults() {
  const box = $("#renal-results");
  if (!box) return;
  if (!renalResults) { box.innerHTML = ""; return; }
  const count = (s) => renalResults.filter((r) => r.status === s).length;
  const flagged = renalResults.filter((r) => r.status === "bad" || r.status === "review");
  const unsaved = flagged.filter((r) => !r.saved).length;
  const test = RENAL_FILTERS.find(([k]) => k === renalFilter)?.[2] || (() => true);
  const shown = renalResults.filter(test);
  const patients = new Set(renalResults.map((r) => r.hn).filter(Boolean)).size;
  box.innerHTML = `<section class="card">
      <div class="panel-head"><h2>ผลการตรวจ <small>${esc(renalSource)}</small></h2>
        <div class="btn-row">${unsaved ? btn("save", `บันทึกผลที่ต้องแจ้งเตือน (${num(unsaved)})`, "", "primary") : ""}${btn("xlsx", "ดาวน์โหลดผล Excel")}${btn("clear", "ล้างผล")}</div></div>
      <section class="kpis">
        ${kpi("รายการยาที่ตรวจ", num(renalResults.length), patients ? `ผู้ป่วย ${num(patients)} คน` : "")}
        ${kpi("ไม่เหมาะสม", num(count("bad")), "รายการ")}
        ${kpi("ควรทบทวน", num(count("review")), "รายการ")}
        ${kpi("เหมาะสม", num(count("ok")), `ไม่อยู่ในตาราง ${num(count("none"))} รายการ`)}
      </section>
      <div class="chips-bar">${RENAL_FILTERS.map(([k, label, t]) => `<button type="button" class="chip-btn${k === renalFilter ? " on" : ""}"
        data-act="filter" data-id="${k}">${esc(label)} <b>${num(renalResults.filter(t).length)}</b></button>`).join("")}</div>
      ${table(["ผล", "HN / ผู้ป่วย", "ยาที่สั่ง", "ค่าไต", "ขนาดยาที่สั่ง", "คำแนะนำ / เหตุผล"], shown.map((r) => [
        badge(RENAL_STATUS[r.status][0], RENAL_STATUS[r.status][1]) + (r.saved ? `<br><small class="muted">บันทึกแล้ว</small>` : ""),
        `${esc(r.hn || "-")}${r.name ? `<br><small>${esc(r.name)}</small>` : ""}${r.date ? `<br><small>${when(r.date, false)}</small>` : ""}`,
        [`${esc(r.drug)}${r.matched ? `<br><small class="muted">ตาราง: ${esc(r.matched)}</small>${r.draft ? ` ${badge("ร่าง", "warn")}` : ""}` : ""}`, "col-drug"],
        esc(renalValueText(r) || "-"),
        esc(renalDoseText(r) || "-"),
        [`${r.band ? `<div>${esc(r.band)}</div>` : ""}${r.reasons.length ? `<ul class="reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}` || "-", "col-wide"],
      ]), "ไม่มีรายการในกลุ่มนี้")}
    </section>`;
}

const renalKey = (date, hn, drug) => [date || "", String(hn || "").trim(), uniqueKey(drug)].join("|");

async function saveRenalResults(m) {
  const flagged = (renalResults || []).filter((r) => (r.status === "bad" || r.status === "review") && !r.saved);
  if (!flagged.length) return toast("ไม่มีผลที่ต้องบันทึก", true);
  const existing = await api("GET", `/records?module=${m.key}`);
  const have = new Set(existing.map((r) => renalKey(r.record_date, r.hn, r.data.drug)));
  const fresh = flagged.filter((r) => !have.has(renalKey(r.date || isoDate(), r.hn, r.drug)));
  const rows = fresh.map((r) => ({
    _row: r._row || "", record_date: r.date || isoDate(), hn: r.hn || "", patient_name: r.name || "",
    drug: String(r.drug).slice(0, 200), matched: r.matched || "", result: RENAL_STATUS[r.status][0],
    renal: renalValueText(r).slice(0, 200), dose: renalDoseText(r).slice(0, 200),
    recommendation: r.band.slice(0, 2000), reasons: r.reasons.join("\n").slice(0, 2000),
  }));
  dlg.className = "";
  dlg.innerHTML = dialogShell("บันทึกผลที่ต้องแจ้งเตือน", `
    <p>จะบันทึก <b>${num(rows.length)}</b> รายการ (ไม่เหมาะสม/ควรทบทวน) ลงในแท็บ "ผลที่บันทึกไว้"</p>
    ${flagged.length - rows.length ? `<p class="hint">ข้าม ${num(flagged.length - rows.length)} รายการที่เคยบันทึกแล้ว (วันที่ HN และชื่อยาเดียวกัน)</p>` : ""}
    <p class="hint">ผลที่เหมาะสมและยาที่ไม่อยู่ในตารางไม่ถูกบันทึก</p>`,
    rows.length ? `บันทึก ${num(rows.length)} รายการ` : null, rows.length ? "ยกเลิก" : "ปิด");
  wireDialog(async () => {
    for (let i = 0; i < rows.length; i += 500) await api("POST", "/records/import", { module: m.key, rows: rows.slice(i, i + 500) });
    flagged.forEach((r) => (r.saved = true));
    toast(`บันทึกแล้ว ${num(rows.length)} รายการ`);
    renalDrawResults();
  });
  if (!rows.length) flagged.forEach((r) => (r.saved = true));
}

function renalResultsWorkbook(results) {
  const rows = [["ผลตรวจ", "HN", "ชื่อผู้ป่วย", "วันที่", "ยาที่สั่ง", "ยาในตาราง", "ค่าการทำงานของไต", "ขนาดยาที่สั่ง", "คำแนะนำตามตาราง", "เหตุผล"]];
  for (const r of results || []) {
    rows.push([RENAL_STATUS[r.status][0], r.hn || "", r.name || "", r.date ? when(r.date, false) : "", r.drug, r.matched || "",
      renalValueText(r), renalDoseText(r), r.band, r.reasons.join(" · ")]);
  }
  return buildXlsx([{ name: "ผลตรวจการสั่งยา", rows, bold: new Set([0]), widths: [12, 10, 20, 11, 32, 28, 18, 28, 40, 50] }]);
}

function renalTemplate() {
  return buildXlsx([
    {
      name: "รายการสั่งยา", bold: new Set([0]), widths: [10, 12, 30, 16, 12, 12, 8, 8, 8, 8, 12, 8],
      rows: [
        ["HN", "วันที่", "ชื่อยา", "ขนาดยาต่อครั้ง (mg)", "ความถี่", "วิธีใช้", "CrCl", "eGFR", "SCr", "อายุ", "น้ำหนัก (kg)", "เพศ"],
        ["000001", "22/10/2569", "Allopurinol 100 mg tablet", "300", "OD", "", "", "", "2.1", "70", "60", "ชาย"],
        ["000001", "22/10/2569", "Metformin 500 mg tablet", "", "", "1x3 pc", "", "35", "", "", "", ""],
        ["000002", "22/10/2569", "Ceftazidime 1 g injection", "1 g", "q 12 hr", "", "18", "", "", "", "", ""],
      ],
    },
    {
      name: "วิธีกรอก", widths: [110],
      rows: [
        ["วิธีกรอก (ข้อมูลในชีตแรกเป็นตัวอย่างสมมติ ลบออกก่อนใช้)"],
        ["ชื่อยา: ชื่อสามัญ เช่น Allopurinol 100 mg tablet ยาฉีดให้มีคำว่า injection หรือ inj"],
        ["ขนาดยาต่อครั้ง: ใส่เป็น mg (หรือ 1 g) ถ้าเว้นว่าง ระบบใช้ความแรงในชื่อยา × จำนวนเม็ดในวิธีใช้"],
        ["ความถี่: OD, BID, TID, QID, q 12 hr, วันละ 2 ครั้ง, 3 ครั้ง/สัปดาห์ หรือใส่ในวิธีใช้แบบ 1x3"],
        ["ค่าการทำงานของไต: ใส่ CrCl หรือ eGFR ถ้าไม่มี ใส่ SCr (mg/dL) + อายุ + น้ำหนัก + เพศ ระบบคำนวณ CrCl (Cockcroft-Gault)"],
        ["ผู้ป่วยคนเดียวหลายรายการยา ใส่ค่าไตแถวแรกพอ แถวถัดไปที่ HN เดียวกันใช้ค่าเดิม"],
        ["ใส่คอลัมน์ ชื่อผู้ป่วย ได้ถ้าต้องการบันทึกชื่อไว้กับผลที่ต้องแจ้งเตือน"],
      ],
    },
  ]);
}

async function renalSavedTab(m) {
  $("#renal-body").innerHTML = `<div class="toolbar">
      ${monthInput()}
      <input type="search" id="q" placeholder="ค้นหา HN ชื่อ หรือชื่อยา">
      <button class="btn" data-act="csv">ส่งออก CSV</button>
      <button class="btn primary" data-act="new">+ บันทึกเอง</button>
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
      q ? "ไม่พบบันทึกที่ค้นหา" : `ยังไม่มีผลที่บันทึกไว้${currentMonth ? "ในเดือน" + monthLabel(currentMonth) : ""}`);
  };
  const load = async () => {
    list = await api("GET", `/records?module=${m.key}${currentMonth ? "&month=" + currentMonth : ""}`);
    draw();
  };
  $("#q").oninput = draw;
  wireMonth(load);
  await load();
  return { new: () => openRecordForm(m), open: (id) => openRecord(id), csv: () => exportCsv(m, shown) };
}

function renalDrugsTab(drugs) {
  const dm = MOD.renal_drugs;
  const admin = me.role === "admin";
  $("#renal-body").innerHTML = `<div class="toolbar">
      <input type="search" id="q" placeholder="ค้นหาชื่อยา" value="${esc(renalDrugQuery)}">
      <button class="btn" data-act="dxlsx">ดาวน์โหลด Excel</button>
      ${admin ? `<button class="btn" data-act="dimport">นำเข้า Excel</button><button class="btn primary" data-act="dnew">+ เพิ่มยา</button>` : ""}
    </div>
    <p class="hint">ใช้ตรวจขนาดยาในแท็บ "ตรวจการสั่งยา" ช่วง 10-30 หมายถึง 10 ≤ ค่าไต &lt; 30
      ${admin ? "" : " · เพิ่มหรือแก้ไขตารางได้เฉพาะผู้ดูแลระบบ"}</p>
    <div class="list" id="list"></div>`;
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    renalDrugQuery = q;
    const shown = drugs.filter((d) => !q || `${d.name} ${d.aliases}`.toLowerCase().includes(q));
    $("#list").innerHTML = table(["ชื่อยา", "ตัววัด", "ช่วงค่าการทำงานของไตและคำแนะนำ", ""], shown.map((d) => [
      `<b>${esc(d.name)}</b>${d.aliases ? `<br><small class="muted">${esc(d.aliases)}</small>` : ""}${d.draft ? `<br>${badge("ร่าง รอตรวจสอบ", "warn")}` : ""}`,
      esc(d.measure),
      `<ul class="band-list">${d.bands.map((b) => `<li><span class="band-range">${esc(b.label)}</span>
        ${badge(RENAL_LEVEL[b.level][0], RENAL_LEVEL[b.level][1])} <span>${esc(b.text)}</span></li>`).join("")}</ul>
        ${d.errors.length ? `<p class="alert bad">${esc(d.errors.join(" · "))}</p>` : ""}`,
      actions(`${btn("open", "ดู", d.rec.id)}${admin ? btn("dedit", "แก้ไข", d.rec.id) : ""}`),
    ]), q ? "ไม่พบยาที่ค้นหา" : admin ? 'ยังไม่มีตารางยา กด "นำเข้า Excel" หรือ "+ เพิ่มยา"' : "ยังไม่มีตารางยา");
  };
  $("#q").oninput = draw;
  draw();
  return {
    open: (id) => openRecord(id),
    dnew: () => openRecordForm(dm, null, { measure: "CrCl", status: DRAFT }),
    dedit: (id) => openRecordForm(dm, drugs.find((d) => String(d.rec.id) === String(id))?.rec),
    dxlsx: () => downloadBlob(renalDrugsWorkbook(drugs), "ตารางยาปรับขนาดตามไต.xlsx"),
    dimport: () => importRenalDrugs(dm, drugs).catch((e) => toast(e.message, true)),
  };
}

const RENAL_DRUG_HEAD = ["ชื่อยา", "ชื่ออื่น/ชื่อการค้า", "ตัววัด", "ค่าต่ำสุด", "ค่าสูงสุด", "คำแนะนำ", "สถานะข้อมูล", "แหล่งอ้างอิง", "หมายเหตุ"];

// 1 แถว = 1 ช่วงค่าไต (รูปแบบเดียวกับที่นำเข้าได้)
function renalDrugsWorkbook(drugs) {
  const rows = [RENAL_DRUG_HEAD];
  for (const d of drugs) {
    d.bands.forEach((b, i) => rows.push([d.name, i ? "" : d.aliases, d.measure, b.range[0], b.range[1] ?? "", b.text,
      i ? "" : d.rec.data.status || "", i ? "" : d.rec.data.reference || "", i ? "" : d.rec.data.note || ""]));
  }
  return buildXlsx([
    { name: "ตารางยาปรับตามไต", rows, bold: new Set([0]), widths: [34, 24, 8, 10, 10, 50, 22, 24, 30] },
    { name: "วิธีกรอก", widths: [110], rows: [
      ["1 แถว = 1 ช่วงค่าการทำงานของไตของยา 1 ตัว ยาที่มีหลายช่วงให้ใส่ชื่อยาซ้ำหลายแถว (หรือเว้นชื่อยาว่างในแถวถัดไป)"],
      ["ค่าต่ำสุด–ค่าสูงสุด: 10 ถึง 30 = 10 ≤ ค่าไต < 30 · ค่าต่ำสุด 0 = ต่ำกว่าค่าสูงสุด · ค่าสูงสุดเว้นว่าง = ตั้งแต่ค่าต่ำสุดขึ้นไป"],
      ["ตัววัด: CrCl (ml/min) หรือ eGFR (ml/min/1.73 m²)"],
      ["คำแนะนำที่มีขนาดยา เช่น 100 mg/day, 500 mg q 24 hr, 30 mg BID, 15 mg/kg, 3 ครั้ง/สัปดาห์ ระบบใช้ตรวจขนาดยาและความถี่อัตโนมัติ"],
      ["คำว่า ห้ามใช้ / ไม่แนะนำให้ใช้ = แจ้งเตือนไม่เหมาะสม · ไม่ควรเริ่ม = ควรทบทวน · ไม่จำเป็นต้องปรับ = เหมาะสม"],
      ["สถานะข้อมูล: เว้นว่าง = ร่าง – รอเภสัชกรตรวจสอบ ใส่ ตรวจสอบแล้ว เมื่อเภสัชกรตรวจแล้ว"],
    ] },
  ]);
}

const RENAL_DRUG_COLUMNS = {
  name: ["ชื่อยา", "รายการยา", "drug", "drugname"],
  aliases: ["ชื่ออื่นชื่อการค้า", "ชื่ออื่น", "ชื่อการค้า", "aliases"],
  measure: ["ตัววัด", "ตัววัดการทำงานของไต", "measure"],
  min: ["ค่าต่ำสุด", "ต่ำสุด", "min"],
  max: ["ค่าสูงสุด", "สูงสุด", "max"],
  range: ["ช่วงค่าไต", "ช่วง", "range"],
  text: ["คำแนะนำ", "ขนาดยาที่แนะนำ", "การปรับขนาดยา", "recommendation"],
  status: ["สถานะข้อมูล", "สถานะ"],
  reference: ["แหล่งอ้างอิง", "อ้างอิง"],
  note: ["หมายเหตุ", "note"],
};

async function importRenalDrugs(dm, drugs) {
  const file = await pickFile(".xlsx,.csv");
  if (!file) return;
  const target = findHeader(await readSpreadsheet(file), RENAL_DRUG_COLUMNS,
    (c) => "name" in c && "text" in c && ("min" in c || "range" in c));
  if (!target) throw new Error("ไม่พบหัวตาราง ต้องมีคอลัมน์ ชื่อยา คำแนะนำ และ ค่าต่ำสุด/ค่าสูงสุด (หรือ ช่วง) ดาวน์โหลด Excel เพื่อดูรูปแบบ");
  const { sheet, head, cols } = target;
  const get = (row, k) => (k in cols ? cellText(row[cols[k]]) : "");
  const byName = new Map();
  const errors = [];
  let lastName = "";
  for (let i = head + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || [];
    const name = get(row, "name") || lastName;
    const text = get(row, "text");
    if (!name || !text) continue;
    lastName = name;
    let range = null;
    if (get(row, "range")) range = renalRange(get(row, "range"));
    else if (get(row, "min") !== "" || get(row, "max") !== "") {
      const lo = renalNum(get(row, "min") || 0);
      const hi = get(row, "max") ? renalNum(get(row, "max")) : null;
      if (lo != null && (hi != null || !get(row, "max"))) range = [lo, hi];
    }
    if (!range) { errors.push(`แถว ${i + 1} ${name}: อ่านช่วงค่าไตไม่ได้`); continue; }
    const key = uniqueKey(name);
    const d = byName.get(key) || { drug: name, aliases: "", measure: "", lines: [], status: "", reference: "", note: "" };
    d.aliases ||= get(row, "aliases");
    d.measure ||= /egfr/i.test(get(row, "measure")) ? "eGFR" : get(row, "measure") ? "CrCl" : "";
    d.status ||= get(row, "status");
    d.reference ||= get(row, "reference");
    d.note ||= get(row, "note");
    d.lines.push(`${rangeLabel(range[0], range[1])}: ${text}`);
    byName.set(key, d);
  }
  const existing = new Map(drugs.map((d) => [uniqueKey(d.name), d.rec]));
  const statusOf = (s) => (s === "ตรวจสอบแล้ว" ? s : DRAFT);
  const toAdd = [];
  const toUpdate = [];
  for (const d of byName.values()) {
    const bands = d.lines.join("\n");
    const problem = parseBands(bands).errors[0];
    if (problem) { errors.push(`${d.drug}: ${problem}`); continue; }
    const values = { drug: d.drug, aliases: d.aliases, measure: d.measure || "CrCl", bands, status: statusOf(d.status), reference: d.reference, note: d.note };
    const old = existing.get(uniqueKey(d.drug));
    if (!old) toAdd.push({ _row: d.drug, ...values });
    else if (["aliases", "measure", "bands", "reference", "note"].some((k) => String(old.data[k] || "") !== String(values[k] || "")) || old.data.status !== values.status) {
      toUpdate.push([old, { ...old.data, ...values, aliases: values.aliases || old.data.aliases || "", reference: values.reference || old.data.reference || "",
        note: values.note || old.data.note || "" }]);
    }
  }
  const same = byName.size - toAdd.length - toUpdate.length - errors.filter((e) => !e.startsWith("แถว")).length;
  const total = toAdd.length + toUpdate.length;
  const info = (label, value) => `<div><small>${label}</small><div>${value}</div></div>`;
  dlg.className = "wide";
  dlg.innerHTML = dialogShell("นำเข้าตารางยาปรับขนาดตามไต", `
    <p class="hint">${esc(file.name)} · ชีต ${esc(sheet.name)} · พบยา ${num(byName.size)} รายการ</p>
    <div class="info-grid">
      ${info("ยาใหม่", `<b>${num(toAdd.length)}</b> รายการ`)}
      ${info("แก้ไขยาเดิม", `<b>${num(toUpdate.length)}</b> รายการ`)}
      ${info("เหมือนเดิม (ข้าม)", `${num(Math.max(0, same))} รายการ`)}
      ${info("ข้อผิดพลาด (ข้าม)", `${num(errors.length)} รายการ`)}
    </div>
    <p class="alert warn">ยาที่ไม่ระบุสถานะ "ตรวจสอบแล้ว" ในไฟล์ จะเป็น "${DRAFT}" ต้องให้เภสัชกรตรวจก่อนใช้ตัดสินใจ</p>
    ${errors.length ? `<details open><summary>ดูข้อผิดพลาด</summary><ul class="history">${errors.slice(0, 50).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}`,
    total ? `นำเข้า ${num(total)} รายการ` : null, total ? "ยกเลิก" : "ปิด");
  wireDialog(async (_, form) => {
    const submit = $("button[type=submit]", form);
    if (toAdd.length) await api("POST", "/records/import", { module: dm.key, rows: toAdd });
    for (const [i, [old, values]] of toUpdate.entries()) {
      submit.textContent = `กำลังแก้ไข ${num(i + 1)} / ${num(toUpdate.length)}`;
      await api("PUT", `/records/${old.id}`, values);
    }
    toast(`นำเข้าแล้ว: ยาใหม่ ${num(toAdd.length)} · แก้ไข ${num(toUpdate.length)} รายการ`);
    refresh();
  });
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
  const menus = MODULES.filter((m) => !m.hidden && `${m.title} ${m.group}`.toLowerCase().includes(q));
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
  due: '<path d="M9 3h6v3H9z"/><path d="M7 4.5H5V21h14V4.5h-2"/><path d="M8 11h2M8 15h2M12.5 11h3.5M12.5 15h3.5"/>',
  adr: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8v5M12 16.5v.01"/>',
  med_error: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4M12 17v.01"/>',
  offhour_rx: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  counsel: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  medrec: '<path d="M9 3h6v3H9z"/><path d="M7 4.5H5V21h14V4.5h-2"/><path d="M8.5 13.5l2 2 4.5-4.5"/>',
  warfarin: '<path d="M12 3c3.5 4.5 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.5-6.5 6-11z"/>',
  copd: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  dm: '<path d="M15 3l6 6M18 6l-9.5 9.5-4-4L14 2M4.5 19.5l2-2M8 11l2 2M11 8l2 2"/>',
  stock_check: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  renal_check: '<path d="M10 4.5C8.7 3 4 3.2 4 9c0 5.5 2.3 10 5 10 2.3 0 2.8-2.5 1.6-4.4C9.5 13 9.5 11 11 9.6c1.3-1.2 0-3.6-1-5.1z"/><path d="M14 4.5c1.3-1.5 6-1.3 6 4.5 0 5.5-2.3 10-5 10-2.3 0-2.8-2.5-1.6-4.4 1.1-1.6 1.1-3.6-.4-5-1.3-1.2 0-3.6 1-5.1z"/>',
  purchase: '<path d="M3 4h2l2.5 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  duty: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  guidelines: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3M8 7h7M8 10.5h5"/>',
  drug_safety: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8.5v6M9 11.5h6"/>',
  formulary: '<rect x="3.5" y="8" width="17" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M9.2 9.2l5.6 5.6"/>',
  pharmacists: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-3-1.8-5.3-4.5-5.9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  patient: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
};
const GROUP_TONE = { "เอกสาร": "g4", "ความปลอดภัยด้านยา": "g0", "งานบริการผู้ป่วย": "g1", "คลินิก": "g2", "งานบริหาร": "g3", "ตั้งค่า": "g5" };
const toneOf = (group) => GROUP_TONE[group] || "g2";
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

// ตัวเลขบนการ์ดงาน: งานไม่มีวันที่นับทั้งหมด งานอื่นนับเดือนที่เลือก
// ถ้าเดือนที่เลือกยังไม่มีข้อมูล แสดงเดือนล่าสุดที่มีข้อมูลแทน พร้อมบอกเดือน
function modCardText(m, s) {
  let n = m.no_date ? s.totals?.[m.key] : s.counts[m.key];
  let note = m.no_date ? `(${m.count_unit || "รายการ"})` : "";
  const last = s.latest?.[m.key];
  if (!m.no_date && !n && last) {
    n = last.n;
    note = `(ข้อมูลล่าสุด ${monthLabel(last.month)})`;
  }
  return `<span><b>${num(n || 0)}</b><span>${esc(m.title)}${note ? ` <small>${esc(note)}</small>` : ""}</span></span>`;
}

async function dashboardView() {
  const s = await api("GET", `/summary${currentMonth ? "?month=" + currentMonth : ""}`);
  const groups = [];
  for (const m of MODULES.filter((x) => !x.hidden)) {
    if (groups.at(-1)?.[0] !== m.group) groups.push([m.group, []]);
    groups.at(-1)[1].push(m);
  }
  view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="hero-kicker">${longDate()}</p>
        <h1>${greeting()}, ${esc(me.full_name)}</h1>
        <p>งานเภสัชกรรมฯ โรงพยาบาลตาพระยา</p>
        <form class="hero-search" id="search-form">
          <input type="search" name="q" required placeholder="ค้นหาในระบบ เช่น HN ชื่อผู้ป่วย ชื่อยา" aria-label="ค้นหา" autocomplete="off">
          <button class="btn">ค้นหา</button>
        </form>
      </div>
      ${pillArt("hero-art")}
    </section>
    <div class="toolbar"><h2>สรุปเดือน${monthLabel(s.month)}</h2>${monthInput()}</div>
    ${groups.map(([g, mods]) => `<h3 class="group-title ${toneOf(g)}"><i></i>${esc(g)}</h3>
      <section class="mod-grid">${mods.map((m) => `<button type="button" class="mod-card ${toneOf(g)}" data-act="go" data-id="${m.key}">
        <span class="mod-icon">${icon(m.key)}</span>
        ${modCardText(m, s)}</button>`).join("")}</section>`).join("")}
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
      <p class="auth-title">Rx-TPY · งานเภสัชกรรมฯ</p>
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
  // งานที่มี hidden (เช่น ตารางยาปรับขนาดตามไต) ไม่แสดงในเมนู เข้าจากหน้าของงานที่ใช้ข้อมูลนั้น
  for (const m of MODULES) VIEWS[m.key] = { title: m.title, group: m.group, hidden: Boolean(m.hidden), render: () => moduleView(m) };
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
    if (v.group && v.group !== group) { group = v.group; html += `<div class="nav-group ${toneOf(group)}"><i></i>${esc(group)}</div>`; }
    html += `<button type="button" class="${v.group ? toneOf(v.group) : "g2"}" data-tab="${key}" ${key === tab ? 'aria-current="page"' : ""}>${esc(v.title)}</button>`;
  }
  $("#tabs").innerHTML = html;
  try {
    await VIEWS[tab].render();
    decorateTitle();
  } catch (e) {
    if (me) view.innerHTML = `<p class="form-error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</p>`;
  }
}

// โหลดหน้าปัจจุบันใหม่โดยไม่ปิดกล่องข้อความที่เปิดอยู่
// ใส่ไอคอนสีประจำกลุ่มหน้าชื่อหน้า (ทำหลังวาดหน้าทุกครั้ง)
function decorateTitle() {
  const h = $("#view > .toolbar h2");
  if (!h || h.querySelector(".title-icon") || current === "home") return;
  const tone = VIEWS[current]?.group ? toneOf(VIEWS[current].group) : "g2";
  h.insertAdjacentHTML("afterbegin", `<span class="title-icon ${tone}">${icon(current)}</span>`);
}

function refresh() {
  if (current && me) VIEWS[current].render().then(decorateTitle).catch((e) => toast(e.message, true));
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
