// src/map/tracks.ts
// نمایش مسیرهای صعود (GPX ساده‌شده) روی نقشه — بدون هیچ کتابخانه‌ی اضافه.
// index.json یک‌بار و فقط موقع باز شدن اولین پاپ‌آپ لود می‌شود؛ هر مسیر هم فقط با کلیک.
import L from 'leaflet';

interface TrackMeta {
  n: string;       // عنوان
  km: number;      // طول
  up: number;      // صعود تجمعی (متر)
  down?: number;   // فرود تجمعی (متر)
  max?: number;    // بالاترین نقطه (متر)
  min?: number;    // پایین‌ترین نقطه (متر)
  loop?: boolean;  // رفت‌وبرگشت / حلقه‌ای (ابتدا و انتها نزدیک هم)
  ts?: number;     // زمان اولین نقطه (epoch، ثانیه)
  dur?: number;    // مدت ثبت‌شده (دقیقه)
  by?: string;     // نویسنده
  src?: string;    // لینک صفحه‌ی اصلی مسیر (برای garmin وجود ندارد)
}

interface TrackIndex {
  peaks: Record<string, string[]>;      // oid قله → شناسه‌ی مسیرها
  tracks: Record<string, TrackMeta>;
}

type TrackPoint = [number, number, number?]; // [lat, lng, ele?]

interface TrackFile {
  s?: TrackPoint[][];  // تکه‌های مسیر؛ بین دو تکه (وقفه‌ی ضبط) خطی رسم نمی‌شود
  p?: TrackPoint[];    // فرمت قدیمی (یک تکه)
}

/** تکه‌های مسیر؛ فایل‌های قدیمی فقط p دارند */
const segmentsOf = (data: TrackFile): TrackPoint[][] => data.s ?? (data.p ? [data.p] : []);

const BASE = import.meta.env.BASE_URL;
const COLORS = ['#dc2626', '#ea580c', '#7c3aed', '#0891b2', '#16a34a', '#c026d3'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDE_MAP_PX = 600; // در نقشه‌ی عریض، جزئیات مسیر به‌صورت پیش‌فرض باز است

let tracksLayer: L.LayerGroup | null = null;
let mapRef: L.Map | null = null;
let indexPromise: Promise<TrackIndex | null> | null = null;
let legendEl: HTMLElement | null = null;
let expandedId: string | null = null;

const dataCache = new Map<string, TrackFile>();    // داده‌ی خام مسیرها
const shapes = new Map<string, L.FeatureGroup>();  // کش لایه‌های Leaflet
const visible = new Set<string>();                 // مسیرهای نمایش‌داده‌شده
const metas = new Map<string, TrackMeta>();        // متادیتای مسیرهای نمایش‌داده‌شده

// ───────────────────────── کمکی‌ها ─────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const colorOf = (id: string): string => COLORS[parseInt(id.slice(0, 2), 16) % COLORS.length];

const toLatinDigits = (s: string): string => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}:${String(m).padStart(2, '0')} ساعت` : `${m} دقیقه`;
}

/** تاریخ شمسی به وقت تهران، مثلاً «29 مهر 1401» */
function fmtDate(ts: number): string {
  return toLatinDigits(
    new Date(ts * 1000).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' }),
  );
}

/** لینک منبع قابل‌نمایش؛ برای garmin (و هر آدرس نامعتبر) null برمی‌گرداند */
function sourceInfo(src?: string): { href: string; label: string } | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, '');
    if (/(^|\.)garmin\./i.test(host)) return null;
    return { href: u.href, label: host === 'wikiloc.com' ? 'ویکی‌لوک' : 'منبع مسیر' };
  } catch {
    return null;
  }
}

function sourceLink(src: string | undefined, className: string): HTMLAnchorElement | null {
  const info = sourceInfo(src);
  if (!info) return null;
  const a = el('a', className, `${info.label} ↗`);
  a.href = info.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// ───────────────────────── داده و لایه‌ها ─────────────────────────
function loadIndex(): Promise<TrackIndex | null> {
  indexPromise ??= fetch(`${BASE}tracks/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<TrackIndex>) : null))
    .catch(() => null)
    .then((idx) => {
      if (!idx) indexPromise = null; // بار بعد دوباره تلاش کند (مثلاً آفلاین بوده)
      return idx;
    });
  return indexPromise;
}

async function getData(id: string): Promise<TrackFile> {
  const cached = dataCache.get(id);
  if (cached) return cached;
  const res = await fetch(`${BASE}tracks/${id}.json`);
  if (!res.ok) throw new Error(`track ${id}: HTTP ${res.status}`);
  const data = (await res.json()) as TrackFile;
  dataCache.set(id, data);
  return data;
}

async function getShape(id: string, title: string): Promise<L.FeatureGroup> {
  const cached = shapes.get(id);
  if (cached) return cached;

  const data = await getData(id);
  // آرایه‌ی تو در تو = چند خط جدا (بدون خط واصل بین تکه‌ها)
  const latlngs = segmentsOf(data).map((seg) => seg.map(([lat, lng]) => [lat, lng] as L.LatLngTuple));
  const shape = L.featureGroup([
    // حاشیه‌ی سفید تا مسیر روی هر زمینه‌ای دیده شود
    L.polyline(latlngs, { color: '#ffffff', weight: 7, opacity: 0.85, interactive: false }),
    L.polyline(latlngs, { color: colorOf(id), weight: 4, opacity: 0.95 }).bindTooltip(title, { sticky: true }),
    L.circleMarker(latlngs[0][0], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#16a34a', fillOpacity: 1, interactive: false }),
  ]);
  shapes.set(id, shape);
  return shape;
}

/** زوم روی مسیر؛ وقتی حرکت نقشه تمام شد resolve می‌شود (حداکثر ۸۰۰ms صبر می‌کند) */
function fitTo(bounds: L.LatLngBounds): Promise<void> {
  return new Promise((resolve) => {
    if (!mapRef) return resolve();
    const map = mapRef;
    const done = () => {
      map.off('moveend', done);
      resolve();
    };
    map.on('moveend', done);
    // پایین نقشه جا برای فهرست مسیرها می‌گذاریم تا روی مسیر نیفتد
    const legendH = legendEl && !legendEl.hidden ? legendEl.offsetHeight : 0;
    map.fitBounds(bounds, {
      paddingTopLeft: [50, 50],
      paddingBottomRight: [50, 50 + legendH],
      maxZoom: 15,
    });
    setTimeout(done, 800);
  });
}

// ───────────────────────── دانلود GPX ─────────────────────────
const escXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GPX را در مرورگر از همان داده‌ی لودشده می‌سازد؛ پس برای همه‌ی مسیرها (از هر منبعی) کار می‌کند و حجمی به سایت اضافه نمی‌کند. */
async function downloadGpx(id: string, meta: TrackMeta): Promise<void> {
  const data = await getData(id);
  const trksegs = segmentsOf(data)
    .map((seg) => {
      const pts = seg
        .map(([lat, lng, ele]) => `<trkpt lat="${lat}" lon="${lng}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`)
        .join('');
      return `<trkseg>${pts}</trkseg>`;
    })
    .join('');
  const link = sourceInfo(meta.src);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="iranpeaks.ir" xmlns="http://www.topografix.com/GPX/1/1">' +
    `<metadata><name>${escXml(meta.n)}</name>` +
    (meta.by ? `<author><name>${escXml(meta.by)}</name></author>` : '') +
    (link ? `<link href="${escXml(link.href)}"><text>${escXml(link.label)}</text></link>` : '') +
    '</metadata>' +
    `<trk><name>${escXml(meta.n)}</name>${trksegs}</trk></gpx>`;

  const fileName = meta.n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'track';
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}.gpx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** دکمه‌ی دانلود با نمایش خطا؛ برای پاپ‌آپ و فهرست روی نقشه مشترک است */
function downloadButton(className: string, id: string, meta: TrackMeta): HTMLButtonElement {
  const btn = el('button', className, 'دانلود GPX');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await downloadGpx(id, meta);
    } catch {
      btn.textContent = 'دانلود ناموفق بود';
      setTimeout(() => (btn.textContent = 'دانلود GPX'), 2500);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

// ───────────────────────── نمودار ارتفاعی ─────────────────────────
function profileSvg(data: TrackFile, color: string): SVGSVGElement | null {
  // فاصله‌ی تجمعی (تقریب تخت، برای نمودار کافی است)؛ پرش بین تکه‌ها فاصله حساب نمی‌شود
  const pts: [number, number, number][] = [];
  const dist: number[] = [];
  let acc = 0;
  for (const seg of segmentsOf(data)) {
    let prev: [number, number, number] | null = null;
    for (const q of seg) {
      if (q[2] === undefined) continue;
      const cur: [number, number, number] = [q[0], q[1], q[2]];
      if (prev) {
        const dy = (cur[0] - prev[0]) * 110540;
        const dx = (cur[1] - prev[1]) * 111320 * Math.cos((cur[0] * Math.PI) / 180);
        acc += Math.hypot(dx, dy);
      }
      pts.push(cur);
      dist.push(acc);
      prev = cur;
    }
  }
  if (pts.length < 2) return null;

  const total = dist[dist.length - 1] || 1;
  const eMin = Math.min(...pts.map((q) => q[2]));
  const eMax = Math.max(...pts.map((q) => q[2]));
  const span = Math.max(eMax - eMin, 20);

  const W = 240;
  const H = 48;
  const pad = 3;
  const xy = pts.map((q, i) => `${((dist[i] / total) * W).toFixed(1)},${(H - pad - ((q[2] - eMin) / span) * (H - 2 * pad)).toFixed(1)}`);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'track-card__profile');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `نمودار ارتفاع، از ${Math.round(eMin)} تا ${Math.round(eMax)} متر`);

  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', `M0,${H} L${xy.join(' L')} L${W},${H} Z`);
  area.setAttribute('fill', color);
  area.setAttribute('fill-opacity', '0.25');

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', xy.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  svg.append(area, line);
  return svg;
}

// ───────────────────────── فهرست روی نقشه ─────────────────────────
export function initTracks(map: L.Map): void {
  mapRef = map;
  tracksLayer = L.layerGroup().addTo(map);

  // کارت‌های مسیرهای نمایش‌داده‌شده، روی خود نقشه (پایین-چپ)
  legendEl = el('div', 'track-legend');
  legendEl.hidden = true;
  L.DomEvent.disableClickPropagation(legendEl);
  L.DomEvent.disableScrollPropagation(legendEl);
  map.getContainer().appendChild(legendEl);
}

export function clearTracks(): void {
  tracksLayer?.clearLayers();
  visible.clear();
  metas.clear();
  expandedId = null;
  renderLegend();
  syncButtons();
}

/** وضعیت دکمه‌های لیست داخل پاپ‌آپ را با مسیرهای نمایش‌داده‌شده یکی می‌کند */
function syncButtons(): void {
  document.querySelectorAll<HTMLElement>('.peak-track[data-id]').forEach((b) => {
    b.classList.toggle('is-on', visible.has(b.dataset.id ?? ''));
  });
}

function stat(label: string, value: string): HTMLElement {
  const box = el('div', 'track-card__stat');
  box.append(el('span', 'track-card__stat-label', label), el('span', 'track-card__stat-value', value));
  return box;
}

function cardBody(id: string, meta: TrackMeta): HTMLElement {
  const body = el('div', 'track-card__body');

  const actions = el('div', 'track-card__actions');
  actions.append(downloadButton('track-act track-act--primary', id, meta));
  const src = sourceLink(meta.src, 'track-act');
  if (src) actions.append(src);
  const zoom = el('button', 'track-act', 'نمایش کامل مسیر');
  zoom.type = 'button';
  zoom.addEventListener('click', () => {
    const shape = shapes.get(id);
    if (shape) void fitTo(shape.getBounds());
  });
  actions.append(zoom);
  body.append(actions);

  const data = dataCache.get(id);
  const profile = data ? profileSvg(data, colorOf(id)) : null;
  if (profile) body.append(profile);

  const stats = el('div', 'track-card__stats');
  stats.append(stat('طول', `${meta.km} کیلومتر`), stat('صعود', `${meta.up} متر`));
  if (meta.down !== undefined) stats.append(stat('فرود', `${meta.down} متر`));
  if (meta.max !== undefined) stats.append(stat('بیشترین ارتفاع', `${meta.max} متر`));
  if (meta.min !== undefined) stats.append(stat('کمترین ارتفاع', `${meta.min} متر`));
  if (meta.dur !== undefined) stats.append(stat('مدت ثبت‌شده', fmtDuration(meta.dur)));
  body.append(stats);

  const info: string[] = [`نوع مسیر: ${meta.loop ? 'رفت‌وبرگشت / حلقه‌ای' : 'یک‌طرفه'}`];
  if (meta.ts !== undefined) info.push(`تاریخ: ${fmtDate(meta.ts)}`);
  if (meta.by) info.push(`نویسنده: ${meta.by}`);
  for (const line of info) body.append(el('div', 'track-card__meta', line));


  return body;
}

function renderLegend(): void {
  if (!legendEl) return;
  legendEl.replaceChildren();
  legendEl.hidden = visible.size === 0;

  for (const id of visible) {
    const meta = metas.get(id);
    if (!meta) continue;
    const open = expandedId === id;

    const card = el('div', open ? 'track-card is-open' : 'track-card');

    const head = el('div', 'track-card__head');
    const dot = el('span', 'track-card__dot');
    dot.style.background = colorOf(id);

    const title = el('button', 'track-card__title', meta.n);
    title.type = 'button';
    title.title = open ? 'بستن جزئیات' : 'نمایش جزئیات';
    title.setAttribute('aria-expanded', String(open));
    title.addEventListener('click', () => {
      expandedId = open ? null : id;
      renderLegend();
    });

    const close = el('button', 'track-card__close', '✕');
    close.type = 'button';
    close.title = 'حذف مسیر از نقشه';
    close.addEventListener('click', () => hideTrack(id));

    head.append(dot, title, close);

    const summary = [`${meta.km} کیلومتر`, `صعود ${meta.up} متر`];
    if (meta.max !== undefined) summary.push(`اوج ${meta.max} متر`);
    card.append(head, el('div', 'track-card__sum', summary.join(' · ')));

    if (open) card.append(cardBody(id, meta));
    legendEl.append(card);
  }
}

function hideTrack(id: string): void {
  const shape = shapes.get(id);
  if (shape) tracksLayer?.removeLayer(shape);
  visible.delete(id);
  metas.delete(id);
  if (expandedId === id) expandedId = null;
  renderLegend();
  syncButtons();
}

/** نمایش/مخفی کردن یک مسیر؛ خروجی: آیا الان نمایش داده می‌شود؟ */
async function toggleTrack(id: string, meta: TrackMeta): Promise<boolean> {
  if (!mapRef || !tracksLayer) return false;
  const shape = await getShape(id, meta.n);

  if (visible.has(id)) {
    hideTrack(id);
    return false;
  }

  metas.set(id, meta);
  tracksLayer.addLayer(shape);
  visible.add(id);
  // در نقشه‌ی عریض جزئیات مسیر جدید باز می‌شود؛ در موبایل جمع می‌ماند تا جای مسیر را نگیرد
  expandedId = mapRef.getSize().x >= WIDE_MAP_PX ? id : null;
  renderLegend();
  syncButtons();

  // پاپ‌آپ را می‌بندیم: هم روی مسیر نمی‌افتد، هم Leaflet برای دیدن آن نقشه را جابه‌جا نمی‌کند
  mapRef.closePopup();
  await fitTo(shape.getBounds());
  return true;
}

// ───────────────────────── لیست داخل پاپ‌آپ قله ─────────────────────────
/** بخش «مسیرهای صعود» را داخل پاپ‌آپ یک قله می‌سازد (اگر قله مسیری نداشت هیچ‌چیز اضافه نمی‌شود). */
export async function renderPeakTracks(slot: HTMLElement, oid: number, onResize: () => void): Promise<void> {
  const index = await loadIndex();
  const ids = index?.peaks[String(oid)];
  if (!index || !ids?.length) return;

  const box = el('div', 'peak-tracks');
  box.append(el('div', 'peak-tracks__title', `مسیرهای صعود (${ids.length})`));
  const list = el('div', 'peak-tracks__list');
  box.append(list);

  for (const id of ids) {
    const meta = index.tracks[id];
    if (!meta) continue;

    const btn = el('button', 'peak-track');
    btn.type = 'button';
    btn.dataset.id = id;
    if (visible.has(id)) btn.classList.add('is-on');

    const dot = el('span', 'peak-track__dot');
    dot.style.background = colorOf(id);
    const name = el('span', 'peak-track__name', meta.n);
    const info = el('span', 'peak-track__meta', `${meta.km} کیلومتر · صعود ${meta.up} متر`);
    btn.append(dot, name, info);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.remove('is-error');
      try {
        await toggleTrack(id, meta); // وضعیت دکمه‌ها داخل خودش sync می‌شود
      } catch {
        btn.classList.add('is-error');
        info.textContent = 'بارگذاری مسیر ناموفق بود';
      } finally {
        btn.disabled = false;
      }
    });

    list.append(btn);

    // دانلود GPX برای همه‌ی مسیرها؛ لینک منبع فقط اگر وجود داشته باشد (garmin ندارد)
    const actions = el('div', 'peak-track__actions');
    actions.append(downloadButton('peak-track__act', id, meta));
    const src = sourceLink(meta.src, 'peak-track__act');
    if (src) actions.append(src);
    list.append(actions);
  }

  slot.replaceChildren(box);
  onResize();
}
