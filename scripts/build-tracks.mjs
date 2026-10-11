#!/usr/bin/env node
/**
 * scripts/build-tracks.mjs
 *
 * GPX → فایل‌های سبک JSON + تطبیق خودکار هر ترک با قله‌های peaks.db
 *
 * اجرا:   npm run tracks            (پوشه‌ی پیش‌فرض: ./gpx)
 *         npm run tracks -- D:\gpx  (پوشه‌ی دلخواه)
 *
 * خروجی‌ها:
 *   public/tracks/<id>.json    مسیر ساده‌شده (فقط ترک‌هایی که به قله وصل شدند)
 *   public/tracks/index.json   فهرست: کدام قله چه مسیرهایی دارد + متادیتا
 *   reports/tracks-review.csv  موارد مشکوک برای بررسی دستی
 *   reports/new-peaks.csv      قله‌هایی که در دیتابیس نیستند (نام + lat/lng + ارتفاع)
 *
 * اصلاح دستی: scripts/track-overrides.json
 *   { "نام-فایل.gpx": [1904, 1905], "id-هشت-حرفی": [] }
 *   (آرایه‌ی خالی = این ترک به هیچ قله‌ای وصل نشود)
 *
 * هیچ وابستگی جدیدی لازم نیست؛ دیتابیس با sql.js (که از قبل در پروژه هست) خوانده می‌شود.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GPX_DIR = resolve(process.argv[2] ?? join(ROOT, 'gpx'));
const DB_FILE = join(ROOT, 'public/data/peaks.db');
const OUT_DIR = join(ROOT, 'public/tracks');
const REPORT_DIR = join(ROOT, 'reports');
const OVERRIDES_FILE = join(ROOT, 'scripts/track-overrides.json');

// آستانه‌ها (بر اساس نمونه‌های واقعی تنظیم شده؛ هر وقت لازم شد عوض کن)
const CFG = {
  matchDistM: 150,      // سطح A: حداکثر فاصله‌ی قله تا مسیر
  matchDeltaH: 150,     // سطح A: حداکثر اختلاف ارتفاع قله و ارتفاع ترک در نزدیک‌ترین نقطه
  reviewTopDistM: 4000, // سطح B: حداکثر فاصله‌ی بالاترین نقطه‌ی ترک تا قله (با تطابق اسم)
  reviewDeltaH: 150,    // سطح B: حداکثر اختلاف ارتفاع
  simplifyM: 8,         // تلورانس ساده‌سازی (متر)
  mergeNewPeakM: 300,   // ادغام کاندیداهای قله‌ی جدید که به هم نزدیک‌اند
  // وقفه‌ی ضبط: به‌جای وصل کردن دو سرِ وقفه با خط صاف، مسیر دو تکه می‌شود
  gapMinutes: 60,          // توقف ضبط حداقل این‌قدر + جابه‌جایی بیش از gapAfterPauseM
  gapAfterPauseM: 500,
  gapMaxSpeedMs: 40,       // جهش با سرعت غیرممکن (۱۴۴ km/h) بیش از ۱ کیلومتر
  gapNoTimeM: 3000,        // اگر زمان ندارد: جهش بیش از ۳ کیلومتر
};

// ───────────────────────── هندسه ─────────────────────────
const RAD = Math.PI / 180;

function haversine(lat1, lng1, lat2, lng2) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lng2 - lng1) * RAD) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** فاصله‌ی نقطه تا پاره‌خط a-b (متر) با تصویر محلی تخت؛ t = موقعیت نزدیک‌ترین نقطه روی پاره‌خط */
function pointToSegment(plat, plng, a, b) {
  const kx = 111320 * Math.cos(plat * RAD);
  const ky = 110540;
  const ax = (a.lng - plng) * kx, ay = (a.lat - plat) * ky;
  const bx = (b.lng - plng) * kx, by = (b.lat - plat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** کمترین فاصله‌ی قله تا کل مسیر + ارتفاع درون‌یابی‌شده‌ی مسیر در همان نقطه */
function nearestOnTrack(peak, segs) {
  let best = { d: Infinity, ele: null };
  for (const pts of segs) {
    for (let i = 0; i < pts.length - 1; i++) {
      const { d, t } = pointToSegment(peak.lat, peak.lng, pts[i], pts[i + 1]);
      if (d < best.d) {
        const e1 = pts[i].ele, e2 = pts[i + 1].ele;
        best = { d, ele: e1 != null && e2 != null ? e1 + t * (e2 - e1) : (e1 ?? e2) };
      }
    }
  }
  return best;
}

/** Douglas–Peucker (غیربازگشتی) */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const { d } = pointToSegment(pts[i].lat, pts[i].lng, pts[s], pts[e]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (idx !== -1 && dmax > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function lengthKm(segs) {
  let m = 0;
  for (const pts of segs) {
    for (let i = 0; i < pts.length - 1; i++) m += haversine(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
  }
  return m / 1000;
}

/** صعود و فرود تجمعی با هیسترزیس (نویز ارتفاع GPS را حذف می‌کند) */
function climb(segs, threshold = 10) {
  let up = 0, down = 0;
  for (const pts of segs) {
    let anchor = null; // هر تکه از نو شروع می‌شود؛ پرش بین تکه‌ها صعود/فرود حساب نمی‌شود
    for (const p of pts) {
      if (p.ele == null) continue;
      if (anchor == null) { anchor = p.ele; continue; }
      const diff = p.ele - anchor;
      if (Math.abs(diff) >= threshold) {
        if (diff > 0) up += diff;
        else down -= diff;
        anchor = p.ele;
      }
    }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

// ───────────────────────── متن ─────────────────────────
const fix = (s) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();

/** نرمال‌سازی برای مقایسه‌ی نام‌ها */
function norm(s) {
  return fix(s.normalize('NFKC'))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function titleHasName(normTitle, name) {
  const n = norm(name ?? '');
  return n.length >= 2 && ` ${normTitle} `.includes(` ${n} `);
}

function suggestName(title) {
  const t = fix(title).replace(/\([^)]*\)/g, ' ');
  const m = t.match(/قله(?:\s+ی)?\s+([^،,\-–—|/]+)/);
  let name = m ? m[1].split(/\s+(?:از|به|تا|و)\s+/)[0] : t.split(/[،,\-–—|/]/)[0];
  return name.replace(/\s+/g, ' ').trim();
}

const PEAK_WORDS = /قله|peak|summit/i;
const NOT_PEAK_WORDS = /دره|آبشار|valley|waterfall|جنگل|forest|چشمه|روستا/i;
const likelyPeak = (title) => PEAK_WORDS.test(title) || (/کوه/.test(title) && !NOT_PEAK_WORDS.test(title));

// ───────────────────────── GPX ─────────────────────────
const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** لینک منبع قابل‌نمایش؛ garmin عمداً لینک داده نمی‌شود و لینک پروفایل کاربران هم منبع نیست */
function okSource(href) {
  try {
    const u = new URL(href);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    if (/(^|\.)garmin\./i.test(u.hostname)) return undefined;
    if (/user\.do$/i.test(u.pathname)) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

function parsePoints(text, tag) {
  const pts = [];
  for (const chunk of text.split(`<${tag}`).slice(1)) {
    const lat = Number(chunk.match(/\blat=["']([-+\d.]+)["']/)?.[1]);
    const lng = Number(chunk.match(/\blon=["']([-+\d.]+)["']/)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleRaw = chunk.match(/<ele>\s*([-+\d.eE]+)\s*<\/ele>/)?.[1];
    const ele = eleRaw == null ? null : Number(eleRaw);
    const t = Date.parse(chunk.match(/<time>\s*([^<\s]+)\s*<\/time>/)?.[1] ?? '');
    pts.push({ lat, lng, ele: Number.isFinite(ele) ? ele : null, t: Number.isFinite(t) ? t : null });
  }
  return pts;
}

/** آیا بین دو نقطه‌ی پیاپی وقفه‌ی ضبط هست؟ (آن‌وقت خط صافِ بینشان رسم نمی‌شود) */
function isGap(a, b) {
  const d = haversine(a.lat, a.lng, b.lat, b.lng);
  if (a.t != null && b.t != null) {
    const dtMin = (b.t - a.t) / 60000;
    if (dtMin >= CFG.gapMinutes && d >= CFG.gapAfterPauseM) return true;
    return dtMin > 0 && d >= 1000 && d / (dtMin * 60) > CFG.gapMaxSpeedMs;
  }
  return d >= CFG.gapNoTimeM;
}

function splitGaps(rawSegs) {
  const out = [];
  let breaks = Math.max(0, rawSegs.length - 1);
  for (const seg of rawSegs) {
    let cur = [seg[0]];
    for (let i = 1; i < seg.length; i++) {
      if (isGap(seg[i - 1], seg[i])) { out.push(cur); cur = []; breaks++; }
      cur.push(seg[i]);
    }
    out.push(cur);
  }
  return { segs: out.filter((seg) => seg.length >= 2), breaks };
}

function parseGpx(xml, fallbackTitle) {
  const trkAt = xml.search(/<trk[\s>]/);
  const afterTrk = trkAt >= 0 ? xml.slice(trkAt) : xml;
  let title = decode(afterTrk.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
  if (!title.trim()) title = decode(xml.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
  title = title.replace(/^\s*Wikiloc\s*-\s*/i, '').replace(/\s+/g, ' ').trim() || fallbackTitle;

  // فقط بخش metadata (قبل از <trk>) را می‌خوانیم
  const metaEnd = xml.search(/<trk[\s>]/);
  const meta = metaEnd >= 0 ? xml.slice(0, metaEnd) : xml;
  const by = decode(meta.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1] ?? '').replace(/\s+/g, ' ').trim() || undefined;
  // لینک داخل <author> پروفایل نویسنده است، نه منبع مسیر
  const href = decode(meta.replace(/<author>[\s\S]*?<\/author>/g, '').match(/<link\s+[^>]*href=["']([^"']+)["']/)?.[1] ?? '');
  const src = okSource(href);

  // هر <trkseg> یک تکه است (اگر نبود، کل فایل یک تکه)
  const tag = xml.includes('<trkpt') ? 'trkpt' : 'rtept';
  const blocks = [...xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)].map((m) => m[1]);
  const segs = (blocks.length ? blocks : [xml]).map((text) => parsePoints(text, tag)).filter((seg) => seg.length);
  return { title, src, by, segs };
}

// ───────────────────────── CSV ─────────────────────────
const csv = (rows) =>
  '\uFEFF' +
  rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? '' : String(c);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n') +
  '\r\n';

// ───────────────────────── اجرا ─────────────────────────
if (!existsSync(GPX_DIR)) {
  console.error(`پوشه‌ی GPX پیدا نشد: ${GPX_DIR}\nفایل‌های gpx را در ./gpx بگذار یا مسیر پوشه را به‌عنوان آرگومان بده.`);
  process.exit(1);
}

const SQL = await initSqlJs();
const sdb = new SQL.Database(readFileSync(DB_FILE));
const peaks = (sdb.exec('SELECT oid, name, ename, height, lat, lng FROM peak WHERE lat IS NOT NULL AND lng IS NOT NULL')[0]?.values ?? [])
  .map(([oid, name, ename, height, lat, lng]) => ({ oid, name: name ?? '', ename: ename ?? '', height, lat, lng }));
const peakByOid = new Map(peaks.map((p) => [p.oid, p]));
sdb.close();

const overrides = existsSync(OVERRIDES_FILE) ? JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')) : {};

const files = readdirSync(GPX_DIR).filter((f) => /\.gpx$/i.test(f)).sort();
console.log(`${files.length} فایل GPX، ${peaks.length} قله در دیتابیس`);

const tracks = [];
const seen = new Map();
const dupes = [];
const reviewSeen = new Set();
const reviewRows = [['status', 'file', 'title', 'peak_oid', 'peak_name', 'peak_height', 'dist_m', 'track_ele_m', 'delta_h_m', 'reason']];

for (const file of files) {
  const buf = readFileSync(join(GPX_DIR, file));
  const id = createHash('sha1').update(buf).digest('hex').slice(0, 8);
  if (seen.has(id)) { dupes.push(`${file} = ${seen.get(id)}`); continue; }
  seen.set(id, file);

  const parsed = parseGpx(buf.toString('utf8'), basename(file, '.gpx'));
  const { title, src, by } = parsed;
  const { segs, breaks } = splitGaps(parsed.segs);
  const pts = segs.flat();
  if (pts.length < 2) { console.warn(`⚠ ترک خالی: ${file}`); continue; }

  const withEle = pts.filter((p) => p.ele != null);
  const top = withEle.length
    ? withEle.reduce((a, b) => (b.ele > a.ele ? b : a))
    : pts.reduce((a, b) => (haversine(pts[0].lat, pts[0].lng, b.lat, b.lng) > haversine(pts[0].lat, pts[0].lng, a.lat, a.lng) ? b : a));

  const times = pts.map((p) => p.t).filter((v) => v != null);
  // مدت = مجموع بازه‌ی هر تکه (شب‌ماندن و وقفه‌ها شمرده نمی‌شوند)
  const spanMin = segs.reduce((sum, seg) => {
    const ts = seg.map((p) => p.t).filter((v) => v != null);
    return sum + (ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 60000 : 0);
  }, 0);
  const t = {
    id, file, title, src, by, pts, segs, breaks, top,
    km: lengthKm(segs),
    ...climb(segs),                                                   // up, down
    max: withEle.length ? Math.round(top.ele) : null,
    min: withEle.length ? Math.round(Math.min(...withEle.map((p) => p.ele))) : null,
    loop: haversine(pts[0].lat, pts[0].lng, pts.at(-1).lat, pts.at(-1).lng) <= 200,
    ts: times.length ? Math.round(Math.min(...times) / 1000) : null,   // زمان اولین نقطه (epoch ثانیه)
    dur: spanMin >= 10 && spanMin <= 48 * 60 ? Math.round(spanMin) : null, // دقیقه؛ بازه‌های نامعقول حذف می‌شوند
    A: [], status: 'unmatched', reviewed: false,
  };
  const addReview = (status, peak, d, ele, dh, reason) => {
    const key = `${file}|${peak.oid}`;
    if (reviewSeen.has(key)) return;
    reviewSeen.add(key);
    t.reviewed = true;
    reviewRows.push([status, file, title, peak.oid, peak.name, peak.height, Math.round(d), ele == null ? '' : Math.round(ele), dh == null ? '' : Math.round(dh), reason]);
  };

  // ── سطح A: قله‌ی نزدیک به مسیر با ارتفاع سازگار
  const pad = 0.003;
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const box = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  for (const peak of peaks) {
    if (peak.lat < box[0] || peak.lat > box[1] || peak.lng < box[2] || peak.lng > box[3]) continue;
    const { d, ele } = nearestOnTrack(peak, segs);
    if (d > CFG.matchDistM) continue;
    const dh = ele != null && peak.height != null ? Math.abs(peak.height - ele) : null;
    if (dh == null) addReview('review', peak, d, ele, dh, 'ارتفاع در GPX یا دیتابیس نیست');
    else if (dh <= CFG.matchDeltaH) t.A.push(peak.oid);
    else addReview('rejected', peak, d, ele, dh, 'نزدیک است ولی ارتفاع نمی‌خواند (احتمالاً ترک به قله نرسیده)');
  }

  // ── سطح B: اسم یک قله‌ی موجود در عنوان ترک هست، ولی هندسه به‌تنهایی قطعی نیست → بررسی دستی
  if (t.A.length === 0 && t.max != null) {
    const nt = norm(title);
    for (const peak of peaks) {
      const names = [peak.name, peak.name.split(/\s+[-–]\s+/)[0], peak.ename];
      if (!names.some((n) => titleHasName(nt, n))) continue;
      const d = haversine(top.lat, top.lng, peak.lat, peak.lng);
      if (d > CFG.reviewTopDistM) continue;
      const dh = peak.height == null ? null : Math.abs(peak.height - top.ele);
      addReview('review', peak, d, t.max, dh, dh != null && dh <= CFG.reviewDeltaH
        ? 'اسم قله در عنوان هست و بالاترین نقطه‌ی ترک نزدیک و هم‌ارتفاع است'
        : 'اسم قله در عنوان هست ولی ارتفاع نمی‌خواند (ترک به قله نرسیده؟)');
    }
  }

  // ── اصلاح دستی
  const ov = overrides[file] ?? overrides[id];
  if (Array.isArray(ov)) {
    t.A = ov.filter((oid) => {
      if (peakByOid.has(oid)) return true;
      console.warn(`⚠ override: قله‌ی ${oid} در دیتابیس نیست (${file})`);
      return false;
    });
    t.status = t.A.length ? 'manual' : 'excluded';
  } else if (t.A.length) {
    t.status = 'auto';
  }
  tracks.push(t);
}

// ───────────── خروجی مسیرها ─────────────
mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (/^([0-9a-f]{8}|index)\.json$/.test(f)) rmSync(join(OUT_DIR, f));

const index = { v: 1, peaks: {}, tracks: {} };
let totalBytes = 0;
for (const t of tracks.filter((x) => x.A.length)) {
  const out = t.segs.map((seg) =>
    simplify(seg, CFG.simplifyM).map((q) => {
      const r = [Number(q.lat.toFixed(5)), Number(q.lng.toFixed(5))];
      if (q.ele != null) r.push(Math.round(q.ele));
      return r;
    }),
  );
  const body = JSON.stringify({ id: t.id, n: t.title, s: out });
  writeFileSync(join(OUT_DIR, `${t.id}.json`), body);
  totalBytes += Buffer.byteLength(body);

  index.tracks[t.id] = {
    n: t.title,
    km: Number(t.km.toFixed(1)),
    up: t.up,
    down: t.down,
    ...(t.max != null && { max: t.max }),
    ...(t.min != null && { min: t.min }),
    ...(t.loop && { loop: true }),
    ...(t.ts != null && { ts: t.ts }),
    ...(t.dur != null && { dur: t.dur }),
    ...(t.by && { by: t.by }),
    ...(t.src && { src: t.src }),
  };
  for (const oid of t.A) (index.peaks[oid] ??= []).push(t.id);
}
for (const ids of Object.values(index.peaks)) ids.sort((a, b) => index.tracks[a].n.localeCompare(index.tracks[b].n, 'fa'));
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index));

// ───────────── قله‌های جدید (در دیتابیس نیستند) ─────────────
const candidates = tracks
  .filter((t) => t.status === 'unmatched' && !t.reviewed)
  .map((t) => {
    const near = peaks.reduce((b, p) => {
      const d = haversine(t.top.lat, t.top.lng, p.lat, p.lng);
      return d < b.d ? { d, p } : b;
    }, { d: Infinity, p: null });
    return { t, near };
  })
  .sort((a, b) => (b.t.max ?? 0) - (a.t.max ?? 0));

const clusters = [];
for (const c of candidates) {
  const hit = clusters.find((k) => haversine(k.lead.t.top.lat, k.lead.t.top.lng, c.t.top.lat, c.t.top.lng) <= CFG.mergeNewPeakM);
  if (hit) hit.items.push(c);
  else clusters.push({ lead: c, items: [c] });
}
clusters.sort((a, b) => Number(likelyPeak(b.items[0].t.title)) - Number(likelyPeak(a.items[0].t.title)) || (b.lead.t.max ?? 0) - (a.lead.t.max ?? 0));

const newRows = [['suggested_name', 'ename', 'height', 'lat', 'lng', 'likely_peak', 'tracks', 'track_titles', 'source_files', 'nearest_db_peak', 'nearest_db_peak_height', 'nearest_db_peak_km']];
for (const k of clusters) {
  const { t, near } = k.lead;
  newRows.push([
    suggestName(t.title), '', t.max ?? '', t.top.lat.toFixed(6), t.top.lng.toFixed(6),
    k.items.some((i) => likelyPeak(i.t.title)) ? 'yes' : 'no',
    k.items.length,
    k.items.map((i) => i.t.title).join(' | '),
    k.items.map((i) => i.t.file).join(' | '),
    near.p?.name ?? '', near.p?.height ?? '', near.p ? (near.d / 1000).toFixed(1) : '',
  ]);
}

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(join(REPORT_DIR, 'tracks-review.csv'), csv(reviewRows));
writeFileSync(join(REPORT_DIR, 'new-peaks.csv'), csv(newRows));

// ───────────── خلاصه ─────────────
const n = (s) => tracks.filter((t) => t.status === s).length;
console.log(`
ترک یکتا: ${tracks.length}${dupes.length ? `  (تکراری حذف‌شده: ${dupes.length})` : ''}
  وصل‌شده خودکار : ${n('auto')}
  وصل‌شده دستی  : ${n('manual')}
  کنار گذاشته    : ${n('excluded')}
  بدون قله       : ${n('unmatched')}  → ${clusters.length} کاندیدای قله‌ی جدید (بقیه در فایل بررسی)
نیازمند بررسی   : ${reviewRows.length - 1} ردیف در reports/tracks-review.csv
حجم خروجی       : ${(totalBytes / 1024).toFixed(1)} KB  (${Object.keys(index.tracks).length} فایل مسیر)
`);
for (const d of dupes) console.log('  تکراری:', d);
const broken = tracks.filter((t) => t.breaks > 0);
if (broken.length) {
  console.log(`مسیرهای دارای وقفه/چند تکه (خط صاف بینشان رسم نمی‌شود): ${broken.length}`);
  for (const t of broken.slice(0, 25)) console.log(`  ${t.breaks} وقفه  ${t.file}`);
}
