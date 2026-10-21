import { defineConfig } from 'vite';
import {VitePWA} from "vite-plugin-pwa";

// شناسهٔ یکتای هر بیلد. داخل HTML به‌صورت <meta name="app-version"> و در کد اپ
// (src/pwa.ts) قرار می‌گیرد تا نسخهٔ منتشرشده با نسخهٔ در حال اجرا مقایسه شود.
const buildId = 'v' + Date.now().toString(36);

export default defineConfig({
  base: '/',                    // چون روت GitHub Pages هست
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // لیفلت جدا می‌ماند: هم فقط موقع لازم (import داینامیک) دانلود می‌شود،
        // هم آپدیت کد اپ کش آن را باطل نمی‌کند (Vite 8 / Rolldown: فرم تابعی manualChunks)
        manualChunks(id: string) {
          if (id.includes('node_modules/leaflet/')) return 'leaflet';
        },
      },
    },
  },
  plugins: [
    {
      // نسخهٔ بیلد را در HTML و داخل کد اپ می‌گذارد (تشخیص «نسخهٔ جدید» در src/pwa.ts).
      // تزریق در transform انجام می‌شود چون در Vite 8 / Rolldown گزینهٔ define
      // اینجا به کد اپ اعمال نمی‌شود.
      name: 'app-version',
      transform(code: string, id: string) {
        if (!id.endsWith('pwa.ts')) return null;
        return code.replaceAll('__BUILD_ID__', JSON.stringify(buildId));
      },
      transformIndexHtml(html: string) {
        return html.replace(
          '</head>',
          `  <meta name="app-version" content="${buildId}" />\n  </head>`,
        );
      },
    },
    VitePWA({
      registerType: 'autoUpdate',          // آپدیت خودکار
      includeAssets: ['favicon.ico', 'pwa-192x192.png'],
      manifest: {
        name: 'نقشه قلل ایران',
        short_name: 'قلل ایران',
        description: 'جستجو و نمایش قله‌های ایران روی نقشه',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        lang: 'fa',
        dir: 'rtl',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // کش کردن فایل‌های استاتیک + دیتای قله‌ها (peaks.json، جایگزین دیتابیس قبلی)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}', 'data/peaks.json'],
        runtimeCaching: [
          {
            // تایل‌های نقشه (CyclOSM، OSM و هر زیردامنهٔ tile.*)
            // الگوی قبلی با آدرس واقعی تایل‌ها جور نبود (tile-cyclosm…fr) و هیچ تایلی کش نمی‌شد!
            urlPattern: ({ url }: { url: URL }) =>
              /(^|\.)tile/i.test(url.hostname) || url.hostname.endsWith('openstreetmap.fr'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30 // ۳۰ روز
              }
            }
          },
          {
            // مسیرهای صعود + متادیتای per-قله: بعد از اولین بازدید کش می‌شوند
            // (precache نمی‌شوند تا نصب PWA سنگین نشود)
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/tracks/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'peak-tracks',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 90 // ۹۰ روز
              }
            }
          }
        ]
      }
    })
  ]
});
