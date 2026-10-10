// src/db/queries.ts

import { initDB } from './index';

export async function searchPeaks(query: string) {
  const db = await initDB();
  const stmt = db.prepare(`
    SELECT * FROM peak 
    WHERE name LIKE ? OR ename LIKE ? OR states LIKE ?
    ORDER BY height DESC
  `);
  const like = `%${query}%`;
  stmt.bind([like, like, like]);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export async function getPeaksByState(state: string) {
  const db = await initDB();
  const stmt = db.prepare(`
    SELECT * FROM peak 
    WHERE states LIKE ?
    ORDER BY height DESC
  `);
  stmt.bind([`%${state}%`]);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export async function searchStates(query: string) {
  const db = await initDB();
  const stmt = db.prepare(`
    SELECT DISTINCT states 
    FROM peak 
    WHERE states LIKE ? AND states IS NOT NULL AND states != ''
    ORDER BY states
  `);
  stmt.bind([`%${query}%`]);
  const results: string[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row.states) {
      results.push(String(row.states));
    }
  }
  stmt.free();
  return results;
}