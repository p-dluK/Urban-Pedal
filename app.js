const districts = ["Ermelino Matarazzo", "Penha", "Ponte Rasa", "Cangaíba", "Vila Jacuí"];

// Limites geográficos restritos estritamente à região dos 5 distritos
const zoneBounds = L.latLngBounds(
  [-23.565, -46.560], // Sudoeste (Sul / Oeste)
  [-23.460, -46.415]  // Nordeste (Norte / Leste)
);

// Inicializa o mapa ocupando a tela inteira
const map = L.map('map', {
  zoomControl: false,
  maxBounds: zoneBounds,
  maxBoundsViscosity: 0.8,
  minZoom: 12,
  maxZoom: 18
}).setView([-23.512, -46.480], 13);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap'
}); 

let heatOn = true, origin = null, destination = null, currentElevation = null, selectedElevation = null, selectedPointMarker = null, elevationCache = new Map(), routeLine = null, userMarker = null, originMarker = null, destMarker = null, via = [], viaMarkers = [], choosingDest = false, watchId = null, elevationLayer = null, heatBusy = false;

const $ = id => document.getElementById(id), status = t => $('status').textContent = t;

// Controle da Janela Flutuante (Modal)
const modal = $('searchModal');
const openModal = () => modal.classList.remove('hidden');
const closeModal = () => modal.classList.add('hidden');

$('searchToggleBtn').onclick = openModal;
$('closeModalBtn').onclick = closeModal;

const setMarker = (old, p, label, color) => {
  if (old) map.removeLayer(old);
  return L.circleMarker(p, { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map).bindPopup(label);
};

function reverseName(p) { return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; }
function clearViaMarkers() { viaMarkers.forEach(m => map.removeLayer(m)); viaMarkers = []; }
function renderVia() { 
  clearViaMarkers(); 
  via.forEach((p, i) => viaMarkers.push(L.marker(p).addTo(map).bindPopup(`Parada ${i+1} <button onclick="removeVia(${i})">Remover</button>`))); 
}

window.removeVia = i => { via.splice(i, 1); renderVia(); if (origin && destination) calculateRoute(); };

map.on('click', e => {
  if (!zoneBounds.contains(e.latlng)) {
    status('Selecione um ponto dentro da área coberta da Zona Leste.');
    return;
  }
  queryElevation(e.latlng, true);
  if (choosingDest) { 
    destination = e.latlng; 
    $('destination').value = reverseName(destination); 
    destMarker = setMarker(destMarker, destination, 'Destino', '#dc4d4d'); 
    choosingDest = false; 
    status('Destino selecionado via mapa.'); 
    openModal();
    return; 
  }
  if (!origin) { 
    origin = e.latlng; 
    $('origin').value = reverseName(origin); 
    originMarker = setMarker(originMarker, origin, 'Origem', '#1685ff'); 
    status('Origem definida no mapa.'); 
    return; 
  }
  if (!destination) { 
    destination = e.latlng; 
    $('destination').value = reverseName(destination); 
    destMarker = setMarker(destMarker, destination, 'Destino', '#dc4d4d'); 
    status('Destino definido no mapa.'); 
    return; 
  }
  via.push(e.latlng); 
  renderVia(); 
  status(`Ponto intermediário ${via.length} adicionado. Recalculando...`); 
  calculateRoute();
});

$('pickDest').onclick = () => { choosingDest = true; closeModal(); status('Toque no mapa para escolher o destino.'); };
$('originHere').onclick = () => locate(true);
$('locateBtn').onclick = () => locate(true);

function locate(setAsOrigin = false) {
  if (!navigator.geolocation) { status('GPS não disponível.'); return; }
  status('Obtendo localização GPS...');
  navigator.geolocation.getCurrentPosition(pos => {
    const p = L.latLng(pos.coords.latitude, pos.coords.longitude);
    if (!zoneBounds.contains(p)) {
      status('Sua localização está fora dos distritos cobertos.');
      return;
    }
    queryElevation(p, false);
    userMarker = setMarker(userMarker, p, 'Sua localização', '#1685ff');
    map.setView(p, 16);
    if (setAsOrigin) { origin = p; $('origin').value = 'Minha localização atual'; originMarker = setMarker(originMarker, p, 'Origem', '#1685ff'); }
    status('Localização GPS atualizada (' + Math.round(pos.coords.accuracy) + 'm de precisão).');
    if (!watchId) watchId = navigator.geolocation.watchPosition(updatePosition, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }, err => status('Erro no GPS: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
}

function updatePosition(pos) {
  const p = L.latLng(pos.coords.latitude, pos.coords.longitude);
  if (!zoneBounds.contains(p)) return;
  userMarker = setMarker(userMarker, p, 'Sua localização', '#1685ff');
  if (!window.lastElevPosition || map.distance(p, window.lastElevPosition) > 35) {
    window.lastElevPosition = p;
    queryElevation(p, false);
  }
}

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&viewbox=-46.56,-23.46,-46.41,-23.56&bounded=1&q=' + encodeURIComponent(q + ', São Paulo');
  const r = await fetch(url);
  if (!r.ok) throw Error('Busca indisponível');
  return r.json();
}

$('destination').addEventListener('input', async e => {
  const q = e.target.value.trim();
  if (q.length < 4) return;
  try {
    const results = await geocode(q);
    $('suggestions').innerHTML = '';
    results.forEach(x => {
      const p = L.latLng(+x.lat, +x.lon);
      if (!zoneBounds.contains(p)) return;
      const b = document.createElement('button');
      b.textContent = x.display_name;
      b.onclick = () => {
        destination = p;
        $('destination').value = x.display_name;
        $('suggestions').innerHTML = '';
        destMarker = setMarker(destMarker, destination, 'Destino', '#dc4d4d');
        map.setView(destination, 16);
      };
      $('suggestions').appendChild(b);
    });
  } catch (_) {}
});

$('origin').addEventListener('change', async e => {
  if (e.target.value.toLowerCase().includes('localização')) return;
  try {
    const r = await geocode(e.target.value);
    if (r[0]) {
      const p = L.latLng(+r[0].lat, +r[0].lon);
      if (!zoneBounds.contains(p)) { status('Localização fora da área coberta.'); return; }
      origin = p;
      originMarker = setMarker(originMarker, origin, 'Origem', '#1685ff');
      map.setView(origin, 15);
    }
  } catch (_) { status('Não foi possível localizar a origem.'); }
});

$('routeBtn').onclick = () => { closeModal(); calculateRoute(); };
$('clearBtn').onclick = () => {
  origin = destination = null;
  via = [];
  clearViaMarkers();
  [routeLine, originMarker, destMarker].forEach(x => x && map.removeLayer(x));
  routeLine = originMarker = destMarker = null;
  $('origin').value = '';
  $('destination').value = '';
  $('routeInfo').hidden = true;
  status('Rota limpa.');
};

async function calculateRoute() {
  if (!origin || !destination) { status('Defina origem e destino primeiro.'); openModal(); return; }
  status('Calculando rota para bicicleta...');
  const points = [origin, ...via, destination].map(p => `${p.lng},${p.lat}`).join('|');
  const url = `https://brouter.de/brouter?lonlats=${encodeURIComponent(points)}&profile=trekking&alternativeidx=0&format=geojson`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw Error('Serviço de rotas indisponível');
    const data = await r.json();
    if (!data.features?.length) throw Error('Nenhuma rota encontrada');
    const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(coords, { color: '#1469e8', weight: 6, opacity: .9 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [35, 35] });
    const props = data.features[0].properties || {}, km = (props['track-length'] || props['total-distance'] || 0) / 1000;
    $('routeInfo').hidden = false;
    $('routeInfo').innerHTML = `<b>Rota para bicicleta</b> · Distância: <b>${km ? km.toFixed(2) + ' km' : 'OK'}</b><br><small>Toque em uma rua para adicionar parada intermediária.</small>`;
    status('Rota calculada com sucesso.');
  } catch (e) { status('Erro na rota: ' + e.message); }
}

$('heatBtn').onclick = () => {
  heatOn = !heatOn;
  $('heatBtn').classList.toggle('active', heatOn);
  if (heatOn) {
    if (elevationLayer) elevationLayer.addTo(map);
    else loadElevation();
  } else if (elevationLayer) {
    map.removeLayer(elevationLayer);
  }
};

$('layersBtn').onclick = () => {
  if (map.hasLayer(topo)) { map.removeLayer(topo); street.addTo(map); }
  else { map.removeLayer(street); topo.addTo(map); }
};

async function getElevation(p) {
  const key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  if (elevationCache.has(key)) return elevationCache.get(key);
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${p.lat}&longitude=${p.lng}`);
    if (r.ok) {
      const d = await r.json();
      if (d.elevation && d.elevation.length > 0) {
        const val = Math.round(d.elevation[0]);
        elevationCache.set(key, val);
        return val;
      }
    }
  } catch (_) {}
  
  // Fallback para opentopodata se open-meteo falhar
  const r2 = await fetch('https://api.opentopodata.org/v1/mapzen?locations=' + encodeURIComponent(key));
  if (!r2.ok) throw Error('Fonte topográfica indisponível');
  const d2 = await r2.json(), v = d2.results?.[0]?.elevation;
  if (v === null || v === undefined) throw Error('Sem dado de altitude');
  elevationCache.set(key, Math.round(v));
  return Math.round(v);
}

async function queryElevation(p, isSelected) {
  try {
    const v = await getElevation(p);
    if (isSelected) {
      selectedElevation = v;
      selectedPointMarker = setMarker(selectedPointMarker, p, `Ponto selecionado: ${v} m`, '#e3a52d');
      $('elevationInfo').hidden = false;
      $('selectedElev').textContent = v + ' m';
    } else {
      currentElevation = v;
      $('elevationInfo').hidden = false;
      $('currentElev').textContent = v + ' m';
    }
    updateElevationDifference();
  } catch (e) {
    status('Não foi possível consultar a altitude agora.');
  }
}

function updateElevationDifference() {
  if (currentElevation === null || selectedElevation === null) return;
  const d = selectedElevation - currentElevation, s = d > 0 ? '+' : '';
  $('elevDiff').textContent = s + d + ' m ' + (d > 0 ? 'acima da sua posição' : d < 0 ? 'abaixo da sua posição' : 'na mesma altitude');
  $('elevDiff').style.color = d > 0 ? '#b65b24' : d < 0 ? '#176b47' : '#52645a';
}

async function fetchElevationsBatch(pts) {
  // Chamada via Open-Meteo API (rápida, sem rate-limit estrito e em 1 só pacote)
  try {
    const lats = pts.map(p => p[0].toFixed(5)).join(',');
    const lons = pts.map(p => p[1].toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      if (data && data.elevation && data.elevation.length === pts.length) {
        return data.elevation;
      }
    }
  } catch (err) {
    console.warn("Open-Meteo falhou, tentando OpenTopoData fallback...", err);
  }

  // Fallback OpenTopoData com delay de segurança
  const vals = [];
  for (let i = 0; i < pts.length; i += 50) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200));
    const part = pts.slice(i, i + 50);
    const loc = part.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join('|');
    const r = await fetch('https://api.opentopodata.org/v1/mapzen?locations=' + encodeURIComponent(loc));
    if (!r.ok) throw Error('Limite de requisições da API ativado. Tente novamente em instantes.');
    const d = await r.json();
    if (!d.results || d.results.length !== part.length) throw Error('Resposta incompleta da API');
    vals.push(...d.results.map(x => x.elevation));
  }
  return vals;
}

async function loadElevation() {
  if (heatBusy) return;
  heatBusy = true;
  status('Carregando mapa térmico de altitude...');
  
  const b = zoneBounds, rows = 22, cols = 26, pts = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lat = b.getNorth() - (b.getNorth() - b.getSouth()) * y / (rows - 1);
      const lon = b.getWest() + (b.getEast() - b.getWest()) * x / (cols - 1);
      pts.push([lat, lon]);
    }
  }

  try {
    const vals = await fetchElevationsBatch(pts);
    if (!vals || vals.some(v => v === null || v === undefined || !Number.isFinite(v))) {
      throw Error('Amostras de elevação inválidas');
    }

    const min = 700, max = 850;
    
    const scale = 8, width = (cols - 1) * scale + 1, height = (rows - 1) * scale + 1;
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    const pixels = ctx.createImageData(width, height);
    
    const stops = [
      [0.00, [10,  80, 160]], // Azul (700m)
      [0.20, [30, 160, 200]], // Ciano
      [0.40, [50, 200, 100]], // Verde
      [0.60, [220, 210, 40]], // Amarelo
      [0.80, [240, 120, 30]], // Laranja
      [1.00, [200,  30, 50]]  // Vermelho (850m+)
    ];

    for (let py = 0; py < height; py++) {
      const gy = py / scale, y0 = Math.min(rows - 1, Math.floor(gy)), y1 = Math.min(rows - 1, y0 + 1), fy = gy - y0;
      for (let px = 0; px < width; px++) {
        const gx = px / scale, x0 = Math.min(cols - 1, Math.floor(gx)), x1 = Math.min(cols - 1, x0 + 1), fx = gx - x0;
        const a = vals[y0 * cols + x0], bb = vals[y0 * cols + x1], cc = vals[y1 * cols + x0], dd = vals[y1 * cols + x1];
        let elev = (a * (1 - fx) + bb * fx) * (1 - fy) + (cc * (1 - fx) + dd * fx) * fy;
        
        let t = (elev - min) / (max - min);
        t = Math.max(0, Math.min(1, t));

        let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
        const f = Math.max(0, Math.min(1, (t - stops[k][0]) / (stops[k + 1][0] - stops[k][0])));
        const color = stops[k][1].map((v, i) => Math.round(v + (stops[k + 1][1][i] - v) * f));
        
        const index = (py * width + px) * 4;
        pixels.data[index] = color[0];
        pixels.data[index + 1] = color[1];
        pixels.data[index + 2] = color[2];
        pixels.data[index + 3] = 175;
      }
    }
    ctx.putImageData(pixels, 0, 0);

    if (elevationLayer) map.removeLayer(elevationLayer);
    elevationLayer = L.imageOverlay(c.toDataURL(), zoneBounds, { opacity: 0.85, interactive: false });
    if (heatOn) elevationLayer.addTo(map);

    status(`Mapa térmico de altitude ativo (700m a 850m).`);
  } catch (e) {
    console.error(e);
    status('Erro ao carregar altitude: ' + (e.message || 'Servidor indisponível no momento.'));
  } finally {
    heatBusy = false;
  }
}

loadElevation();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}