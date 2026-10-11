// src/map/map.ts
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { searchPeaks, getPeaksByState } from '../db/queries';
import { initTracks, clearTracks, renderPeakTracks } from './tracks';

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

  markersLayer.clearLayers();
  clearTracks();

  if (!query || query.trim().length < 2) {
    return;
  }

  const peaks = await searchPeaks(query.trim());
  renderPeaksOnMap(peaks);
}

export async function loadPeaksByState(state: string) {
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();
  clearTracks();

  if (!state || state.trim().length < 2) {
    return;
  }

  const peaks = await getPeaksByState(state.trim());
  renderPeaksOnMap(peaks);
}


function renderPeaksOnMap(peaks: any[]) {
  if (!map || !markersLayer || peaks.length === 0) return;

  const bounds: L.LatLngExpression[] = [];

  peaks.forEach((peak: any) => {
    if (!peak.lat || !peak.lng) return;

    const marker = L.marker([peak.lat, peak.lng]);

    const popupContent = `
      <div style="min-width: 200px; font-family: Vazirmatn, sans-serif; direction: rtl; text-align: right;">
        <strong style="font-size: 1.1rem;">${peak.name || peak.ename || 'بدون نام'}</strong>
        ${peak.ename ? `<div style="color:#64748b; font-size:0.9rem;">${peak.ename}</div>` : ''}
        <div style="margin-top: 8px;">
          <div>ارتفاع: <b>${peak.height ? peak.height + ' متر' : '—'}</b></div>
          ${peak.states ? `<div>استان: <b>${peak.states}</b></div>` : ''}
          ${peak.locations ? `<div>موقعیت: <b>${peak.locations}</b></div>` : ''}
          ${peak.folders ? `<div>مجموعه: <b>${peak.folders}</b></div>` : ''}
          <div>گزارش هواشناسی: <b><a href="https://www.meteoblue.com/en/weather/week/${peak.lat}N${peak.lng}E" target="_blank" 
            style="color:#2563eb;">7 روز آینده</a></b>
          </div>
        </div>
        <div class="peak-tracks-slot"></div>
        <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; direction:ltr;">
          <a href="https://www.wikiloc.com/wikiloc/map.do?sw=${peak.lat-0.1},${peak.lng-0.1}&ne=${peak.lat+0.1},${peak.lng+0.1}" 
            target="_blank" style="color:#2563eb;"><img src="wikiloc.ico" width="16"></a>
          <a href="https://www.google.com/maps?q=${peak.lat},${peak.lng}" target="_blank" 
          style="color:#2563eb;"><img src="maps.ico" width="16"></a>
          <a href="https://earth.google.com/web/@${peak.lat},${peak.lng},2000a" target="_blank" 
          style="color:#2563eb;"><img src="earth.ico" width="16"></a>
        </div>
      </div>
    `;

    // محتوا به‌صورت عنصر DOM ثابت داده می‌شود تا popup.update() بخش مسیرها را پاک نکند
    const content = document.createElement('div');
    content.innerHTML = popupContent;
    marker.bindPopup(content, { maxWidth: 320 });
    marker.on('popupopen', (e: L.PopupEvent) => {
      // پاپ‌آپ هیچ‌وقت بزرگ‌تر از نقشه نشود؛ اگر شد داخل خودش اسکرول می‌خورد
      // و با حاشیه‌ی autopan از زیر دکمه‌های زوم بیرون می‌ماند
      const size = map?.getSize() ?? L.point(900, 580);
      e.popup.options.maxHeight = Math.max(160, size.y - 90);
      // ~44px پدینگ پاپ‌آپ + 55px حاشیه‌ی چپ (دکمه‌های زوم) + 10px حاشیه‌ی راست
      e.popup.options.maxWidth = Math.max(180, Math.min(320, size.x - 109));
      e.popup.options.autoPanPaddingTopLeft = [55, 10];
      e.popup.options.autoPanPaddingBottomRight = [10, 10];
      e.popup.update();
      const slot = content.querySelector<HTMLElement>('.peak-tracks-slot');
      if (slot) void renderPeakTracks(slot, Number(peak.oid), () => e.popup.update());
    });
    marker.addTo(markersLayer!);
    bounds.push([peak.lat, peak.lng]);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds as L.LatLngBoundsExpression, {
      padding: [50, 50],
      maxZoom: 12,
    });
  }
}

export function clearMap() {
  if (markersLayer) {
    markersLayer.clearLayers();
  }
  clearTracks();
}