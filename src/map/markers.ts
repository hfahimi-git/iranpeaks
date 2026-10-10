import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = DefaultIcon;

export function createMarkers(map: L.Map, peaks: any[]) {
  peaks.forEach(peak => {
    const marker = L.marker([peak.lat, peak.lng], {
      title: peak.name,
    }).addTo(map);

    const html = `
      <div style="font-family: system-ui; min-width: 220px;">
        <strong>${peak.name}</strong><br>
        <small>${peak.ename || ''}</small><br><br>
        ارتفاع: <strong>${peak.height}</strong> متر<br>
        <small>${peak.states?.slice(0, 80) || ''}...</small>
      </div>
    `;

    marker.bindPopup(html, { closeButton: false, offset: [0, -10] });
  });
}