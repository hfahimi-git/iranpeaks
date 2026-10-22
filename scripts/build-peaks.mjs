#!/usr/bin/env node
/**
 * scripts/build-peaks.mjs
 *
 * data/peaks.db  →  public/data/peaks.json
 *
 * خروجی یک آرایهٔ تو در توست (ستون‌ها با ترتیب ثابت) تا هم حجم کمتری داشته باشد
 * هم مرورگر بدون هیچ کتابخانه‌ای (بدون wasm، بدون SQLite) جستجو کند:
 *
 *   [oid, name, ename, height, lat, lng, states, locations, folders]
 *
 * اجرا:   npm run peaks          (قبل از dev یا build، وقتی peaks.db عوض شده)
 *
 * این اسکریپت تنها جایی است که به sql.js نیاز دارد؛ بقیهٔ پروژه فقط JSON می‌خواند.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import initSqlJs from 'sql.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = join(ROOT, 'data/peaks.db');
const OUT_FILE = join(ROOT, 'public/data/peaks.json');

const COLUMNS = ['oid', 'name', 'ename', 'height', 'lat', 'lng', 'states', 'locations', 'folders'];

if (!existsSync(DB_FILE)) {
  console.error(`دیتابیس پیدا نشد: ${DB_FILE}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(DB_FILE));
const res = db.exec(`SELECT ${COLUMNS.join(', ')} FROM peak ORDER BY oid`);
db.close();

const values = res[0]?.values ?? [];
const body = JSON.stringify(values);
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, body);

console.log(
  `peaks.json: ${values.length} قله، ${COLUMNS.join(', ')}\n` +
    `  حجم: ${(statSync(OUT_FILE).size / 1024).toFixed(1)} KB خام / ` +
    `${(gzipSync(Buffer.from(body)).length / 1024).toFixed(1)} KB gzip`,
);
