import { defineConfig } from 'vite';
import {VitePWA} from "vite-plugin-pwa";

export default defineConfig({
  base: '/iranpeaks/',                    // چون روت GitHub Pages هست
  build: { outDir: 'dist' },
  optimizeDeps: { exclude: ['wa-sqlite'] },
  assetsInclude: ['**/*.wasm'],
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',          // آپدیت خودکار
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'نقشه قلل ایران',
        short_name: 'قلل ایران',
        description: 'جستجو و نمایش قله‌های ایران روی نقشه',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/iranpeaks/',
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
        // کش کردن فایل‌های استاتیک + دیتابیس peaks.db
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,db,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.tile\..*\.org\/.*/i, // تایل‌های نقشه
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
            // مسیرهای صعود: بعد از اولین بازدید کش می‌شوند (precache نمی‌شوند تا نصب PWA سنگین نشود)
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/tracks/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'peak-tracks',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 90 // ۹۰ روز
              }
            }
          }
        ]
      }
    })
  ]
});