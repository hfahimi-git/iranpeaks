// src/map/map.ts
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { searchPeaks, getPeaksByState, type Peak } from '../db/queries';
import { initTracks, clearTracks, renderPeakTracks, setPendingTrack } from './tracks';
import { esc, flashCopied } from '../util';


// اصلاح آیکون پیش‌فرض Leaflet (مشکل معروف با Vite)
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34], // نوک پاپ‌آپ روی سر سوزن بنشیند، نه روی نوک پایینش (که کل مارکر را می‌پوشاند)
});
L.Marker.prototype.options.icon = DefaultIcon;

let map: L.Map | null = null;
let markersLayer: L.LayerGroup | null = null;

function clearMarkers(): void {
  markersLayer?.clearLayers();
}

export function initMap(containerId: string = 'map'): L.Map {
  if (map) return map;

  map = L.map(containerId).setView([32.4279, 53.6880], 6); // مرکز ایران

  L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    attribution: '<a href="https://www.cyclosm.org/">CyclOSM v0.6</a> | Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  initTracks(map);

  return map;
}

export async function loadPeaks(query: string) {
  if (!map || !markersLayer) return;

  clearMarkers();
  clearTracks();

  if (!query || query.trim().length < 2) {
    return;
  }

  const peaks = await searchPeaks(query.trim());
  const markers = renderPeaksOnMap(peaks);

  // اگر جستجو فقط یک نتیجه داشت، همان رفتار «باز شدن پاپ‌آپ قله» را اجرا کن
  // (لینک‌های اشتراک‌گذاری هم بر همین اساس کار می‌کنند: ?q=<نام قله>).
  // مهم: همین‌جا و بدون تأخیر؛ اگر به بعد موکول شود، بستنِ ناهمگامِ پاپ‌آپِ
  // مارکرِ پاک‌شده آن را دوباره می‌بندد.
  if (markers.length === 1) {
    markers[0].openPopup();
  }
}

export async function loadPeaksByState(state: string) {
  if (!map || !markersLayer) return;

  clearMarkers();
  clearTracks();

  if (!state || state.trim().length < 2) {
    return;
  }

  const peaks = await getPeaksByState(state.trim());
  renderPeaksOnMap(peaks);
}

/** محتوای پاپ‌آپ یک قله؛ فقط موقع اولین باز شدن ساخته می‌شود (برای صدها مارکر، DOM کمتر) */
function buildPopup(peak: Peak, lat: number, lng: number): HTMLElement {
  const content = document.createElement('div');
  content.innerHTML = `
      <div style="min-width: 200px; font-family: Vazirmatn, sans-serif; direction: rtl; text-align: right;">
        <strong style="font-size: 1.1rem;">${esc(peak.name || peak.ename || 'بدون نام')}</strong>
        ${peak.ename ? `<div style="color:#64748b; font-size:0.9rem;">${esc(peak.ename)}</div>` : ''}
        <div style="margin-top: 8px;">
          <div>ارتفاع: <b>${peak.height ? esc(peak.height) + ' متر' : '—'}</b></div>
          ${peak.states ? `<div>استان: <b>${esc(peak.states)}</b></div>` : ''}
          ${peak.locations ? `<div>موقعیت: <b>${esc(peak.locations)}</b></div>` : ''}
          ${peak.folders ? `<div>مجموعه: <b>${esc(peak.folders)}</b></div>` : ''}
          <div>گزارش هواشناسی: <b><a href="https://www.meteoblue.com/en/weather/week/${lat}N${lng}E" target="_blank"
            style="color:#2563eb;">7 روز آینده</a></b>
          </div>
        </div>
        <div class="peak-tracks-slot"></div>
        <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; direction:ltr;">
          <a href="https://www.wikiloc.com/wikiloc/map.do?sw=${lat - 0.1},${lng - 0.1}&ne=${lat + 0.1},${lng + 0.1}"
            target="_blank" style="color:#2563eb;"><img src="wikiloc.ico" width="16"></a>
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank"
          style="color:#2563eb;"><img src="maps.ico" width="16"></a>
          <a href="https://earth.google.com/web/@${lat},${lng},2000a" target="_blank"
          style="color:#2563eb;"><img src="earth.ico" width="16"></a>
          <button type="button" class="popup-share" title="کپی لینک این قله" aria-label="کپی لینک این قله">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
        </div>
      </div>
    `;

  // دکمهٔ کپی لینک قله؛ لینک با «نام» قله ساخته می‌شود (نه شناسهٔ دیتابیس) تا
  // کسی نتواند با شمردن idها همهٔ صفحه‌ها را جمع کند
  const shareBtn = content.querySelector<HTMLButtonElement>('.popup-share');
  if (shareBtn) {
    shareBtn.dataset.sharePeak = peak.name || peak.ename || '';
    shareBtn.addEventListener('click', () => flashCopied(shareBtn, 'کپی لینک این قله'));
  }

  return content;
}

function renderPeaksOnMap(peaks: Peak[]): L.Marker[] {
  if (!map || !markersLayer || peaks.length === 0) return [];

  const bounds: L.LatLngExpression[] = [];
  const markers: L.Marker[] = [];

  peaks.forEach((peak) => {
    if (!peak.lat || !peak.lng) return;
    const lat = peak.lat;
    const lng = peak.lng;

    const marker = L.marker([lat, lng]);
    let popupEl: HTMLElement | undefined;

    // محتوا به‌صورت تابع داده می‌شود: Leaflet موقع باز شدن صدا می‌زند، پس DOMِ پاپ‌آپ‌های
    // بازنشده هرگز ساخته نمی‌شود. همان عنصر برای باز شدن‌های بعدی هم نگه داشته می‌شود
    // تا بخش مسیرها پاک نشود.
    marker.bindPopup(() => (popupEl ??= buildPopup(peak, lat, lng)), { maxWidth: 320 });

    marker.on('popupopen', (e: L.PopupEvent) => {
      // پاپ‌آپ هیچ‌وقت بزرگ‌تر از نقشه نشود؛ اگر شد داخل خودش اسکرول می‌خورد
      // و با حاشیه‌ی autopan از زیر دکمه‌های زوم بیرون می‌ماند
      const popup = e.popup;
      const size = map?.getSize() ?? L.point(900, 580);
      popup.options.maxHeight = Math.max(160, size.y - 90);
      // ~44px پدینگ پاپ‌آپ + 55px حاشیه‌ی چپ (دکمه‌های زوم) + 10px حاشیه‌ی راست
      popup.options.maxWidth = Math.max(180, Math.min(320, size.x - 109));
      popup.options.autoPanPaddingTopLeft = [55, 10];
      popup.options.autoPanPaddingBottomRight = [10, 10];
      popup.update(); // بعد از update، محتوا همان عنصر قبلی است (تابع کش‌شده برمی‌گرداند)
      const slot = popupEl?.querySelector<HTMLElement>('.peak-tracks-slot');
      if (slot) void renderPeakTracks(slot, peak.oid, peak.name || peak.ename || '', () => popup.update());
    });

    marker.addTo(markersLayer!);
    markers.push(marker);
    bounds.push([lat, lng]);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds as L.LatLngBoundsExpression, {
      padding: [50, 50],
      maxZoom: 12,
    });
  }

  return markers;
}

export function clearMap() {
  clearMarkers();
  clearTracks();
}

/** آماده‌سازی مسیری که باید از روی لینک اشتراک‌گذاری (?track=…) باز شود */
export function queueTrackFromUrl(title: string | null): void {
  setPendingTrack(title);
}
