const districts = ["Ermelino Matarazzo", "Penha", "Ponte Rasa", "Cangaíba", "Vila Jacuí"];

const zoneBounds = L.latLngBounds([-23.565, -46.560], [-23.460, -46.415]);

const map = L.map('map', {
  zoomControl: false,
  rotate: true,
  touchRotate: true,
  shiftKeyRotate: true,
  dragRotate: true,
  maxBounds: zoneBounds,
  maxBoundsViscosity: 0.8,
  minZoom: 12,
  maxZoom: 18
}).setView([-23.512, -46.480], 13);

map.createPane('streetDetailPane');
map.getPane('streetDetailPane').style.zIndex = 250;
map.createPane('elevationPane');
map.getPane('elevationPane').style.zIndex = 300;

const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA)'
});

const elevationLayer = L.topoLayer({ range: [722, 820], opacity: 0.78, pane: 'elevationPane' }).addTo(map);

const streetDetail = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO', opacity: 0.78, className: 'street-detail', subdomains: 'abcd', pane: 'streetDetailPane'
}).addTo(map);

let heatOn = true, origin = null, destination = null, currentElevation = null, selectedElevation = null, selectedPointMarker = null, elevationCache = new Map(), routeLine = null, userMarker = null, originMarker = null, destMarker = null, via = [], viaMarkers = [], choosingDest = false, watchId = null;

const $ = id => document.getElementById(id);
const status = t => { if ($('status')) $('status').textContent = t; };

$('settingsToggleBtn').addEventListener('click', () => {
  const menu = $('settingsMenu'); menu.hidden = !menu.hidden;
  $('settingsToggleBtn').setAttribute('aria-expanded', String(!menu.hidden));
});

$('searchToggleBtn').onclick = () => { $('searchPanel').hidden = false; $('searchToggleBtn').hidden = true; };
$('closeSearchBtn').onclick = () => { $('searchPanel').hidden = true; $('searchToggleBtn').hidden = false; };

if($('quickLocateBtn')) $('quickLocateBtn').onclick = () => locate(true);

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
  if (window.markerMode) return;
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

const rideStoreKey = 'urban-pedal-rides-v1';
const markerStoreKey = 'urban-pedal-markers-v1';
let rideActive = false, ridePaused = false, rideStartedAt = 0, rideElapsedBefore = 0, rideTimer = null;
let rideCoords = [], rideDistanceMeters = 0, lastRidePoint = null, rideLine = null, rideDeliveries = [], activeDelivery = null;
window.markerMode = null; 
let savedMarkers = [];

function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { status('Armazenamento cheio: não foi possível salvar tudo.'); } }

function fmtTimeShort(ms) { 
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}H${m.toString().padStart(2, '0')}`;
  return `${m}MIN`;
}

function fmtTime(ms) { 
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; 
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':'); 
}

function elapsedRide() { return rideElapsedBefore + (rideActive && !ridePaused ? Date.now() - rideStartedAt : 0); }

function updateRideHud() {
  const dTot = document.getElementById('rideDistanceTotal');
  const tTot = document.getElementById('rideTimeTotal');
  const dDel = document.getElementById('rideDistanceDelivery');
  const tDel = document.getElementById('rideTimeDelivery');

  const totalKm = (rideDistanceMeters / 1000).toFixed(1).replace('.', ',');
  if (dTot) dTot.textContent = `${totalKm}KM`;
  if (tTot) tTot.textContent = fmtTimeShort(elapsedRide());

  if (activeDelivery && activeDelivery.accepted) {
    const startPoint = activeDelivery.retired || activeDelivery.accepted;
    const currentPos = currentRideLocation();
    let delKm = 0;
    if (startPoint && currentPos) {
      delKm = map.distance([startPoint.lat, startPoint.lng], [currentPos.lat, currentPos.lng]) / 1000;
    }
    const delTime = Date.now() - activeDelivery.accepted.time;
    if (dDel) dDel.textContent = `${delKm.toFixed(1).replace('.', ',')}KM`;
    if (tDel) tDel.textContent = fmtTimeShort(delTime);
  } else {
    if (dDel) dDel.textContent = `0,0KM`;
    if (tDel) tDel.textContent = `0MIN`;
  }
}

function saveActiveRide() {
  if(!rideActive)return;
  writeStore('urban-pedal-active-v1',{startedAt:Date.now()-elapsedRide(),coords:rideCoords,distance:rideDistanceMeters,deliveries:rideDeliveries,activeDelivery,paused:ridePaused,elapsed:elapsedRide()});
}

function updateDeliveryStepState() {
  const btnAccept = document.getElementById('acceptDeliveryBtn');
  const btnRetire = document.getElementById('retireDeliveryBtn');
  const btnDeliver = document.getElementById('deliverDeliveryBtn');
  if(!btnAccept || !btnRetire || !btnDeliver) return;

  if(!rideActive || ridePaused) {
    btnAccept.disabled = true;
    btnRetire.disabled = true;
    btnDeliver.disabled = true;
    return;
  }

  if(!activeDelivery) {
    btnAccept.disabled = false;
    btnRetire.disabled = true;
    btnDeliver.disabled = true;
  } else {
    if(!activeDelivery.accepted) {
      btnAccept.disabled = false;
      btnRetire.disabled = true;
      btnDeliver.disabled = true;
    } else if(!activeDelivery.retired) {
      btnAccept.disabled = true;
      btnRetire.disabled = false;
      btnDeliver.disabled = true;
    } else if(!activeDelivery.delivered) {
      btnAccept.disabled = true;
      btnRetire.disabled = true;
      btnDeliver.disabled = false;
    }
  }
}

function setRideControls() {
  const active = rideActive;
  document.getElementById('startStateWrap').hidden = active;
  document.getElementById('activeStateWrap').hidden = !active;

  const pauseBtn = document.getElementById('pauseRideBtn');
  if (pauseBtn) {
    pauseBtn.textContent = ridePaused ? '▶' : 'Ⅱ';
    pauseBtn.setAttribute('aria-label', ridePaused ? 'Retomar' : 'Pausar');
  }

  updateDeliveryStepState();
  updateRideHud();
}

function startRide() {
  if(!navigator.geolocation){status('GPS não disponível.');return;}
  if(watchId!==null)navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(onRidePosition,err=>status('Falha no GPS: '+err.message),{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  rideActive=true;ridePaused=false;rideStartedAt=Date.now();document.body.classList.add('pedal-mode');
  if(document.getElementById('searchPanel')){document.getElementById('searchPanel').hidden=true;document.getElementById('searchToggleBtn').hidden=false;}
  setRideControls();
  rideTimer=setInterval(()=>{updateRideHud();saveActiveRide();},1000);
  status('Modo Pedal iniciado.');updateRideHud();saveActiveRide();
}

function onRidePosition(pos) {
  const p=L.latLng(pos.coords.latitude,pos.coords.longitude);
  if(!zoneBounds.contains(p))return;
  updatePosition(pos);
  if(!rideActive || ridePaused || pos.coords.accuracy>35)return;
  if(lastRidePoint){
    const delta=map.distance(lastRidePoint,p);
    const dt=Math.max(1,(pos.timestamp-lastRidePoint.time)/1000);
    if(delta<4 || delta/dt>12.5)return;
    rideDistanceMeters+=delta;
  }
  const item={lat:p.lat,lng:p.lng,time:pos.timestamp||Date.now()};
  rideCoords.push(item);lastRidePoint={...p,time:item.time};
  if(rideLine)map.removeLayer(rideLine);
  if(rideCoords.length>1)rideLine=L.polyline(rideCoords.map(c=>[c.lat,c.lng]),{color:'#00e5ff',weight:5,opacity:.95}).addTo(map);
  updateRideHud();saveActiveRide();
}

function currentRideLocation() {
  if(userMarker && map.hasLayer(userMarker)) return userMarker.getLatLng();
  if(lastRidePoint) return L.latLng(lastRidePoint.lat,lastRidePoint.lng);
  if(rideCoords.length){const p=rideCoords[rideCoords.length-1];return L.latLng(p.lat,p.lng);}
  return null;
}

function eventPoint() {
  const p=currentRideLocation();
  if(!p){status('Aguardando uma posição GPS válida para registrar.');return null;}
  return {lat:p.lat,lng:p.lng,time:Date.now()};
}

function acceptDelivery() {
  if(!rideActive||ridePaused){status('Retome o Modo Pedal para registrar uma entrega.');return;}
  if(activeDelivery){status('Já existe uma entrega em andamento.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery={id:Date.now(),accepted:point,retired:null,delivered:null,value:null};
  rideDeliveries.push(activeDelivery);
  saveActiveRide();
  updateDeliveryStepState();
  updateRideHud();
  status('Entrega aceita.');
}

function retireDelivery() {
  if(!rideActive||ridePaused){status('Retome o Modo Pedal para registrar a retirada.');return;}
  if(!activeDelivery){status('Toque em ACEITEI antes de registrar a retirada.');return;}
  if(activeDelivery.retired){status('A retirada desta entrega já foi registrada.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery.retired=point;
  saveActiveRide();
  updateDeliveryStepState();
  updateRideHud();
  status('Retirada registrada.');
}

function deliverDelivery() {
  if(!rideActive||ridePaused){status('Retome o Modo Pedal para registrar a entrega.');return;}
  if(!activeDelivery){status('Toque em ACEITEI antes de registrar a entrega.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery.delivered=point;
  
  const rides=readStore(rideStoreKey,[]);
  let targetSession = rides.find(x => x.activeSession);
  
  if(!targetSession) {
    targetSession = {id:Date.now(),date:new Date().toISOString(),duration:elapsedRide(),distance:rideDistanceMeters,coords:rideCoords,deliveries:[...rideDeliveries],activeSession:true};
    rides.unshift(targetSession);
  } else {
    targetSession.deliveries = rideDeliveries.map((d, idx) => {
      const existing = targetSession.deliveries && targetSession.deliveries[idx];
      return { ...d, value: existing && existing.value !== undefined ? existing.value : d.value };
    });
    targetSession.distance = rideDistanceMeters;
    targetSession.duration = elapsedRide();
  }
  
  writeStore(rideStoreKey,rides.slice(0,100));
  
  activeDelivery = null;
  saveActiveRide();
  updateDeliveryStepState();
  updateRideHud();
  renderRideHistory();
  status('Entrega concluída e adicionada ao histórico!');
}

function toggleRidePause() {
  if(!rideActive)return;
  if(!ridePaused){rideElapsedBefore=elapsedRide();ridePaused=true;status('Registro pausado.');}
  else {ridePaused=false;rideStartedAt=Date.now();status('Registro retomado.');}
  setRideControls();updateRideHud();saveActiveRide();
}

function stopRide() {
  if(!rideActive)return;
  rideElapsedBefore=elapsedRide();rideActive=false;ridePaused=false;clearInterval(rideTimer);rideTimer=null;
  const rides=readStore(rideStoreKey,[]);
  const index = rides.findIndex(x => x.activeSession);
  if(index !== -1) {
    delete rides[index].activeSession;
    rides[index].distance = rideDistanceMeters;
    rides[index].duration = rideElapsedBefore;
    rides[index].deliveries = rideDeliveries.map((d, idx) => {
      const existing = rides[index].deliveries && rides[index].deliveries[idx];
      return { ...d, value: existing && existing.value !== undefined ? existing.value : d.value };
    });
  } else {
    const record={id:Date.now(),date:new Date().toISOString(),duration:rideElapsedBefore,distance:rideDistanceMeters,coords:rideCoords,deliveries:rideDeliveries};
    rides.unshift(record);
  }
  writeStore(rideStoreKey,rides.slice(0,100));
  localStorage.removeItem('urban-pedal-active-v1');
  if(rideLine){map.removeLayer(rideLine);rideLine=null;}
  if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=navigator.geolocation.watchPosition(updatePosition,()=>{},{enableHighAccuracy:true,maximumAge:5000});}
  document.body.classList.remove('pedal-mode');setRideControls();
  status(`Pedalada salva: ${(rideDistanceMeters/1000).toFixed(2)} km · ${fmtTime(rideElapsedBefore)}.`);
  rideCoords=[];rideDistanceMeters=0;lastRidePoint=null;rideElapsedBefore=0;rideStartedAt=0;rideDeliveries=[];activeDelivery=null;updateRideHud();renderRideHistory();
}

document.getElementById('rideButton').addEventListener('click',startRide);
document.getElementById('endRideBtn').addEventListener('click',stopRide);
document.getElementById('pauseRideBtn').addEventListener('click',toggleRidePause);
document.getElementById('acceptDeliveryBtn').addEventListener('click',acceptDelivery);
document.getElementById('retireDeliveryBtn').addEventListener('click',retireDelivery);
document.getElementById('deliverDeliveryBtn').addEventListener('click',deliverDelivery);

(function restoreActiveRide(){
  const a=readStore('urban-pedal-active-v1',null);if(!a)return;
  rideCoords=a.coords||[];rideDistanceMeters=a.distance||0;rideElapsedBefore=a.elapsed||Math.max(0,Date.now()-(a.startedAt||Date.now()));
  rideDeliveries=a.deliveries||[];activeDelivery=a.activeDelivery||null;
  if(rideCoords.length){lastRidePoint={...rideCoords[rideCoords.length-1],time:rideCoords[rideCoords.length-1].time};rideLine=L.polyline(rideCoords.map(c=>[c.lat,c.lng]),{color:'#00e5ff',weight:5,opacity:.95}).addTo(map);}
  updateRideHud();
  if(rideActive) setRideControls();
})();

const markerTypes={
 hole:{label:'Buraco',emoji:'🕳️',color:'#e53935'},
 danger:{label:'Rua perigosa',emoji:'⚠️',color:'#f57c00'},
 hill:{label:'Ladeira',emoji:'⛰️',color:'#8e24aa'},
 stairs:{label:'Escadaria',emoji:'🚧',color:'#546e7a'},
 avoid:{label:'Não quero ir',emoji:'🚫',color:'#212121'}
};
function renderSavedMarkers(){
  savedMarkers.forEach(m=>{if(m.layer && map.hasLayer(m.layer)) map.removeLayer(m.layer);});
  const records=readStore(markerStoreKey,[]);
  savedMarkers=records.map(m=>{
    const marker=L.marker([m.lat,m.lng],{icon:L.divIcon({className:'saved-marker',html:markerTypes[m.type]?.emoji||'📍',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
    const safeNote=(m.note||'Sem observação').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    marker.bindPopup(`<div class="saved-marker-popup"><b>${markerTypes[m.type]?.label||'Marcador'}</b><br>${safeNote}<br><button type="button" class="delete-saved-marker" data-marker-id="${String(m.id)}">Excluir marcador</button></div>`);
    marker.on('popupopen',ev=>{
      const btn=ev.popup.getElement()?.querySelector('.delete-saved-marker'); if(!btn)return;
      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click',()=>{
        const id=btn.getAttribute('data-marker-id');
        const next=readStore(markerStoreKey,[]).filter(item=>String(item.id)!==String(id));
        writeStore(markerStoreKey,next); renderSavedMarkers(); map.closePopup(); status('Marcador excluído.');
      },{once:true});
    });
    return {...m,layer:marker};
  });
}
document.getElementById('markerModeBtn').addEventListener('click',()=>{document.getElementById('markerMenu').hidden=!document.getElementById('markerMenu').hidden;});
document.querySelectorAll('[data-marker]').forEach(b=>b.addEventListener('click',()=>{window.markerMode=b.dataset.marker;document.getElementById('markerMenu').hidden=true;status('Toque no mapa para posicionar: '+markerTypes[window.markerMode].label+'.');}));
document.getElementById('cancelMarker').addEventListener('click',()=>{window.markerMode=null;document.getElementById('markerMenu').hidden=true;});

map.on('click',e=>{
  if(!window.markerMode)return;
  const type=window.markerMode;window.markerMode=null;
  const note=prompt('Observação opcional para '+markerTypes[type].label+':','');
  const arr=readStore(markerStoreKey,[]);
  arr.push({id:Date.now(),type,lat:e.latlng.lat,lng:e.latlng.lng,note:note||''});
  writeStore(markerStoreKey,arr);renderSavedMarkers();status('Marcador salvo no mapa.');
});
renderSavedMarkers();

document.getElementById('layersBtn').addEventListener('click',()=>{const m=document.getElementById('layersMenu');m.hidden=!m.hidden;});
document.getElementById('streetDetailToggle').addEventListener('change',e=>e.target.checked?streetDetail.addTo(map):map.removeLayer(streetDetail));
document.getElementById('heatToggle').addEventListener('change',e=>{heatOn=e.target.checked;document.getElementById('heatBtn').classList.toggle('active',heatOn);heatOn?elevationLayer.addTo(map):map.removeLayer(elevationLayer);});
document.getElementById('baseToggle').addEventListener('change',e=>{if(map.hasLayer(topoMap))map.removeLayer(topoMap);if(map.hasLayer(street))map.removeLayer(street);(e.target.checked?street:topoMap).addTo(map);});

window.deleteRideRecord = function(rideId) {
  if (!confirm("Deseja realmente excluir esta pedalada do histórico?")) return;
  let rides = readStore(rideStoreKey, []);
  rides = rides.filter(r => r.id !== rideId);
  writeStore(rideStoreKey, rides);
  if (window.historyRoute) map.removeLayer(window.historyRoute);
  if (window.historyEventMarkers) window.historyEventMarkers.forEach(m => map.removeLayer(m));
  renderRideHistory();
  status("Pedalada excluída.");
};

function eventIcon(emoji){return L.divIcon({className:'ride-event-marker',html:emoji,iconSize:[30,30],iconAnchor:[15,15]});}

function renderRideHistory(){
  const box=document.getElementById('historyList'),rides=readStore(rideStoreKey,[]);
  if(!box)return;
  box.innerHTML=rides.length?'':'<p>Nenhuma pedalada salva ainda.</p>';
  rides.forEach(r=>{
    const row=document.createElement('div');row.className='history-item';
    const date=new Date(r.date).toLocaleString('pt-BR');
    const deliveries=r.deliveries||[];
    
    const totalEarnings = deliveries.reduce((acc, d) => acc + (Number.isFinite(Number(d.value)) ? Number(d.value) : 0), 0);
    const earningsText = totalEarnings > 0 ? ` · <b style="color:#176b47;">R$ ${totalEarnings.toFixed(2).replace('.',',')}</b>` : '';

    row.innerHTML=`
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <b>${(r.distance/1000).toFixed(2)} km total</b> · ${fmtTime(r.duration)}${earningsText}<br>
          <small>${date}</small>
        </div>
        <button onclick="deleteRideRecord(${r.id})" style="border:0; background:transparent; color:#d92d20; font-size:16px; cursor:pointer; padding:2px 6px;" title="Excluir pedalada">🗑️</button>
      </div>
      <div class="history-deliveries"></div>
    `;
    const list=row.querySelector('.history-deliveries');
    
    deliveries.forEach((d,i)=>{
      const item=document.createElement('div');item.className='history-delivery';
      const accepted=d.accepted?new Date(d.accepted.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
      const delivered=d.delivered?new Date(d.delivered.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'em andamento';
      
      let deliveryKm = 0;
      const startPoint = d.retired || d.accepted;
      if (startPoint && d.delivered) {
        deliveryKm = map.distance([startPoint.lat, startPoint.lng], [d.delivered.lat, d.delivered.lng]) / 1000;
      }
      const kmText = deliveryKm > 0 ? `${deliveryKm.toFixed(2).replace('.',',')} km` : '';

      const label=document.createElement('span');
      label.innerHTML=`Entrega ${i+1} · ${accepted} → ${delivered} ${kmText ? `<b>(${kmText})</b>` : ''}`;
      
      const money=document.createElement('button');money.className='delivery-value';money.textContent=d.value==null?'$':`$ ${Number(d.value).toFixed(2).replace('.',',')}`;money.title='Adicionar ou editar valor da corrida';
      money.onclick=()=>{
        const raw=prompt('Valor recebido nesta entrega (R$):',d.value==null?'':String(d.value).replace('.',','));
        if(raw===null)return;
        const value=Number(raw.trim().replace(',','.'));
        if(!Number.isFinite(value)||value<0){alert('Informe um valor válido.');return;}
        
        const all=readStore(rideStoreKey,[]);
        const target=all.find(x=>x.id===r.id);
        if(!target)return;
        target.deliveries=target.deliveries||[];
        target.deliveries[i].value=value;
        
        if (rideActive && rideDeliveries[i]) {
          rideDeliveries[i].value = value;
          saveActiveRide();
        }
        
        writeStore(rideStoreKey,all);
        renderRideHistory();
      };
      item.append(label,money);list.appendChild(item);
    });
    
    const view=document.createElement('button');view.textContent='Ver trajeto';view.onclick=()=>{
      if(window.historyRoute)map.removeLayer(window.historyRoute);
      if(window.historyEventMarkers)window.historyEventMarkers.forEach(m=>map.removeLayer(m));
      window.historyEventMarkers=[];
      if(r.coords?.length>1){window.historyRoute=L.polyline(r.coords.map(c=>[c.lat,c.lng]),{color:'#ff3b30',weight:5}).addTo(map);map.fitBounds(window.historyRoute.getBounds(),{padding:[35,35]});}
      deliveries.forEach(d=>{
        if(d.retired)window.historyEventMarkers.push(L.marker([d.retired.lat,d.retired.lng],{icon:eventIcon('📦')}).addTo(map).bindPopup('Pedido retirado'));
        if(d.delivered)window.historyEventMarkers.push(L.marker([d.delivered.lat,d.delivered.lng],{icon:eventIcon('🚩')}).addTo(map).bindPopup('Entrega concluída'));
      });
      document.getElementById('historyPanel').hidden=true;status('Trajeto e pontos das entregas exibidos no mapa.');
    };
    row.appendChild(view);box.appendChild(row);
  });
}
document.getElementById('historyBtn').addEventListener('click',()=>{renderRideHistory();document.getElementById('historyPanel').hidden=false;});
document.getElementById('closeHistory').addEventListener('click',()=>document.getElementById('historyPanel').hidden=true);
renderRideHistory();

// --- FUNCIONALIDADE DE BLOQUEIO DE TELA (ANTI-TOQUE) ---
let unlockCounter = 0;
document.getElementById('lockScreenBtn').onclick = () => {
  document.getElementById('screenLockOverlay').hidden = false;
  unlockCounter = 0;
};

document.getElementById('unlockScreenBtn').onclick = () => {
  unlockCounter++;
  if (unlockCounter >= 3) {
    document.getElementById('screenLockOverlay').hidden = true;
    unlockCounter = 0;
    status('Tela desbloqueada.');
  }
};

// --- PAINEL DE ESTATÍSTICAS E MÉTRICAS ---
let currentStatsTab = 'day'; // 'day' ou 'week'

document.getElementById('statsToggleBtn').onclick = () => {
  renderStatsPanel();
  document.getElementById('statsPanel').hidden = false;
};

document.getElementById('closeStats').onclick = () => {
  document.getElementById('statsPanel').hidden = true;
};

document.getElementById('tabDay').onclick = () => {
  currentStatsTab = 'day';
  document.getElementById('tabDay').classList.add('active');
  document.getElementById('tabWeek').classList.remove('active');
  renderStatsPanel();
};

document.getElementById('tabWeek').onclick = () => {
  currentStatsTab = 'week';
  document.getElementById('tabWeek').classList.add('active');
  document.getElementById('tabDay').classList.remove('active');
  renderStatsPanel();
};

function renderStatsPanel() {
  const container = document.getElementById('statsContent');
  const rides = readStore(rideStoreKey, []);
  
  if (!rides.length) {
    container.innerHTML = '<p style="text-align:center; color:#65736d; padding:20px;">Nenhuma pedalada registrada para calcular estatísticas.</p>';
    return;
  }

  const groups = {};
  
  rides.forEach(r => {
    const d = new Date(r.date);
    let key = '';
    if (currentStatsTab === 'day') {
      key = d.toLocaleDateString('pt-BR');
    } else {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      key = `Semana ${weekNum} / ${d.getFullYear()}`;
    }

    if (!groups[key]) {
      groups[key] = { totalKm: 0, totalMs: 0, totalMoney: 0, totalDeliveries: 0, hoursMap: {} };
    }

    groups[key].totalKm += (r.distance || 0) / 1000;
    groups[key].totalMs += (r.duration || 0);

    const deliveries = r.deliveries || [];
    deliveries.forEach(del => {
      const val = Number(del.value);
      if (Number.isFinite(val) && val > 0) {
        groups[key].totalMoney += val;
        groups[key].totalDeliveries += 1;

        const timeRef = del.accepted ? new Date(del.accepted.time) : d;
        const hour = timeRef.getHours();
        groups[key].hoursMap[hour] = (groups[key].hoursMap[hour] || 0) + val;
      }
    });
  });

  let html = '';
  Object.keys(groups).forEach(period => {
    const g = groups[period];
    const avgKm = g.totalKm > 0 ? (g.totalMoney / g.totalKm).toFixed(2) : '0,00';
    const avgDel = g.totalDeliveries > 0 ? (g.totalMoney / g.totalDeliveries).toFixed(2) : '0,00';
    const totalHours = g.totalMs > 0 ? g.totalMs / 3600000 : 0;
    const avgHour = totalHours > 0 ? (g.totalMoney / totalHours).toFixed(2) : '0,00';
    
    let bestHour = '—';
    let maxHourVal = -1;
    Object.keys(g.hoursMap).forEach(h => {
      if (g.hoursMap[h] > maxHourVal) {
        maxHourVal = g.hoursMap[h];
        bestHour = `${h}:00 - ${Number(h)+1}:00`;
      }
    });

    html += `
      <div class="stat-card-item">
        <strong style="font-size:13px; color:#102d25; border-bottom:1px solid #d4e8d8; padding-bottom:4px; display:block;">📅 ${period}</strong>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:8px;">
          <div><small>Faturamento Total</small><b>R$ ${g.totalMoney.toFixed(2).replace('.',',')}</b></div>
          <div><small>Média por KM</small><b>R$ ${avgKm.replace('.',',')} / km</b></div>
          <div><small>Média por Entrega</small><b>R$ ${avgDel.replace('.',',')} / ped.</b></div>
          <div><small>Média por Hora</small><b>R$ ${avgHour.replace('.',',')} / h</b></div>
        </div>
        <div style="margin-top:8px; border-top:1px dashed #d4e8d8; padding-top:6px;">
          <small>⚡ Horário mais lucrativo: <b>${bestHour}</b></small>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}
