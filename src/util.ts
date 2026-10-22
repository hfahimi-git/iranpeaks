// src/util.ts

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * هر متنی که از دیتا می‌آید (نام قله، استان، عنوان مسیر و…) باید قبل از innerHTML
 * از این رد شود تا دادهٔ خارجی (مثلاً عنوان GPX ویکی‌لوک) نتواند HTML تزریق کند.
 */
export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * یک پارامتر URL را بدون رفرش صفحه و بدون شلوغ‌کردن تاریخچه به‌روز می‌کند.
 * مقدار null یعنی پارامتر حذف شود. با این کار هر جستجو/قلهٔ باز، لینک قابل اشتراک دارد.
 */
export function setUrlParam(key: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * لینک قابل اشتراک برای یک قله (و به‌اختیار یک مسیر). پارامترها «نام» هستند نه
 * شناسهٔ دیتابیس تا کسی نتواند با شمردن idها همهٔ صفحه‌ها را جمع کند.
 */
export function shareUrl(peakTitle?: string, trackTitle?: string): string {
  const { origin, pathname } = window.location;
  const base = `${origin}${pathname}`;
  if (!peakTitle) return base;
  const url = new URL(base);
  url.searchParams.set('q', peakTitle);
  if (trackTitle) url.searchParams.set('track', trackTitle);
  return url.href;
}

/** کپی متن در کلیپ‌بورد (با فالبک برای مرورگرهای قدیمی) */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** بازخورد کوتاه «کپی شد» روی یک دکمهٔ اشتراک‌گذاری */
export function flashCopied(btn: HTMLElement, defaultTitle: string): void {
  // اگر دکمه نام قله را نداشت، از پارامتر ?q= خود صفحه استفاده می‌کنیم
  const peak = btn.dataset.sharePeak || new URL(window.location.href).searchParams.get('q') || '';
  void copyText(shareUrl(peak, btn.dataset.shareTrack)).then((ok) => {
    btn.classList.add('is-ok');
    btn.title = ok ? 'کپی شد ✓' : 'کپی نشد — آدرس صفحه را دستی بردارید';
    window.setTimeout(() => {
      btn.classList.remove('is-ok');
      btn.title = defaultTitle;
    }, 1800);
  });
}

