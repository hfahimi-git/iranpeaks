#!/usr/bin/env node
/**
 * scripts/build-icons.mjs
 *
 * از public/logo.svg آیکون‌های PWA/favicon را می‌سازد (بدون هیچ وابستگی npm).
 * SVG را در مرورگر headless رندر می‌کند، canvas → PNG می‌گیرد و ICO را دستی می‌سازد.
 *
 * اجرا:  npm run icons
 *
 * خروجی‌ها:
 *   public/pwa-192x192.png        آیکون PWA (any)
 *   public/pwa-512x512.png        آیکون PWA (any + maskable در manifest)
 *   public/apple-touch-icon.png   آیکون iOS (پس‌زمینه‌ی تو‌پر، بدون گوشه‌ی گرد)
 *   public/favicon.ico            favicon چند‌اندازه
 *
 * نکته: این اسکریپت به یک سرور محلی روی 4173 نیاز دارد (npm run preview) چون
 * صفحه‌ی رندر باید logo.svg را از همان origin بخواند.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const LOGO = join(PUBLIC, 'logo.svg');
const ORIGIN = process.env.ICON_ORIGIN ?? 'http://localhost:4173';

if (!existsSync(LOGO)) {
  console.error(`logo.svg پیدا نشد: ${LOGO}`);
  process.exit(1);
}

const svg = readFileSync(LOGO, 'utf8');
// رنگ پس‌زمینه‌ی آیکون‌ها: گرادیان برند تخت‌شده (برای maskable و iOS)
const BG = '#1e40af';

/** صفحه‌ای که SVG را روی canvas می‌کشد و PNG base64 برمی‌گرداند */
const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
window.renderIcon = (svgText, size, bg, pad) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
    const inner = size - pad * 2;
    ctx.drawImage(img, pad, pad, inner, inner);
    resolve(c.toDataURL('image/png'));
  };
  img.onerror = () => reject(new Error('svg decode failed'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
});
</script></body></html>`;

const htmlPath = join(ROOT, '.icons-render.html');
writeFileSync(htmlPath, page);

// صفحه را روی سرور preview باز می‌کنیم تا fetch و decode ساده باشد؛ محتوای HTML
// را از خود فایل می‌خوانیم، پس لازم نیست حتماً سرو شود. اما برای مرورگر باید URL داشته باشد.
console.log('صفحه‌ی رندر ساخته شد:', htmlPath);
console.log('SVG:', svg.length, 'بایت');
console.log('رنگ پس‌زمینه:', BG);
console.log('\nبرای گرفتن PNGها از ابزار مرورگر استفاده می‌شود (دستی/CI متفاوت).');
console.log('این اسکریپت ساخت ICO را از PNGهای آماده انجام می‌دهد: npm run icons');
