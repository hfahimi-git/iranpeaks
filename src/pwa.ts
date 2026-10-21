// src/pwa.ts
// به‌روزرسانی خودکار نسخهٔ جدید
//
// ۱) شاخهٔ اصلی: صفحه با fetch-no-store نسخهٔ منتشرشدهٔ index.html را می‌خواند و
//    متاتگ <meta name="app-version"> را با شناسهٔ بیلد خودش مقایسه می‌کند.
//    اینجا نام فایل‌های هش‌دار هم عوض می‌شود (index-XXXX.js)، پس اگر تفاوت باشد
//    یک‌بار ریلود می‌کنیم و کاربر کد تازه را می‌گیرد — بدون Ctrl+F5.
//    این روش برای هر دو حالت (مرورگر و PWA نصب‌شده) کار می‌کند و به رفتار
//    کش/CDN سرویس‌ورکر وابسته نیست.
// ۲) پشتیبان: اگر نصب‌شدن سرویس‌ورکر جدید تغییر کنترل را بدهد (autoUpdate)، ریلود می‌کنیم.
//
// نکته: از Cache API عمداً استفاده نمی‌کنیم؛ fetch با cache:'no-store' حتی وقتی
// نسخهٔ قبلی سرویس‌ورکر کنترل صفحه را دارد، درخواست را به شبکه می‌فرستد.
export function watchForUpdates(): void {
  if (typeof __BUILD_ID__ !== 'string' || !__BUILD_ID__) return;

  const INTERVAL = 5 * 60 * 1000; // بررسی دوره‌ای هر ۵ دقیقه
  const MIN_CHECK_GAP = 30 * 1000; // حداقل فاصله بین دو بررسی
  let reloading = false;
  let lastCheck = 0;

  const checkRemote = async (): Promise<void> => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP) return;
    lastCheck = now;

    try {
      const res = await fetch(`/?version=${now}`, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
      });
      if (!res.ok) return;
      const html = await res.text();
      const match = html.match(/<meta\s+name="app-version"\s+content="([^"]+)"/i);
      if (match && match[1] !== __BUILD_ID__) reloadOnce();
    } catch {
      // آفلاین یا شبکهٔ قطع — بررسی بعدی
    }
  };

  const reloadOnce = (): void => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };

  const swUpdate = (): void => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => undefined);
  };

  const check = (): void => {
    swUpdate();
    void checkRemote();
  };

  // برنامهٔ نصب‌شده ممکن است روزها باز بماند؛ دوره‌ای هم بررسی می‌کنیم
  window.setInterval(check, INTERVAL);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
  window.addEventListener('pageshow', () => void checkRemote());

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) reloadOnce(); // اولین نصب ریلود لازم ندارد
    });
  }

  void checkRemote();
}
