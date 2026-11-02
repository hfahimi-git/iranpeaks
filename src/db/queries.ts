// src/db/queries.ts
// جستجوی قله‌ها روی یک JSON سبک (public/data/peaks.json)؛ بدون SQLite، بدون wasm.
// فایل JSON را scripts/build-peaks.mjs از data/peaks.db می‌سازد و ترتیب ستون‌ها همان‌جای ثبت شده است.
import { peakSlug } from '../util';

/** ستون‌های peaks.json — ترتیب باید با scripts/build-peaks.mjs یکی باشد */
const COLUMNS = ['oid', 'name', 'ename', 'height', 'lat', 'lng', 'states', 'locations', 'folders'] as const;

export interface Peak {
  oid: number;
  name: string | null;
  ename: string | null;
  height: number | null;
  lat: number | null;
  lng: number | null;
  states: string | null;
  locations: string | null;
  folders: string | null;
}

/** قله به‌همراه نسخهٔ نرمال‌شدهٔ فیلدهای متنی (برای جستجو) */
interface IndexedPeak {
  peak: Peak;
  name: string;
  ename: string;
  states: string;
}

let peaksPromise: Promise<IndexedPeak[]> | null = null;

/**
 * نرمال‌سازی متن فارسی/عربی برای مقایسه (ی/ي → ی، ك → ک، حذف نیم‌فاصله و اعراب،
 * ارقام فارسی/عربی → لاتین). همان منطق scripts/build-tracks.mjs تا نتایج یکی باشد.
 */
function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function allPeaks(): Promise<IndexedPeak[]> {
  peaksPromise ??= fetch(`${import.meta.env.BASE_URL}data/peaks.json`)
    .then((r) => {
      if (!r.ok) throw new Error('فایل data/peaks.json پیدا نشد');
      return r.json() as Promise<unknown[][]>;
    })
    .then((rows) =>
      rows.map((r) => {
        const peak = Object.fromEntries(COLUMNS.map((c, i) => [c, r[i]])) as unknown as Peak;
        return {
          peak,
          name: norm(peak.name ?? ''),
          ename: norm(peak.ename ?? ''),
          states: norm(peak.states ?? ''),
        };
      }),
    );
  return peaksPromise;
}

/** مرتب‌سازی مثل SQL قبلی: ORDER BY height DESC (ارتفاع خالی انتها) */
const byHeightDesc = (a: Peak, b: Peak): number => (b.height ?? -Infinity) - (a.height ?? -Infinity);

/**
 * قلهٔ متناظر با slug یک صفحهٔ `/p/<slug>/`.
 *
 * صفحه‌های استاتیک در بیلد ساخته می‌شوند؛ ولی روی سرور توسعه (vite dev) یا اگر
 * صفحه‌ای وجود نداشته باشد، اپ خودش باید از روی آدرس، قله را پیدا کند.
 * الگوریتم ساخت slug و پسوند تکرار (-2، -3) باید عیناً مثل scripts/build-pages.mjs
 * باشد، وگرنه آدرس به قلهٔ دیگری می‌رسد.
 */
export async function findPeakBySlug(slug: string): Promise<Peak | null> {
  if (!slug) return null;
  const used = new Set<string>();

  for (const row of await allPeaks()) {
    const name = (row.peak.name || row.peak.ename || '').trim();
    if (!name) continue;

    let s = peakSlug(name);
    if (used.has(s)) {
      let i = 2;
      while (used.has(`${s}-${i}`)) i++;
      s = `${s}-${i}`;
    }
    used.add(s);

    if (s === slug) return row.peak;
  }
  return null;
}

export async function searchPeaks(query: string): Promise<Peak[]> {
  const q = norm(query);
  if (!q) return [];
  const matches: Peak[] = [];
  for (const row of await allPeaks()) {
    if (row.name.includes(q) || row.ename.includes(q) || row.states.includes(q)) {
      matches.push(row.peak);
    }
  }
  return matches.sort(byHeightDesc);
}

export async function getPeaksByState(state: string): Promise<Peak[]> {  const q = norm(state);
  if (!q) return [];
  const matches: Peak[] = [];
  for (const row of await allPeaks()) {
    if (row.states.includes(q)) matches.push(row.peak);
  }
  return matches.sort(byHeightDesc);
}

/** نام استان‌هایی که عبارت درشان می‌آید (بدون تکرار) */
export async function searchStates(query: string): Promise<string[]> {  const q = norm(query);
  if (!q) return [];
  const seen = new Set<string>();
  for (const row of await allPeaks()) {
    if (row.peak.states && row.states.includes(q)) seen.add(row.peak.states);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'fa'));
}
