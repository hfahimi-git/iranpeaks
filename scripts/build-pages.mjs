#!/usr/bin/env node
/**
 * scripts/build-pages.mjs
 *
 * برای هر قله یک صفحهٔ استاتیک واقعی می‌سازد: dist/p/<slug>/index.html
 *
 * چرا؟ خزنده‌های تلگرام/واتساپ/توییتر/گوگل جاوااسکریپت اجرا نمی‌کنند؛ قبلاً همهٔ
 * لینک‌ها همان index.html عمومی را می‌گرفتند و پیش‌نمایش همیشه عنوان ثابت سایت بود.
 * حالا هر قله title/description/OG/canonical/JSON-LD اختصاصی خودش را دارد.
 *
 * خروجی‌ها:
 *   dist/p/<slug>/index.html   یک صفحه برای هر قله (همان شل اپ + متای اختصاصی)
 *   dist/sitemap.xml           همهٔ صفحه‌ها (قبلاً فقط یک آدرس داشت)
 *   dist/index.html            لینک‌های بخش «قله‌های پرطرفدار» به صفحه‌های استاتیک اشاره می‌کنند
 *
 * اجرا:  npm run pages        (بعد از vite build؛ در npm run build خودکار اجرا می‌شود)
 *
 * نکته: slug با نام قله ساخته می‌شود، نه شناسهٔ دیتابیس (همان سیاست لینک‌ها).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TEMPLATE = join(DIST, 'index.html');
const PEAKS_FILE = join(DIST, 'data/peaks.json');
const META_DIR = join(DIST, 'tracks/meta');
const PAGES_DIR = join(DIST, 'p');

const ORIGIN = 'https://iranpeaks.ir';
const OG_IMAGE = `${ORIGIN}/pwa-512x512.png`;

if (!existsSync(TEMPLATE) || !existsSync(PEAKS_FILE)) {
  console.error('dist آماده نیست. اول «npm run build» را بزن (این اسکریپت بعد از vite build اجرا می‌شود).');
  process.exit(1);
}

// ───────────────────────── کمکی‌ها ─────────────────────────
const attrEsc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNum = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** کاراکترهایی که در نام فایل/مسیر مجاز نیستند (و کاراکترهای معنادار در URL) */
const UNSAFE_PATH = /[\u0000-\u001f\u007f\\/:*?"<>|#%]/g;

/**
 * slug یک قله از «نام» آن.
 * ⚠️ این تابع باید عیناً با peakSlug در src/util.ts یکی باشد؛ اگر یکی را عوض کردی
 * دیگری را هم عوض کن، وگرنه دکمهٔ «کپی لینک» آدرسی می‌سازد که فایلش وجود ندارد.
 */
export function peakSlug(name) {
  return (
    String(name ?? '')
      .normalize('NFKC')
      .replace(/\u200c/g, ' ')
      .replace(UNSAFE_PATH, ' ')
      .replace(/\s+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'peak'
  );
}

/** یک متا/تگ را با محتوای تازه جایگزین می‌کند و اگر پیدا نشد خطا می‌دهد */
function replaceTag(html, tagRe, update, label) {
  if (!tagRe.test(html)) throw new Error(`الگوی ${label} در dist/index.html پیدا نشد`);
  return html.replace(tagRe, (tag) => update(tag));
}

const setMetaContent = (html, re, value, label) =>
  replaceTag(html, re, (tag) => tag.replace(/content="[^"]*"/, `content="${attrEsc(value)}"`), label);

// ───────────────────────── داده ─────────────────────────
const peaks = JSON.parse(readFileSync(PEAKS_FILE, 'utf8')).map(
  ([oid, name, ename, height, lat, lng, states, locations, folders]) => ({
    oid,
    name: name || ename || '',
    ename: ename || '',
    height: height ?? null,
    lat,
    lng,
    states: states || '',
    locations: locations || '',
    folders: folders || '',
  }),
);

if (!peaks.length) {
  console.error('peaks.json خالی است.');
  process.exit(1);
}

/** تعداد مسیرهای صعود هر قله از فایل‌های tracks/meta/<oid>.json */
const trackCount = new Map();
if (existsSync(META_DIR)) {
  for (const file of readdirSync(META_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const list = JSON.parse(readFileSync(join(META_DIR, file), 'utf8'));
      if (Array.isArray(list) && list.length) trackCount.set(file.slice(0, -5), list.length);
    } catch {
      // فایل خراب را نادیده بگیر
    }
  }
}

// ───────────────────────── ساخت صفحه‌ها ─────────────────────────
const template = readFileSync(TEMPLATE, 'utf8');

rmSync(PAGES_DIR, { recursive: true, force: true });
mkdirSync(PAGES_DIR, { recursive: true });

const used = new Map(); // slug → نام قله (برای نام‌های تکراری)
const urls = [];

for (const peak of peaks) {
  const name = peak.name.trim();
  if (!name) continue;

  let slug = peakSlug(name);
  const seen = used.get(slug);
  if (seen !== undefined) {
    // نام تکراری (مثلاً دو «توچال»)؛ شماره می‌گیرد. لینک‌های نام‌محور به صفحهٔ اول می‌روند.
    let i = 2;
    while (used.has(`${slug}-${i}`)) i++;
    slug = `${slug}-${i}`;
  }
  used.set(slug, name);

  const height = peak.height ? `${faNum(peak.height)} متر` : '';
  const where = peak.states || peak.locations || '';
  const tracks = trackCount.get(String(peak.oid)) ?? 0;

  const title = `قله ${name}${height ? ` — ${height}` : ''} | مسیر صعود و دانلود GPX`;
  const description =
    `قله ${name}${height ? ` با ارتفاع ${height}` : ''}${where ? ` در ${where}` : ''}. ` +
    `${tracks ? `${faNum(tracks)} مسیر صعود ثبت‌شده، ` : ''}` +
    'موقعیت روی نقشه، نمودار ارتفاعی و دانلود فایل GPX.';

  const slugEnc = encodeURIComponent(slug);
  const canonical = `${ORIGIN}/p/${slugEnc}/`;

  let html = template;

  html = replaceTag(html, /<title>[^<]*<\/title>/, () => `<title>${attrEsc(title)}</title>`, 'title');
  html = replaceTag(
    html,
    /<link\s+rel="canonical"[^>]*>/,
    (tag) => tag.replace(/href="[^"]*"/, `href="${attrEsc(canonical)}"`),
    'canonical',
  );
  html = setMetaContent(html, /<meta\s+name="description"[^>]*>/, description, 'description');
  html = setMetaContent(html, /<meta\s+property="og:title"[^>]*>/, title, 'og:title');
  html = setMetaContent(html, /<meta\s+property="og:description"[^>]*>/, description, 'og:description');
  html = setMetaContent(html, /<meta\s+property="og:url"[^>]*>/, canonical, 'og:url');
  html = setMetaContent(html, /<meta\s+property="og:image"[^>]*>/, OG_IMAGE, 'og:image');
  html = setMetaContent(html, /<meta\s+name="twitter:title"[^>]*>/, title, 'twitter:title');
  html = setMetaContent(html, /<meta\s+name="twitter:description"[^>]*>/, description, 'twitter:description');

  // عنوان قله در هدر (H1 برای سئو؛ همان جای tagline تا چیدمان به‌هم نریزد)
  const heading = `قله ${name}${height ? ` — ${height}` : ''}`;
  html = replaceTag(
    html,
    /<p class="tagline">[^<]*<\/p>/,
    () => `<h1 class="tagline tagline--peak">${attrEsc(heading)}</h1>`,
    'tagline',
  );

  // داده‌های ساخت‌یافتهٔ خود قله
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Mountain',
    name,
    ...(peak.ename ? { alternateName: peak.ename } : {}),
    ...(peak.height ? { elevation: `${peak.height} m` } : {}),
    ...(Number.isFinite(peak.lat) && Number.isFinite(peak.lng)
      ? { geo: { '@type': 'GeoCoordinates', latitude: peak.lat, longitude: peak.lng } }
      : {}),
    ...(where ? { address: { '@type': 'PostalAddress', addressRegion: where, addressCountry: 'IR' } } : {}),
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'iranpeaks.ir', url: `${ORIGIN}/` },
  };
  html = html.replace(
    '</head>',
    `  <script type="application/ld+json">${JSON.stringify(ld)}</script>\n  </head>`,
  );

  // اپ از این دو attribute می‌فهمد با کدام قله باز شده (بدون نیاز به ?q=)
  const bodyAttrs = [
    `data-peak="${attrEsc(name)}"`,
    Number.isFinite(peak.lat) ? `data-lat="${peak.lat}"` : '',
    Number.isFinite(peak.lng) ? `data-lng="${peak.lng}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  html = replaceTag(html, /<body>/, () => `<body ${bodyAttrs}>`, 'body');

  const dir = join(PAGES_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);

  urls.push({ loc: canonical, priority: '0.8', title });
}

// ───────────────────────── لینک‌های داخلی صفحهٔ اصلی ─────────────────────────
const slugByName = new Map();
for (const [slug, name] of used) if (!slugByName.has(name)) slugByName.set(name, slug);

let home = readFileSync(TEMPLATE, 'utf8');
let rewrote = 0;
home = home.replace(/href="\/\?q=([^"]+)"/g, (tag, enc) => {
  let name;
  try {
    name = decodeURIComponent(enc);
  } catch {
    return tag;
  }
  const slug = slugByName.get(name);
  if (!slug) return tag;
  rewrote++;
  return `href="/p/${encodeURIComponent(slug)}/"`;
});
writeFileSync(TEMPLATE, home);

// ───────────────────────── sitemap ─────────────────────────
const today = new Date().toISOString().slice(0, 10);
const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  `  <url>\n    <loc>${ORIGIN}/</loc>\n    <lastmod>${today}</lastmod>\n` +
  '    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n' +
  urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>monthly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n') +
  '\n</urlset>\n';

writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

console.log(
  `صفحه‌های قله: ${urls.length}  |  لینک‌های تغییرکردهٔ صفحهٔ اصلی: ${rewrote}\n` +
    `تعداد قله با نام تکراری: ${peaks.length - used.size > 0 ? used.size : '-'} slug یکتا\n` +
    `sitemap: ${urls.length + 1} آدرس`,
);
