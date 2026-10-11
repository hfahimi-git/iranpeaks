// src/db/index.ts
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url';

let db: Database | null = null;

export async function initDB() {
  if (db) {
    return db;
  }

  const SQL = await initSqlJs({
    locateFile: () => sqlWasm
  });

  const response = await fetch(`${import.meta.env.BASE_URL}data/peaks.db`);
  if (!response.ok) {
    throw new Error('فایل data/peaks.db پیدا نشد');
  }

  const buffer = await response.arrayBuffer();
  db = new SQL.Database(new Uint8Array(buffer));

  console.log('دیتابیس peaks.db با موفقیت لود شد');
  return db;
}