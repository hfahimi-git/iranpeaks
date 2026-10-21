// src/pwa.ts
// به‌روزرسانی خودکار نسخهٔ جدید
//
// ۱) شاخهٔ اصلی: صفحه با fetch-no-store نسخهٔ منتشرشدهٔ index.html را می‌خواند و
//    متاتگ <meta name="app-version"> را با شناسهٔ بیلد خودش مقایسه می‌کند.
//    اینجا نام فایل‌های هش‌دار هم عوض می‌شود (index-XXXX.js)، پس اگر تفاوت باشد
//    یک‌بار ریلود می‌کنیم و کاربر کد تازه را می‌گیرد — بدون Ctrl+F5.
// ۲) پشتیبان: اگر نصب‌شدن سرویس‌ورکر جدید تغییر کنترل را بدهد (autoUpdate)، ریلود می‌کنیم.

const RELOAD_GUARD_KEY = 'iranpeaks:ver-reload';

function justReloadedForUpdate(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (Number.isNaN(at)) {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      return false;
    }
    // اگر کمتر از ۱۵ ثانیه پیش رفرش شده، از بررسی‌های بعدی صرف‌نظر کن
    if (Date.now() - at < 15000) return true;
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return false;
  } catch {
    return false;
  }
}

function markReloading(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function watchForUpdates(): void {
  if (typeof __BUILD_ID__ !== 'string' || !__BUILD_ID__) return;

  // بعد از رفرش خودکار آپدیت، ۱۵ ثانیه اول هیچ‌چک دیگه‌ای نکن
  if (justReloadedForUpdate()) return;

  const INTERVAL = 5 * 60 * 1000; // بررسی دوره‌ای هر ۵ دقیقه
  const MIN_CHECK_GAP = 30 * 1000; // حداقل فاصله بین دو بررسی
  let reloading = false;
  let lastCheck = 0;

  const reloadOnce = (): void => {
    if (reloading) return;
    if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
    reloading = true;
    markReloading();
    location.reload();
  };

  const checkRemote = async (): Promise<void> => {
    if (reloading) return;
    if (document.visibilityState !== 'visible') return;
    if (justReloadedForUpdate()) return;

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
      if (match && match[1] !== __BUILD_ID__) {
        reloadOnce();
      }
    } catch {
      // آفلاین یا شبکهٔ قطع — بررسی بعدی
    }
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
    if (document.visibilityState === 'visible') {
      if (justReloadedForUpdate()) return;
      check();
    }
  });
  window.addEventListener('online', () => {
    if (justReloadedForUpdate()) return;
    check();
  });

  // pageshow نباید مستقیم checkRemote بزنه چون باعث چرخه میشه
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // برگشت از bfcache
      if (justReloadedForUpdate()) return;
      check();
    }
  });

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      if (justReloadedForUpdate()) return;
      if (hadController) {
        // فقط وقتی کنترل از SW قبلی منتقل میشه (آپدیت واقعی) رفرش کن
        reloadOnce();
      }
      // اولین بار نصب SW نباید رفرش کنه
    });
  }

  // اولین بررسی با تاخیر کم تا از race با بقیه event ها جلوگیری شه
  window.setTimeout(() => {
    if (justReloadedForUpdate()) return;
    void checkRemote();
  }, 500);
}