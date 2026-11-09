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

// Ordem visual: mapa base < ruas detalhadas < mapa térmico.
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

// Camada topográfica hipsométrica em tempo real
const elevationLayer = L.topoLayer({ range: [722, 820], opacity: 0.78, pane: 'elevationPane' }).addTo(map);

// Ruas detalhadas por cima do mapa térmico, com mistura multiply para preservar as cores do relevo.
const streetDetail = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO', opacity: 0.78, className: 'street-detail', subdomains: 'abcd', pane: 'streetDetailPane'
}).addTo(map);

let heatOn = true, origin = null, destination = null, currentElevation = null, selectedElevation = null, selectedPointMarker = null, elevationCache = new Map(), routeLine = null, userMarker = null, originMarker = null, destMarker = null, via = [], viaMarkers = [], choosingDest = false, watchId = null;

const $ = id => document.getElementById(id);
const status = t => { if ($('status')) $('status').textContent = t; };

// Menu geral de ferramentas: controles ocultos até tocar na engrenagem.
$('settingsToggleBtn').addEventListener('click', () => {
  const menu = $('settingsMenu'); menu.hidden = !menu.hidden;
  $('settingsToggleBtn').setAttribute('aria-expanded', String(!menu.hidden));
});

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
  if (markerMode) return;
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


// ===== URBAN PEDAL: gravação, marcadores, camadas e orientação =====
const rideStoreKey = 'urban-pedal-rides-v1';
const markerStoreKey = 'urban-pedal-markers-v1';
let rideActive = false, ridePaused = false, rideStartedAt = 0, rideElapsedBefore = 0, rideTimer = null;
let rideCoords = [], rideDistanceMeters = 0, lastRidePoint = null, rideLine = null, rideDeliveries = [], activeDelivery = null;
let markerMode = null, savedMarkers = [];
let rotateBearing = 0;

function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { status('Armazenamento cheio: não foi possível salvar tudo.'); } }
function fmtTime(ms) { const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60; return [h,m,sec].map(v=>String(v).padStart(2,'0')).join(':'); }
function elapsedRide() { return rideElapsedBefore + (rideActive && !ridePaused ? Date.now()-rideStartedAt : 0); }
function updateRideHud() {
  const d=document.getElementById('rideDistance'), t=document.getElementById('rideTime');
  if(d)d.textContent=(rideDistanceMeters/1000).toFixed(2).replace('.',',');
  if(t)t.textContent=fmtTime(elapsedRide());
}
function saveActiveRide() {
  if(!rideActive)return;
  writeStore('urban-pedal-active-v1',{startedAt:Date.now()-elapsedRide(),coords:rideCoords,distance:rideDistanceMeters,deliveries:rideDeliveries,activeDelivery,paused:ridePaused,elapsed:elapsedRide()});
}
function setRideControls() {
  const active=rideActive;
  document.getElementById('rideActions').hidden=!active;
  document.getElementById('rideButton').hidden=active;
  document.getElementById('endRideBtn').hidden=!active;
  document.getElementById('pauseRideBtn').textContent=ridePaused?'▶':'Ⅱ';
  document.getElementById('pauseRideBtn').setAttribute('aria-label',ridePaused?'Retomar gravação':'Pausar gravação');
  document.getElementById('pauseRideBtn').title=ridePaused?'Retomar':'Pausar';
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
  if(activeDelivery){status('Já existe uma entrega em andamento. Registre a retirada ou entrega primeiro.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery={id:Date.now(),accepted:point,retired:null,delivered:null,value:null};
  rideDeliveries.push(activeDelivery);saveActiveRide();status('Entrega aceita e registrada.');
}
function retireDelivery() {
  if(!rideActive||ridePaused){status('Retome o Modo Pedal para registrar a retirada.');return;}
  if(!activeDelivery){status('Toque em ACEITEI antes de registrar a retirada.');return;}
  if(activeDelivery.retired){status('A retirada desta entrega já foi registrada.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery.retired=point;saveActiveRide();status('Retirada registrada.');
}
function deliverDelivery() {
  if(!rideActive||ridePaused){status('Retome o Modo Pedal para registrar a entrega.');return;}
  if(!activeDelivery){status('Toque em ACEITEI antes de registrar a entrega.');return;}
  const point=eventPoint();if(!point)return;
  activeDelivery.delivered=point;activeDelivery=null;saveActiveRide();status('Entrega concluída e registrada no histórico.');
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
  const record={id:Date.now(),date:new Date().toISOString(),duration:rideElapsedBefore,distance:rideDistanceMeters,coords:rideCoords,deliveries:rideDeliveries};
  const rides=readStore(rideStoreKey,[]);rides.unshift(record);writeStore(rideStoreKey,rides.slice(0,100));
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
})();

// Marcadores pessoais persistidos no aparelho.
const markerTypes={
 hole:{label:'Buraco',emoji:'🕳️',color:'#e53935'},
 danger:{label:'Rua perigosa',emoji:'⚠️',color:'#f57c00'},
 hill:{label:'Ladeira',emoji:'⛰️',color:'#8e24aa'},
 stairs:{label:'Escadaria',emoji:'🚧',color:'#546e7a'},
 avoid:{label:'Não quero ir',emoji:'🚫',color:'#212121'}
};
function renderSavedMarkers(){
  // Remove layers antigos antes de redesenhar para evitar duplicatas e referências obsoletas.
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
document.querySelectorAll('[data-marker]').forEach(b=>b.addEventListener('click',()=>{markerMode=b.dataset.marker;document.getElementById('markerMenu').hidden=true;status('Toque no mapa para posicionar: '+markerTypes[markerMode].label+'.');}));
document.getElementById('cancelMarker').addEventListener('click',()=>{markerMode=null;document.getElementById('markerMenu').hidden=true;});
const oldMapClick=map._events.click;
map.on('click',e=>{
  if(!markerMode)return;
  const type=markerMode;markerMode=null;
  const note=prompt('Observação opcional para '+markerTypes[type].label+':','');
  const arr=readStore(markerStoreKey,[]);
  arr.push({id:Date.now(),type,lat:e.latlng.lat,lng:e.latlng.lng,note:note||''});
  writeStore(markerStoreKey,arr);renderSavedMarkers();status('Marcador salvo no mapa.');
});
renderSavedMarkers();

// Menu de camadas: base OSM, ruas detalhadas sob o relevo e camada térmica.
document.getElementById('layersBtn').addEventListener('click',()=>{const m=document.getElementById('layersMenu');m.hidden=!m.hidden;});
document.getElementById('streetDetailToggle').addEventListener('change',e=>e.target.checked?streetDetail.addTo(map):map.removeLayer(streetDetail));
document.getElementById('heatToggle').addEventListener('change',e=>{heatOn=e.target.checked;document.getElementById('heatBtn').classList.toggle('active',heatOn);heatOn?elevationLayer.addTo(map):map.removeLayer(elevationLayer);});
document.getElementById('baseToggle').addEventListener('change',e=>{if(map.hasLayer(topoMap))map.removeLayer(topoMap);if(map.hasLayer(street))map.removeLayer(street);(e.target.checked?street:topoMap).addTo(map);});
document.getElementById('rotateBtn').addEventListener('click',()=>{
  if(typeof map.setBearing==='function'){rotateBearing=(rotateBearing+45)%360;map.setBearing(rotateBearing);status('Orientação do mapa: '+rotateBearing+'°.');}
  else status('Giro do mapa indisponível. Atualize a página e tente novamente.');
});
document.getElementById('orientationBtn').addEventListener('click',async()=>{
  const landscape=screen.orientation?.type?.startsWith('landscape')||false;
  try{
    if(screen.orientation?.lock){await screen.orientation.lock(landscape?'portrait':'landscape');document.getElementById('orientationBtn').textContent=landscape?'▯ Retrato':'▱ Paisagem';}
    else {status('Este Chrome não permite bloquear a orientação neste contexto. Gire o celular manualmente.');}
  }catch(_){status('Para bloquear a orientação, abra o Urban Pedal instalado pelo Chrome e permita a rotação. Se não aceitar, gire o celular manualmente.');}
});
window.addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize(),250));
window.addEventListener('resize',()=>setTimeout(()=>map.invalidateSize(),150));

// Histórico de pedaladas e entregas com valores individuais e marcadores no trajeto.
function eventIcon(emoji){return L.divIcon({className:'ride-event-marker',html:emoji,iconSize:[30,30],iconAnchor:[15,15]});}
function renderRideHistory(){
  const box=document.getElementById('historyList'),rides=readStore(rideStoreKey,[]);
  if(!box)return;
  box.innerHTML=rides.length?'':'<p>Nenhuma pedalada salva ainda.</p>';
  rides.forEach(r=>{
    const row=document.createElement('div');row.className='history-item';
    const date=new Date(r.date).toLocaleString('pt-BR');
    const deliveries=r.deliveries||[];
    row.innerHTML=`<b>${(r.distance/1000).toFixed(2)} km</b> · ${fmtTime(r.duration)}<br><small>${date}</small><div class="history-deliveries"></div>`;
    const list=row.querySelector('.history-deliveries');
    deliveries.forEach((d,i)=>{
      const item=document.createElement('div');item.className='history-delivery';
      const accepted=d.accepted?new Date(d.accepted.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
      const delivered=d.delivered?new Date(d.delivered.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'em andamento';
      const label=document.createElement('span');label.textContent=`Entrega ${i+1} · ${accepted} → ${delivered}`;
      const money=document.createElement('button');money.className='delivery-value';money.textContent=d.value==null?'$':`$ ${Number(d.value).toFixed(2).replace('.',',')}`;money.title='Adicionar ou editar valor da corrida';
      money.onclick=()=>{const raw=prompt('Valor recebido nesta entrega (R$):',d.value==null?'':String(d.value).replace('.',','));if(raw===null)return;const value=Number(raw.trim().replace(',','.'));if(!Number.isFinite(value)||value<0){alert('Informe um valor válido.');return;}const all=readStore(rideStoreKey,[]);const target=all.find(x=>x.id===r.id);if(!target)return;target.deliveries=target.deliveries||[];target.deliveries[i].value=value;writeStore(rideStoreKey,all);renderRideHistory();};
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
