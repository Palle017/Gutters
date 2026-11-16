// Where's my gutter guy? Live radar of John's last known position.
// DATA_URL is the single place to point the page at a location feed.
const DATA_URL = 'https://gutter-guy.prudhvi-tools.workers.dev/where';
const FALLBACK_URL = 'data/gutter-guy.json';
const REFRESH_MS = 30000;

(() => {
  const $ = id => document.getElementById(id);
  const map = L.map('gg-map', {zoomControl: false, attributionControl: true}).setView([26.64, -81.87], 15);
  L.control.zoom({position: 'topright'}).addTo(map);
  // No-key OpenStreetMap tiles, darkened in CSS (.gg-dark-tiles).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'gg-dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const radar = L.marker([26.64, -81.87], {interactive: false, keyboard: false, icon: L.divIcon({
    className: 'gg-radar-icon', iconSize: [420, 420], iconAnchor: [210, 210],
    html: '<div class="gg-radar"><i class="gg-ring r1"></i><i class="gg-ring r2"></i><i class="gg-ring r3"></i><i class="gg-sweep"></i></div>'
  })}).addTo(map);
  const accuracy = L.circle([26.64, -81.87], {radius: 0, color: '#3df5a0', weight: 1, opacity: .7, fillColor: '#3df5a0', fillOpacity: .08, interactive: false}).addTo(map);
  const dot = L.marker([26.64, -81.87], {title: 'John', icon: L.divIcon({
    className: 'gg-dot-icon', iconSize: [28, 28], iconAnchor: [14, 14],
    html: '<span class="gg-pulse"></span><span class="gg-dot"></span><span class="gg-tag">JOHN</span>'
  })}).addTo(map);

  let last = null, centered = false, follow = true;

  function ago(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return 'time unknown';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 48) return h + ' hr ' + (m % 60) + ' min ago';
    return Math.floor(h / 24) + ' days ago';
  }
  function paintSeen() {
    if (!last) return;
    $('gg-seen').textContent = 'Last seen ' + ago(last.updated);
    const age = Date.now() - Date.parse(last.updated);
    $('gg-led').className = 'gg-led ' + (age < 15 * 60e3 ? 'live' : age < 2 * 3600e3 ? 'recent' : 'stale');
  }
  function valid(data) {
    return data && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng)) && Math.abs(data.lat) <= 90 && Math.abs(data.lng) <= 180;
  }
  async function get(url) {
    const response = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), {cache: 'no-store'});
    if (!response.ok) throw Error(url + ' ' + response.status);
    const data = await response.json();
    if (!valid(data)) throw Error('bad location');
    return data;
  }
  function show(data) {
    const pos = [Number(data.lat), Number(data.lng)];
    last = {lat: pos[0], lng: pos[1], acc: Number(data.acc) || 0, updated: data.updated};
    dot.setLatLng(pos); radar.setLatLng(pos); accuracy.setLatLng(pos).setRadius(last.acc);
    $('gg-coords').textContent = pos[0].toFixed(5) + ', ' + pos[1].toFixed(5) + (last.acc ? ' · ±' + Math.round(last.acc) + ' m' : '');
    $('gg-directions').href = 'https://www.google.com/maps/dir/?api=1&destination=' + pos[0] + ',' + pos[1];
    if (!centered || follow) { map.setView(pos, centered ? map.getZoom() : 16, {animate: centered}); centered = true; }
    paintSeen();
  }
  async function refresh() {
    try { show(await get(DATA_URL)); }
    catch {
      try { show(await get(FALLBACK_URL)); }
      catch { if (!last) $('gg-seen').textContent = 'John’s radar is offline. Call him instead.'; }
    }
  }
  map.on('dragstart', () => { follow = false; });
  $('gg-center').addEventListener('click', () => {
    follow = true;
    if (last) map.flyTo([last.lat, last.lng], Math.max(map.getZoom(), 16), {duration: .8});
  });
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(paintSeen, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
