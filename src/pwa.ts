// src/pwa.ts
// به‌روزرسانی خودکار PWA: service worker نسخه‌ی جدید را در پس‌زمینه می‌گیرد، ولی صفحه‌ی باز
// (به‌خصوص برنامه‌ی نصب‌شده روی موبایل) تا ریلود بعدی با کد قدیمی کار می‌کند.
// اینجا (۱) هر بار که کاربر به برنامه برمی‌گردد دنبال نسخه‌ی جدید می‌گردیم و
// (۲) وقتی نسخه‌ی جدید کنترل را گرفت، صفحه را یک‌بار ریلود می‌کنیم.
export function watchForUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  // در اولین نصب (بدون کنترل‌کننده‌ی قبلی) ریلود لازم نیست
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const check = (): void => {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => undefined);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
}
