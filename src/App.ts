import { searchPeaks, searchStates, findPeakBySlug, type Peak } from './db/queries';
import { esc, setUrlParam } from './util';

// ======================
// نقشه (لیفلت) با تاخیر
// ماژول نقشه و لیفلت فقط موقع لازم دانلود می‌شوند: اولین بار که نقشه به چشم می‌آید
// یا کاربر جستجو می‌کند. اینطوری باز شدن صفحه (FCP/TTI) سریع‌تر می‌شود.
// ======================
type MapModule = typeof import('./map/map');

let mapModule: Promise<MapModule> | null = null;

function ensureMap(): Promise<MapModule> {
  mapModule ??= import('./map/map').then((m) => {
    m.initMap('map');
    return m;
  });
  return mapModule;
}

const mapEl = document.getElementById('map');
if (mapEl && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void ensureMap();
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(mapEl);
} else {
  void ensureMap();
}

const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const suggestionsBox = document.getElementById('suggestions') as HTMLDivElement;

// ======================
// متغیرهای مربوط به کیبورد
// ======================
let selectedIndex = -1;
let currentSuggestions: Array<{ type: 'peak' | 'state'; value: string; label: string }> = [];

// ======================
// جستجو
// ======================
async function doSearch() {
  const query = searchInput.value.trim();
  hideSuggestions();
  selectedIndex = -1;
  setUrlParam('q', query || null); // لینک نتایج جستجو قابل اشتراک می‌شود (?q=…)
  const map = await ensureMap();
  await map.loadPeaks(query);
}
searchBtn.addEventListener('click', () => void doSearch());

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex >= 0 && currentSuggestions[selectedIndex]) {
      selectSuggestion(currentSuggestions[selectedIndex]);
    } else {
      void doSearch();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentSuggestions.length === 0) return;
    selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
    updateHighlight();
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentSuggestions.length === 0) return;
    selectedIndex = Math.max(selectedIndex - 1, -1);
    updateHighlight();
    return;
  }

  if (e.key === 'Escape') {
    hideSuggestions();
    selectedIndex = -1;
  }
});

// ======================
// دکمه پاک کردن
// ======================
function updateClearButton() {
  clearBtn.style.display = searchInput.value.trim() ? 'block' : 'none';
}

searchInput.addEventListener('input', () => {
  updateClearButton();
  handleAutocomplete();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  updateClearButton();
  setUrlParam('q', null);
  setUrlParam('track', null);
  // اگر نقشه هنوز دانلود نشده، چیزی برای پاک کردن وجود ندارد — لازم نیست بارش کنیم
  void mapModule?.then((m) => m.clearMap());
  hideSuggestions();
  searchInput.focus();
});

// ======================
// Autocomplete + استان‌ها
// ======================
let debounceTimer: number | null = null;

async function handleAutocomplete() {
  const query = searchInput.value.trim();

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  if (query.length < 2) {
    hideSuggestions();
    selectedIndex = -1;
    return;
  }

  // جستجو روی آرایه در حافظه است؛ ۲۵۰ms کافی نیست صبر کنیم
  debounceTimer = window.setTimeout(async () => {
    const [peaks, states] = await Promise.all([
      searchPeaks(query),
      searchStates(query)
    ]);

    currentSuggestions = [];

    // اول استان‌ها رو اضافه کن
    states.slice(0, 5).forEach((state) => {
      currentSuggestions.push({
        type: 'state',
        value: state,
        label: `استان: ${esc(state)}`
      });
    });

    // بعد قله‌ها
    peaks.slice(0, 8).forEach((peak: Peak) => {
      const name = peak.name || peak.ename || 'بدون نام';
      const height = peak.height ? ` — ${peak.height} متر` : '';
      const locations = peak.locations ? ` / ${peak.locations}` : '';
      currentSuggestions.push({
        type: 'peak',
        value: name,
        label: `<strong>${esc(name)}</strong><span style="color:#64748b">${esc(height)}</span><span style="color:#64748b">${esc(locations)}</span>`
      });
    });

    if (currentSuggestions.length === 0) {
      hideSuggestions();
      selectedIndex = -1;
      return;
    }

    renderSuggestions();
    selectedIndex = -1;
  }, 150);
}

function renderSuggestions() {
  suggestionsBox.innerHTML = '';

  currentSuggestions.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    if (item.type === 'state') {
      div.classList.add('suggestion-state');
    }
    div.innerHTML = item.label;
    div.dataset.index = String(index);

    div.addEventListener('click', () => {
      selectSuggestion(item);
    });

    suggestionsBox.appendChild(div);
  });

  suggestionsBox.style.display = 'block';
}

function updateHighlight() {
  const items = suggestionsBox.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => {
    if (i === selectedIndex) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('selected');
    }
  });
}

async function selectSuggestion(item: { type: 'peak' | 'state'; value: string; label: string }) {
  searchInput.value = item.value;
  updateClearButton();
  hideSuggestions();
  selectedIndex = -1;
  setUrlParam('q', item.value);

  const map = await ensureMap();
  if (item.type === 'state') {
    await map.loadPeaksByState(item.value);
  } else {
    await map.loadPeaks(item.value);
  }
}

function hideSuggestions() {
  suggestionsBox.style.display = 'none';
  suggestionsBox.innerHTML = '';
  currentSuggestions = [];
  selectedIndex = -1;
}

// بستن پیشنهادات با کلیک بیرون
document.addEventListener('click', (e) => {
  const target = e.target as Node;
  if (
      !searchInput.contains(target) &&
      !suggestionsBox.contains(target) &&
      !clearBtn.contains(target)
  ) {
    hideSuggestions();
  }
});

// سال جاری را به صورت داینامیک بگذار
const yearEl = document.getElementById('current-year');
if (yearEl) {
  yearEl.textContent = new Date().getFullYear().toString();
}

// ======================
// لینک‌های اشتراک‌گذاری‌شده
// ?q=<نام قله یا استان> → همان جستجو اجرا می‌شود؛ اگر نتیجه یکتا باشد پاپ‌آپش باز می‌شود
// ?track=<عنوان مسیر> → مسیر هم‌نام همان قله هم خودکار روی نقشه می‌آید
// (شناسهٔ دیتابیس در URL نمی‌آید تا کسی نتواند با شمردن idها همهٔ قله‌ها را جمع کند)
// ======================
const initialParams = new URLSearchParams(window.location.search);
// صفحه‌های استاتیک هر قله (/p/<slug>/) نام و مختصات قله را در body می‌گذارند.
// نام تنها کافی نیست (چند قله هم‌نام داریم)، پس قلهٔ درست با مختصاتش پیدا می‌شود.
const pagePeak = (document.body.dataset.peak ?? '').trim();
const pageLat = Number(document.body.dataset.lat);
const pageLng = Number(document.body.dataset.lng);
const pageAnchor =
  pagePeak && Number.isFinite(pageLat) && Number.isFinite(pageLng)
    ? { name: pagePeak, lat: pageLat, lng: pageLng }
    : undefined;
const initialQuery = (initialParams.get('q') ?? pagePeak).trim();
const initialTrack = (initialParams.get('track') ?? '').trim();

// آپدیت متا برای پیش‌نمایش لینک در تلگرام/واتساپ/...
// روی صفحه‌های استاتیک این کار لازم نیست: متای درست همان‌جا در HTML ساخته شده.
function updateShareMeta(peak: string, track: string, force = false) {
  if (!peak || (pagePeak && !force)) return;
  const title = track
    ? `مسیر «${track}» در قله «${peak}» | iranpeaks.ir`
    : `قله «${peak}» | نقشه قلل ایران — iranpeaks.ir`;
  const desc = track
    ? `مسیر صعود «${track}» به قله «${peak}» با نقشه، پروفایل ارتفاعی و دانلود GPX در iranpeaks.ir`
    : `قله «${peak}» روی نقشه قلل ایران — موقعیت، مسیرهای صعود، نمودار ارتفاعی و دانلود GPX`;
  document.title = title;
  const set = (sel: string, attr: string, val: string) => {
    const el = document.querySelector(sel);
    if (el) el.setAttribute(attr, val);
  };
  set('meta[name="description"]', 'content', desc);
  set('meta[property="og:title"]', 'content', title);
  set('meta[property="og:description"]', 'content', desc);
  set('meta[property="og:url"]', 'content', window.location.href);
  set('meta[name="twitter:title"]', 'content', title);
  set('meta[name="twitter:description"]', 'content', desc);
}
updateShareMeta(initialQuery, initialTrack);

// آدرس صفحهٔ استاتیک قله: /p/<slug>/  (اگر صفحه از پیش ساخته شده باشد، data-peak بالاتر کافی است)
const basePath = import.meta.env.BASE_URL || '/';
const pagePathPrefix = `${basePath}p/`;
let pathSlug = '';
if (window.location.pathname.startsWith(pagePathPrefix)) {
  try {
    pathSlug = decodeURIComponent(window.location.pathname.slice(pagePathPrefix.length).replace(/\/+$/, ''));
  } catch {
    pathSlug = '';
  }
}

// راه‌اندازی اولیه؛ اگر صفحهٔ استاتیک وجود نداشته باشد (مثلاً روی سرور توسعه)
// قله از روی slug همان آدرس پیدا می‌شود تا لینک‌ها همیشه کار کنند.
async function bootInitial(): Promise<void> {
  let peakName = pagePeak;
  let anchor = pageAnchor;

  if (!peakName && pathSlug) {
    const peak = await findPeakBySlug(pathSlug);
    if (peak) {
      peakName = (peak.name || peak.ename || '').trim();
      if (Number.isFinite(peak.lat) && Number.isFinite(peak.lng)) {
        anchor = { name: peakName, lat: peak.lat as number, lng: peak.lng as number };
      }
    }
  }

  const query = (initialParams.get('q') ?? peakName).trim();
  if (!query) return;

  // روی سرور توسعه (یا اگر صفحهٔ استاتیک نبود) عنوان/متا را هم از روی نام قله بگذار
  if (!pagePeak && peakName) updateShareMeta(peakName, initialTrack, true);

  searchInput.value = query;
  updateClearButton();

  const map = await ensureMap();
  if (initialTrack) map.queueTrackFromUrl(initialTrack);
  await map.loadPeaks(query, anchor);
}

void bootInitial();