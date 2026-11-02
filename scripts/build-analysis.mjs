#!/usr/bin/env node
/**
 * scripts/build-analysis.mjs
 *
 * تحلیل فایل‌های GPX و تولید فایل تحلیل + برنامه مربی‌گری برای هر مسیر
 * از منطق و توابع scripts/build-tracks.mjs استفاده می‌کند (بدون وابستگی جدید)
 *
 * اجرا: npm run analysis
 *       npm run analysis -- D:\gpx
 *
 * خروجی:
 *   public/tracks/analysis/<id>.json
 *   public/tracks/analysis/index.json
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GPX_DIR = resolve(process.argv[2] ?? join(ROOT, 'gpx'));
const OUT_DIR = join(ROOT, 'public/tracks/analysis');
const INDEX_FILE = join(OUT_DIR, 'index.json');

const RAD = Math.PI / 180;

function haversine(lat1, lng1, lat2, lng2) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lng2 - lng1) * RAD) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function pointToSegment(plat, plng, a, b) {
  const kx = 111320 * Math.cos(plat * RAD);
  const ky = 110540;
  const ax = (a.lng - plng) * kx,
    ay = (a.lat - plat) * ky;
  const bx = (b.lng - plng) * kx,
    by = (b.lat - plat) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

function lengthKm(segs) {
  let m = 0;
  for (const pts of segs) {
    for (let i = 0; i < pts.length - 1; i++) m += haversine(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
  }
  return m / 1000;
}

function climb(segs, threshold = 10) {
  let up = 0,
    down = 0;
  for (const pts of segs) {
    let anchor = null;
    for (const p of pts) {
      if (p.ele == null) continue;
      if (anchor == null) {
        anchor = p.ele;
        continue;
      }
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

function estimateDifficulty(gain, distanceKm, maxElev) {
  if (gain < 400 && distanceKm < 8) return 'آسان';
  if (gain < 900 && distanceKm < 15 && maxElev < 3200) return 'متوسط';
  if (gain < 1500 && maxElev < 4000) return 'سخت';
  return 'خیلی سخت';
}

/** وقتی GPX ارتفاع ندارد، سختی فقط از روی مسافت تخمین زده می‌شود */
function estimateDifficultyByDistance(distanceKm) {
  if (distanceKm < 8) return 'آسان';
  if (distanceKm < 15) return 'متوسط';
  if (distanceKm < 25) return 'سخت';
  return 'خیلی سخت';
}

/**
 * مدت‌زمان فقط وقتی قابل اعتماد است که با مسافت و ارتفاع‌پیمایی بخواند.
 * بعضی GPXها زمان‌های ساختگی (هر نقطه ۲۰ ثانیه) دارند و مسیر ۵ کیلومتری را ۲۰ دقیقه‌ای می‌کنند.
 */
function reliableDuration(spanMin, km, totalVert) {
  if (!(spanMin >= 10 && spanMin <= 48 * 60)) return null;
  const hours = spanMin / 60;
  if (km > 0) {
    const speed = km / hours;
    if (speed < 0.8 || speed > 8) return null;
  }
  if (totalVert / hours > 2500) return null;
  return +hours.toFixed(2);
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

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

function timesReliable(seg) {
  let ok = 0,
    n = 0;
  for (let i = 1; i < seg.length; i++) {
    if (seg[i - 1].t == null || seg[i].t == null) continue;
    n++;
    if (seg[i].t > seg[i - 1].t) ok++;
  }
  return n >= 3 && ok / n >= 0.8;
}

function isGap(a, b, useTime) {
  const d = haversine(a.lat, a.lng, b.lat, b.lng);
  if (useTime && a.t != null && b.t != null) {
    const dtMin = (b.t - a.t) / 60000;
    if (dtMin <= 0) return d >= 500;
    if (dtMin >= 60 && d >= 500) return true;
    return d >= 1000 && d / (dtMin * 60) > 40;
  }
  return d >= 3000;
}

function splitGaps(rawSegs) {
  const out = [];
  let breaks = Math.max(0, rawSegs.length - 1);
  for (const seg of rawSegs) {
    const useTime = timesReliable(seg);
    let cur = [seg[0]];
    for (let i = 1; i < seg.length; i++) {
      if (isGap(seg[i - 1], seg[i], useTime)) {
        out.push(cur);
        cur = [];
        breaks++;
      }
      cur.push(seg[i]);
    }
    out.push(cur);
  }
  return { segs: out.filter((seg) => seg.length >= 2), breaks };
}

function distToSeg(p, seg) {
  let best = Infinity;
  for (let i = 0; i < seg.length - 1; i++) best = Math.min(best, pointToSegment(p.lat, p.lng, seg[i], seg[i + 1]).d);
  return best;
}

function repeatsRoute(s, k) {
  const sf = s[0],
    sl = s[s.length - 1],
    kf = k[0],
    kl = k[k.length - 1];
  if (haversine(sf.lat, sf.lng, kf.lat, kf.lng) > 150) return false;
  if (haversine(sl.lat, sl.lng, kl.lat, kl.lng) > 150) return false;
  let near = 0;
  for (const p of s) if (distToSeg(p, k) <= 40) near++;
  return near / s.length >= 0.9;
}

function dedupeSegments(segs) {
  const kept = [];
  let dropped = 0;
  for (const seg of segs) {
    if (kept.some((k) => repeatsRoute(seg, k))) dropped++;
    else kept.push(seg);
  }
  return { segs: kept, dropped };
}

function parseGpx(xml, fallbackTitle) {
  const trkAt = xml.search(/<trk[\s>]/);
  const afterTrk = trkAt >= 0 ? xml.slice(trkAt) : xml;
  let title = decode(afterTrk.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
  if (!title.trim()) title = decode(xml.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
  title = title.replace(/^\s*Wikiloc\s*-\s*/i, '').replace(/\s+/g, ' ').trim() || fallbackTitle;

  const tag = xml.includes('<trkpt') ? 'trkpt' : 'rtept';
  const blocks = [...xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)].map((m) => m[1]);
  const segs = (blocks.length ? blocks : [xml]).map((text) => parsePoints(text, tag)).filter((seg) => seg.length);
  return { title, segs };
}

function generateCoachPlan(stats) {
  const { distanceKm, elevGain, elevLoss, maxElev, durationHours, difficulty } = stats;

  // اگر فایل در جهت نزول ثبت شده باشد، تلاش صعودی معادل همان نزول است
  const climbEffort = Math.max(elevGain, elevLoss);
  const reversed = elevLoss > elevGain * 1.2;
  const estimatedHours = durationHours ?? Math.max(4, +(distanceKm * 0.35 + climbEffort / 350).toFixed(1));

  let seasonAdvice = '';
  if (!maxElev) {
    seasonAdvice =
      'ارتفاع مسیر در فایل GPX ثبت نشده است؛ بهترین فصل را بر اساس ارتفاع قله و شرایط منطقه انتخاب کنید. بهار و پاییز معمولاً مطمئن‌ترین زمان‌ها هستند.';
  } else if (maxElev > 3800) {
    seasonAdvice = 'بهترین زمان: اواخر بهار تا اوایل پاییز. در زمستان فقط با تجهیزات کامل و تجربه بالا.';
  } else if (maxElev > 3000) {
    seasonAdvice = 'بهترین زمان: اردیبهشت تا آبان. در زمستان احتمال برف و یخ وجود دارد.';
  } else {
    seasonAdvice = 'تقریباً در تمام فصول قابل صعود است، اما بهار و پاییز ایده‌آل‌ترین زمان هستند.';
  }

  const gearBase = `- کفش کوهنوردی مناسب با مچ‌بندی خوب
- لباس لایه‌لایه (بیس‌لایه + لایه میانی + بادگیر/بارانی)
- کلاه، عینک آفتابی و ضدآفتاب قوی
- حداقل ۲٫۵ تا ۳ لیتر آب
- میان‌وعده پرکالری (آجیل، شکلات، میوه خشک)
- باتوم کوهنوردی (به شدت توصیه می‌شود)
- هدلامپ + پاوربانک
- جعبه کمک‌های اولیه شخصی + پتوی نجات
- نقشه آفلاین یا اپلیکیشن (OsmAnd / Locus) + فایل GPX`;

  const readiness =
    difficulty === 'آسان'
      ? 'مناسب برای کوه‌نوردان تازه‌کار با آمادگی پایه.'
      : difficulty === 'متوسط'
        ? 'نیاز به حداقل چند ماه تمرین منظم و تجربه ۲–۳ صعود متوسط دارد.'
        : 'فقط برای کوه‌نوردان با آمادگی بالا و تجربه صعودهای سنگین توصیه می‌شود.';

  return {
    bestSeason: seasonAdvice,
    estimatedTimeHours: estimatedHours,
    recordedReverse: reversed,
    climbEffortM: climbEffort,
    gear: gearBase
      .split('\n')
      .map((s) => s.replace(/^-\s*/, '').trim())
      .filter(Boolean),
    readiness,
    schedule: [
      { phase: 'حرکت از نقطه شروع', time: '۰۶:۰۰', notes: 'گرم کردن کامل بدن' },
      { phase: 'رسیدن به نیمه‌راه', time: '۰۸:۳۰ – ۰۹:۳۰', notes: 'ریتم ثابت و تنفس عمیق' },
      { phase: 'نزدیک قله', time: '۱۰:۳۰ – ۱۱:۳۰', notes: 'آخرین فشار، مراقبت از باد' },
      { phase: 'قله', time: '۱۱:۳۰–۱۲:۰۰', notes: '۱۵–۲۵ دقیقه استراحت و تغذیه' },
      { phase: 'شروع نزول', time: '۱۲:۱۵', notes: 'محافظت از زانوها' },
      { phase: 'رسیدن به پایان', time: '۱۵:۰۰ – ۱۶:۰۰', notes: '—' },
    ],
    nutrition: ['صبحانه کامل و سنگین قبل از حرکت', 'هر ۴۵–۶۰ دقیقه یک میان‌وعده کوچک', 'در قله یک وعده سبک اما انرژی‌زا مصرف کنید'],
    safetyTips: [
      'همیشه حداقل با یک نفر دیگر صعود کنید و مسیر و زمان بازگشت را به کسی اطلاع دهید.',
      'در نزول عجله نکنید؛ بیشتر آسیب‌ها در این بخش رخ می‌دهد.',
      'هر ۱۵–۲۰ دقیقه آب بنوشید (منتظر تشنگی نباشید).',
      'در صورت بروز علائم ارتفاع‌زدگی (سردرد شدید، تهوع، سرگیجه) فوراً نزول کنید.',
      'پیش‌بینی هوا را حتماً چک کنید. باد روی یال‌ها معمولاً شدید است.',
      'فایل GPX را روی گوشی یا گارمین داشته باشید.',
    ],
  };
}

if (!existsSync(GPX_DIR)) {
  console.error(`پوشه‌ی GPX پیدا نشد: ${GPX_DIR}\nفایل‌های gpx را در ./gpx بگذار یا مسیر پوشه را به‌عنوان آرگومان بده.`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) {
  if (/^[0-9a-f]{8}\.json$/.test(f)) rmSync(join(OUT_DIR, f));
}
rmSync(INDEX_FILE, { force: true });

const files = readdirSync(GPX_DIR)
  .filter((f) => /\.gpx$/i.test(f))
  .sort();
console.log(`${files.length} فایل GPX یافت شد`);

const results = [];
const seen = new Map(); // id → نام فایل (برای حذف فایل‌های کاملاً تکراری)
const duplicated = [];

for (const file of files) {
  try {
    const fullPath = join(GPX_DIR, file);
    const buf = readFileSync(fullPath);
    const id = createHash('sha1').update(buf).digest('hex').slice(0, 8);
    if (seen.has(id)) {
      duplicated.push(`${file} = ${seen.get(id)}`);
      continue;
    }
    seen.set(id, file);
    const parsed = parseGpx(buf.toString('utf8'), basename(file, '.gpx'));
    const { title, segs: rawSegs } = parsed;

    const split = splitGaps(rawSegs);
    const { segs } = dedupeSegments(split.segs);
    const pts = segs.flat();
    if (pts.length < 2) {
      console.warn(`⚠ ترک خالی: ${file}`);
      continue;
    }

    const withEle = pts.filter((p) => p.ele != null);
    const top = withEle.length
      ? withEle.reduce((a, b) => (b.ele > a.ele ? b : a))
      : pts.reduce((a, b) => (haversine(pts[0].lat, pts[0].lng, b.lat, b.lng) > haversine(pts[0].lat, pts[0].lng, a.lat, a.lng) ? b : a));

    const spanMin = segs.reduce((sum, seg) => {
      const ts = seg.map((p) => p.t).filter((v) => v != null);
      return sum + (ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 60000 : 0);
    }, 0);

    const km = lengthKm(segs);
    const { up, down } = climb(segs);
    const maxElev = withEle.length ? Math.round(top.ele) : 0;
    const minElev = withEle.length ? Math.round(Math.min(...withEle.map((p) => p.ele))) : 0;
    const hasElevation = withEle.length > 0;
    const climbEffort = Math.max(up, down);
    const durationHours = reliableDuration(spanMin, km, up + down);

    const stats = {
      id,
      name: title,
      distanceKm: +km.toFixed(2),
      elevGain: up,
      elevLoss: down,
      maxElev,
      minElev,
      hasElevation,
      durationHours,
      startLat: pts[0].lat != null ? +pts[0].lat.toFixed(6) : null,
      startLon: pts[0].lng != null ? +pts[0].lng.toFixed(6) : null,
      endLat: pts.at(-1).lat != null ? +pts.at(-1).lat.toFixed(6) : null,
      endLon: pts.at(-1).lng != null ? +pts.at(-1).lng.toFixed(6) : null,
      pointCount: pts.length,
      difficulty: hasElevation ? estimateDifficulty(climbEffort, km, maxElev) : estimateDifficultyByDistance(km),
      sourceFile: file,
      parsedAt: statSync(fullPath).mtime.toISOString(),
    };

    writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify({ stats, coach: generateCoachPlan(stats) }));

    results.push({
      id,
      name: stats.name,
      distanceKm: stats.distanceKm,
      elevGain: stats.elevGain,
      elevLoss: stats.elevLoss,
      maxElev: stats.maxElev,
      durationHours: stats.durationHours,
      difficulty: stats.difficulty,
      sourceFile: stats.sourceFile,
    });

    console.log(`✓ ${file} → ${id}.json`);
  } catch (err) {
    console.error(`✗ خطا در ${file}:`, err.message);
  }
}

results.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
writeFileSync(INDEX_FILE, JSON.stringify(results));
console.log(
  `\nتمام شد. ${results.length} فایل تحلیل تولید شد.${duplicated.length ? ` (${duplicated.length} فایل تکراری نادیده گرفته شد)` : ''}\nخروجی: ${OUT_DIR}\nفهرست: ${INDEX_FILE}`,
);
