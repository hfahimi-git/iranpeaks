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
 * اگر کاربر روی صفحهٔ استاتیک یک قله (/p/<slug>/) باشد، جستجوی تازه به صفحهٔ اصلی برمی‌گردد.
 */
export function setUrlParam(key: string, value: string | null): void {
  const url = new URL(window.location.href);
  const base = import.meta.env.BASE_URL || '/';
  if (url.pathname !== base) {
    url.pathname = base;
    url.hash = '';
  }
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** کاراکترهایی که در نام فایل/مسیر مجاز نیستند (و کاراکترهای معنادار در URL) */
const UNSAFE_PATH = /[\u0000-\u001f\u007f\\/:*?"<>|#%]/g;

/**
 * slug یک قله از «نام» آن؛ باید عیناً با peakSlug در scripts/build-pages.mjs یکی باشد،
 * وگرنه دکمهٔ «کپی لینک» آدرسی می‌سازد که صفحه‌اش وجود ندارد.
 */
export function peakSlug(name: string): string {
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

/**
 * لینک قابل اشتراک برای یک قله (و به‌اختیار یک مسیر). پارامترها «نام» هستند نه
 * شناسهٔ دیتابیس تا کسی نتواند با شمردن idها همهٔ صفحه‌ها را جمع کند.
 *
 * اگر قله صفحهٔ استاتیک داشته باشد، لینک به همان صفحه می‌رود؛ این‌طور پیش‌نمایش
 * تلگرام/واتساپ عنوان و توضیح درست را نشان می‌دهد (خزنده‌ها جاوااسکریپت اجرا نمی‌کنند).
 */
export function shareUrl(peakTitle?: string, trackTitle?: string): string {
  const { origin } = window.location;
  const base = import.meta.env.BASE_URL || '/';
  if (!peakTitle) return `${origin}${base}`;
  const url = new URL(`${origin}${base}p/${encodeURIComponent(peakSlug(peakTitle))}/`);
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

