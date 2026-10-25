// src/pwa.ts
export function watchForUpdates(): void {
  if (typeof __BUILD_ID__ !== 'string' || !__BUILD_ID__) return;

  const INTERVAL = 5 * 60 * 1000;
  const MIN_CHECK_GAP = 30 * 1000;
  const GUARD_KEY = 'pwa-reload-for'; // آخرین نسخه‌ای که برایش ریلود کرده‌ایم
  let reloading = false;
  let lastCheck = 0;

  /** service worker و precache قدیمی را پاک می‌کند تا ریلود حتماً از شبکه بخواند.
   *  کش تایل‌ها و مسیرها (map-tiles, peak-tracks) دست نمی‌خورد. */
  const hardReload = async (): Promise<void> => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.includes('precache')).map((k) => caches.delete(k)));
      }
    } catch {
      // مهم نیست؛ به هر حال ریلود می‌کنیم
    }
    location.reload();
  };

  const reloadForVersion = (remote: string): void => {
    if (reloading) return;
    try {
      // اگر قبلاً برای همین نسخه ریلود کرده‌ایم و باز mismatch است، حلقه نساز
      if (sessionStorage.getItem(GUARD_KEY) === remote) return;
      sessionStorage.setItem(GUARD_KEY, remote);
    } catch {
      // sessionStorage در دسترس نیست؛ بدون محافظ ادامه می‌دهیم
    }
    reloading = true;
    void hardReload();
  };

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
      if (match && match[1] !== __BUILD_ID__) reloadForVersion(match[1]);
    } catch {
      // آفلاین — بررسی بعدی
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

  window.setInterval(check, INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
  window.addEventListener('pageshow', () => void checkRemote());

  // پشتیبان: service worker جدید خودش کنترل را گرفت (precache جدید آماده است، ریلود امن است)
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloading) {
        reloading = true;
        location.reload();
      }
    });
  }

  void checkRemote();
}