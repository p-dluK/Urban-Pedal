const districts = ["Ermelino Matarazzo", "Penha", "Ponte Rasa", "Cangaíba", "Vila Jacuí"];

const zoneBounds = L.latLngBounds([-23.565, -46.560], [-23.460, -46.415]);

const map = L.map('map', {
  zoomControl: true,
  maxBounds: zoneBounds,
  maxBoundsViscosity: 0.8,
  minZoom: 12,
  maxZoom: 18
}).setView([-23.512, -46.480], 13);

const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA)'
});

// Camada topográfica hipsométrica em tempo real
const elevationLayer = L.topoLayer({ range: [722, 820], opacity: 0.78 }).addTo(map);

// Ruas detalhadas por cima do mapa térmico, com mistura multiply para preservar as cores do relevo.
const streetDetail = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO', opacity: 0.78, className: 'street-detail', subdomains: 'abcd'
}).addTo(map);

let heatOn = true, origin = null, destination = null, currentElevation = null, selectedElevation = null, selectedPointMarker = null, elevationCache = new Map(), routeLine = null, userMarker = null, originMarker = null, destMarker = null, via = [], viaMarkers = [], choosingDest = false, watchId = null;

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; if ($('mapStatus')) $('mapStatus').textContent = t; };

// A busca começa recolhida para deixar o mapa térmico ocupar a tela.
$('searchToggleBtn').onclick = () => { $('searchPanel').hidden = false; $('searchToggleBtn').hidden = true; };
$('closeSearchBtn').onclick = () => { $('searchPanel').hidden = true; $('searchToggleBtn').hidden = false; };

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
    status('Selecione um ponto dentro dos distritos cobertos (ZL).');
    return;
  }
  queryElevation(e.latlng, true);
  if (choosingDest) { 
    destination = e.latlng; 
    $('destination').value = reverseName(destination); 
    destMarker = setMarker(destMarker, destination, 'Destino', '#dc4d4d'); 
    choosingDest = false; 
    status('Destino selecionado.'); 
    return; 
  }
  if (!origin) { 
    origin = e.latlng; 
    $('origin').value = reverseName(origin); 
    originMarker = setMarker(originMarker, origin, 'Origem', '#1685ff'); 
    status('Origem selecionada. Agora escolha o destino.'); 
    return; 
  }
  if (!destination) { 
    destination = e.latlng; 
    $('destination').value = reverseName(destination); 
    destMarker = setMarker(destMarker, destination, 'Destino', '#dc4d4d'); 
    status('Destino selecionado.'); 
    return; 
  }
  via.push(e.latlng); 
  renderVia(); 
  status(`Ponto intermediário ${via.length} adicionado. Recalculando...`); 
  calculateRoute();
});

$('pickDest').onclick = () => { choosingDest = true; status('Toque no mapa para escolher o destino.'); };
if($('originHere')) $('originHere').onclick = () => locate(true);
$('locateBtn').onclick = () => locate(true);

function locate(setAsOrigin = false) {
  if (!navigator.geolocation) { status('GPS não disponível neste navegador.'); return; }
  status('Obtendo localização GPS...');
  navigator.geolocation.getCurrentPosition(pos => {
    const p = L.latLng(pos.coords.latitude, pos.coords.longitude);
    if (!zoneBounds.contains(p)) {
      status('Sua localização está fora da zona monitorada da Zona Leste.');
      return;
    }
    queryElevation(p, false);
    userMarker = setMarker(userMarker, p, 'Sua localização', '#1685ff');
    map.setView(p, 16);
    if (setAsOrigin) { origin = p; $('origin').value = 'Minha localização atual'; originMarker = setMarker(originMarker, p, 'Origem', '#1685ff'); }
    status('Localização atualizada. Precisão aproximada: ' + Math.round(pos.coords.accuracy) + ' m.');
    if (!watchId) watchId = navigator.geolocation.watchPosition(updatePosition, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }, err => status('Não foi possível obter GPS: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
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
      if (!zoneBounds.contains(p)) { status('Localização fora da área de cobertura.'); return; }
      origin = p;
      originMarker = setMarker(originMarker, origin, 'Origem', '#1685ff');
      map.setView(origin, 15);
    }
  } catch (_) { status('Não foi possível localizar a origem.'); }
});

$('routeBtn').onclick = calculateRoute;
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
  if (!origin || !destination) { status('Defina origem e destino primeiro.'); return; }
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
    $('routeInfo').innerHTML = `<b>Rota para bicicleta</b><br>Distância aproximada: <b>${km ? km.toFixed(2) + ' km' : 'consulte o traçado'}</b><br>Paradas: ${via.length}`;
    status('Rota calculada com sucesso.');
  } catch (e) { status('Não foi possível calcular: ' + e.message); }
}

$('heatBtn').onclick = () => {
  heatOn = !heatOn;
  $('heatBtn').classList.toggle('active', heatOn);
  if (heatOn) map.addLayer(elevationLayer);
  else map.removeLayer(elevationLayer);
};

$('layersBtn').onclick = () => {
  if (map.hasLayer(topoMap)) { map.removeLayer(topoMap); street.addTo(map); }
  else { map.removeLayer(street); topoMap.addTo(map); }
};

async function getElevation(p) {
  const key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  if (elevationCache.has(key)) return elevationCache.get(key);
  const r = await fetch('https://api.opentopodata.org/v1/mapzen?locations=' + encodeURIComponent(key));
  if (!r.ok) throw Error('Fonte topográfica indisponível');
  const d = await r.json(), v = d.results?.[0]?.elevation;
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
    status('Não foi possível consultar a altitude no ponto.');
  }
}

function updateElevationDifference() {
  if (currentElevation === null || selectedElevation === null) return;
  const d = selectedElevation - currentElevation, s = d > 0 ? '+' : '';
  $('elevDiff').textContent = s + d + ' m ' + (d > 0 ? 'acima' : d < 0 ? 'abaixo' : 'na mesma altitude');
  $('elevDiff').style.color = d > 0 ? '#b65b24' : d < 0 ? '#176b47' : '#52645a';
}
