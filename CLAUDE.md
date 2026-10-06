# CLAUDE.md — คู่มือสำหรับ AI ที่ทำงานต่อในโปรเจกต์นี้

## ระบบนี้คืออะไร

**Rx-TPY** คือระบบบันทึกงานบริการเภสัชกรรมของ **โรงพยาบาลตาพระยา** ผู้ใช้เป็นเภสัชกรเท่านั้น ใช้ภายในวงแลน หน้าจอเป็นภาษาไทยทั้งหมด **ไม่ใช่ระบบเบิกของ**

เป็นโปรเจกต์แยกที่ตั้งต้นจากโค้ดระบบเบิกพัสดุ (`C:\Users\NB-BackUP1\Downloads\Inventory-main`) **ห้ามแก้ไข ลบ หรือ deploy อะไรที่เกี่ยวกับระบบพัสดุหรือเว็บ store.tpy-inventory.com จากงานนี้**

ผู้ดูแลโปรเจกต์สื่อสารเป็นภาษาไทย ให้ตอบเป็นภาษาไทย และ**ถามก่อนทุกครั้งก่อน commit หรือ push** ("เซฟงาน" = commit)

## โครงสร้าง

```
src/worker.js  API บน Cloudflare Workers + D1 — ตัวที่ใช้งานจริงที่ rx.tpy-inventory.com
wrangler.jsonc ตั้งค่า Cloudflare (D1, โดเมน, ปิด workers.dev)
server.py      API เดียวกันแบบ Python + SQLite สำหรับรันในเครื่อง (standard library เท่านั้น)
modules.json   นิยามงานทั้งหมด ใช้ร่วมกันทั้ง worker.js และ server.py
static/        หน้าเว็บ: index.html, app.js, style.css, _headers (ไม่มี build step)
tools/         worker_dev.py + worker_harness.js ทดสอบ worker.js ในเบราว์เซอร์โดยไม่ต้องมี Node.js
run.bat        ดับเบิลคลิกเพื่อรันเวอร์ชัน Python บน Windows
data/          ฐานข้อมูล SQLite ในเครื่อง มีข้อมูลผู้ป่วย (อยู่ใน .gitignore ห้าม commit)
```

## Cloudflare

- Deploy ผ่าน Workers Builds: push ขึ้น GitHub แล้ว Cloudflare รัน `npx wrangler deploy` เอง เครื่องนี้ไม่มี Node.js
- **API มีสองชุด (worker.js และ server.py) ต้องแก้ให้ตรงกันทุกครั้ง** ฝั่ง Cloudflare คือตัวจริง
- D1 ไม่มี transaction แบบ BEGIN ใช้ `db.batch([...])` เมื่อต้องเขียนหลายคำสั่งพร้อมกัน
- Workers ใช้เวลา UTC ให้ใช้ `now()` / `today()` ใน worker.js ซึ่งแปลงเป็นเวลาไทยแล้ว
- PBKDF2 บน Workers ได้สูงสุด 100,000 รอบ
- ตารางสร้างอัตโนมัติด้วย `ensureSchema()` ถ้าเพิ่มคอลัมน์ต้องเขียน `ALTER TABLE` แบบรันซ้ำได้ทั้งสองฝั่ง
- เว็บอยู่หลัง Cloudflare Access ห้ามเปิด `workers_dev` หรือ `preview_urls` เพราะจะเข้าได้โดยไม่ผ่าน Access
- ทดสอบ worker.js: ตั้ง `RX_TEST_DB` เป็นไฟล์ชั่วคราว รัน `python tools/worker_dev.py` แล้วเปิด http://127.0.0.1:8769 (เปิด `TEST_MODE` ใน env จำลองเท่านั้น ห้ามตั้งบน Cloudflare)

## หัวใจของระบบ: modules.json

ทุกงาน (ADR, คลินิก, ตารางเวร ฯลฯ) นิยามไว้ใน `modules.json` ที่เดียว
- ข้อมูลทุกงานเก็บในตาราง `records` ช่องร่วม (`record_date`, `hn`, `patient_name`) เป็นคอลัมน์ ช่องเฉพาะงานเก็บใน `data` (JSON)
- เซิร์ฟเวอร์ตรวจค่าตามนิยาม (`clean_field` / `cleanField`) หน้าเว็บสร้างฟอร์ม ตาราง สรุป และ CSV จาก `/api/modules`
- **เพิ่มหรือแก้ช่องข้อมูล = แก้ `modules.json` อย่างเดียว** ไม่ต้องแก้ตารางฐานข้อมูล ห้ามเปลี่ยน `name` ของช่องเดิมที่มีข้อมูลแล้ว (ข้อมูลเก่าจะหาย) ให้เปลี่ยนได้แค่ `label`
- ถ้าลบตัวเลือกออกจาก `options` บันทึกเก่าที่ใช้ตัวเลือกนั้นจะแก้ไขไม่ผ่านการตรวจ ให้คงไว้หรือทำ migration
- type: `text`, `textarea`, `number`, `date`, `select`, `multi`, `staff` / คีย์อื่น: `patient`, `patient_optional`, `list`, `stats`, `sums`, `rate`, `view: "calendar"`
- นัดหมายในหน้าแรกอ่านจากช่องชื่อ `next_visit` ของบันทึกล่าสุดต่อ (งาน, HN)
- ประวัติแพ้ยาที่เตือนตาม HN มาจากงาน `adr` ช่อง `drug`
- `view: "offhour"` = หน้าวิเคราะห์ของงานตรวจใบสั่งยานอกเวลา (`offhourView` ใน app.js) ส่วน `view: "calendar"` = ตารางเวร
- นำเข้าหลายแถว: `POST /api/records/import` (ไม่เกิน 500 แถวต่อครั้ง ผิดแถวเดียวไม่บันทึกทั้งชุด) หน้าเว็บส่งทีละ 200 แถว
  ฝั่ง Worker ต้องใช้ `json_each` คำสั่งเดียว เพราะ D1 จำกัดจำนวนคำสั่งต่อครั้งและพารามิเตอร์ต่อคำสั่ง
- `no_date: true` = งานที่ไม่มีวันที่ (บัญชียา) เซิร์ฟเวอร์ใส่ record_date เป็นวันที่บันทึกเอง และ Dashboard นับรวมทั้งหมด (`totals`)
- `replace_by: "fiscal_year"` = นำเข้าแบบแทนที่ได้ (`replace` ใน body ของ /records/import, เฉพาะ admin) ลบแบบซ่อนรายการเดิมที่ค่าตรงกันก่อนนำเข้าในทรานแซกชันเดียว
- อ่าน .xlsx ในเบราว์เซอร์เอง (`readXlsx` แตก zip ด้วย DecompressionStream) ไม่ใช้ไลบรารี การจับคู่คอลัมน์ Excel อยู่ที่ `mapOffhourSheets`

## รันและทดสอบ

```bash
python server.py --open                                  # http://127.0.0.1:8100
$env:RX_DB="$env:TEMP\rx-test.db"; $env:PORT="8766"; python server.py   # ทดสอบด้วยฐานข้อมูลแยก
```

- Python อยู่ที่ `%LOCALAPPDATA%\Programs\Python\Python312\python.exe` Git อยู่ที่ `C:\Program Files\Git\cmd\git.exe`
- **ห้ามทดสอบกับ `data/rx.db`** เพราะเป็นข้อมูลผู้ป่วยจริง
- พอร์ต 8100 และคุกกี้ `rx_tpy_session` ตั้งให้ต่างจากระบบพัสดุ (8000, `tpy_session`) เพราะคุกกี้ไม่แยกตามพอร์ต

## สิทธิ์และความปลอดภัย

- `admin` (ผู้ดูแลระบบ) และ `pharmacist` (เภสัชกร) กำหนดสิทธิ์ API ที่ `route(method, pattern, handler, access)`
- เภสัชกรแก้ไขได้เฉพาะบันทึกของตัวเอง (`can_edit`) ลบได้เฉพาะ admin และลบแบบซ่อน (`deleted_at`)
- ทุกการสร้าง แก้ไข และลบ ต้องเรียก `log_record()` เพื่อเก็บลง `record_log`
- คำขอที่ไม่ใช่ GET ต้องเป็น `Content-Type: application/json` ห้ามเอาออก
- ใส่ข้อความลง HTML ผ่าน `esc()` ทุกครั้ง

## แนวทางเขียนโค้ด

- ไม่ใช้ไลบรารีภายนอก ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย วันที่แสดงเป็น พ.ศ. ผ่าน `when()`
- สีอยู่ในตัวแปร CSS ใน `:root` พร้อมโหมดมืด ต้องใช้บนมือถือ 375px ได้โดยไม่เลื่อนแนวนอน
- เพิ่มคอลัมน์ในตารางต้องเขียน migration (`ALTER TABLE` ใน `init_db`)
