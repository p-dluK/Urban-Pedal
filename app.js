const districts = ["Ermelino Matarazzo","Penha","Ponte Rasa","Cangaíba","Vila Jacuí"];
const map = L.map('map',{zoomControl:true}).setView([-23.505,-46.49],13);
const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenTopoMap (CC-BY-SA)'}); 
let heatOn=true, origin=null, destination=null, currentElevation=null, selectedElevation=null, selectedPointMarker=null, elevationCache=new Map(), routeLine=null, userMarker=null, originMarker=null, destMarker=null, via=[], viaMarkers=[], choosingDest=false, watchId=null, elevationLayer=null, heatBusy=false;
const $=id=>document.getElementById(id), status=t=>$('status').textContent=t;
const zone = L.latLngBounds([-23.56,-46.55],[-23.44,-46.42]);
const setMarker=(old,p,label,color)=>{if(old)map.removeLayer(old);return L.circleMarker(p,{radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(map).bindPopup(label)};
function reverseName(p){return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
function clearViaMarkers(){viaMarkers.forEach(m=>map.removeLayer(m));viaMarkers=[]}
function renderVia(){clearViaMarkers();via.forEach((p,i)=>viaMarkers.push(L.marker(p).addTo(map).bindPopup(`Parada ${i+1} <button onclick="removeVia(${i})">Remover</button>`)))}
window.removeVia=i=>{via.splice(i,1);renderVia();if(origin&&destination)calculateRoute()};
map.on('click',e=>{
 queryElevation(e.latlng,true);
 if(choosingDest){destination=e.latlng;$('destination').value=reverseName(destination);destMarker=setMarker(destMarker,destination,'Destino','#dc4d4d');choosingDest=false;status('Destino selecionado.');return}
 if(!origin){origin=e.latlng;$('origin').value=reverseName(origin);originMarker=setMarker(originMarker,origin,'Origem','#1685ff');status('Origem selecionada. Agora escolha o destino.');return}
 if(!destination){destination=e.latlng;$('destination').value=reverseName(destination);destMarker=setMarker(destMarker,destination,'Destino','#dc4d4d');status('Destino selecionado.');return}
 via.push(e.latlng);renderVia();status(`Ponto intermediário ${via.length} adicionado. Recalculando...`);calculateRoute();
});
$('pickDest').onclick=()=>{choosingDest=true;status('Toque no mapa para escolher o destino.')};
$('originHere').onclick=()=>locate(true);
$('locateBtn').onclick=()=>locate(true);
function locate(setAsOrigin=false){
 if(!navigator.geolocation){status('GPS não disponível neste navegador.');return}
 status('Obtendo localização GPS...');
 navigator.geolocation.getCurrentPosition(pos=>{
  const p=L.latLng(pos.coords.latitude,pos.coords.longitude);
  queryElevation(p,false);
  userMarker=setMarker(userMarker,p,'Sua localização','#1685ff');map.setView(p,16);
  if(setAsOrigin){origin=p;$('origin').value='Minha localização atual';originMarker=setMarker(originMarker,p,'Origem','#1685ff')}
  status('Localização atualizada. Precisão aproximada: '+Math.round(pos.coords.accuracy)+' m.');
  if(!watchId)watchId=navigator.geolocation.watchPosition(updatePosition,()=>{}, {enableHighAccuracy:true,maximumAge:5000});
 },err=>status('Não foi possível obter GPS: '+err.message),{enableHighAccuracy:true,timeout:15000});
}
function updatePosition(pos){const p=L.latLng(pos.coords.latitude,pos.coords.longitude);userMarker=setMarker(userMarker,p,'Sua localização','#1685ff');if(!window.lastElevPosition||map.distance(p,window.lastElevPosition)>35){window.lastElevPosition=p;queryElevation(p,false)}}
async function geocode(q){
 const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&viewbox=-46.56,-23.43,-46.40,-23.57&bounded=1&q='+encodeURIComponent(q+', São Paulo');
 const r=await fetch(url);if(!r.ok)throw Error('Busca indisponível');return r.json();
}
$('destination').addEventListener('input',async e=>{
 const q=e.target.value.trim();if(q.length<4)return;
 try{const results=await geocode(q);$('suggestions').innerHTML='';results.forEach(x=>{const b=document.createElement('button');b.textContent=x.display_name;b.onclick=()=>{destination=L.latLng(+x.lat,+x.lon);$('destination').value=x.display_name;$('suggestions').innerHTML='';destMarker=setMarker(destMarker,destination,'Destino','#dc4d4d');map.setView(destination,16)};$('suggestions').appendChild(b)})}catch(_){}
});
$('origin').addEventListener('change',async e=>{if(e.target.value.toLowerCase().includes('localização'))return;try{const r=await geocode(e.target.value);if(r[0]){origin=L.latLng(+r[0].lat,+r[0].lon);originMarker=setMarker(originMarker,origin,'Origem','#1685ff');map.setView(origin,15)}}catch(_){status('Não foi possível localizar a origem.')}});
$('routeBtn').onclick=calculateRoute;
$('clearBtn').onclick=()=>{origin=destination=null;via=[];clearViaMarkers();[routeLine,originMarker,destMarker].forEach(x=>x&&map.removeLayer(x));routeLine=originMarker=destMarker=null;$('origin').value='';$('destination').value='';$('routeInfo').hidden=true;status('Rota limpa.')};
async function calculateRoute(){
 if(!origin||!destination){status('Defina origem e destino primeiro.');return}
 status('Calculando rota para bicicleta...');
 const points=[origin,...via,destination].map(p=>`${p.lng},${p.lat}`).join('|');
 const url=`https://brouter.de/brouter?lonlats=${encodeURIComponent(points)}&profile=trekking&alternativeidx=0&format=geojson`;
 try{
  const r=await fetch(url);if(!r.ok)throw Error('Serviço de rotas indisponível');const data=await r.json();
  if(!data.features?.length)throw Error('Nenhuma rota encontrada');
  const coords=data.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
  if(routeLine)map.removeLayer(routeLine);
  routeLine=L.polyline(coords,{color:'#1469e8',weight:6,opacity:.9}).addTo(map);
  map.fitBounds(routeLine.getBounds(),{padding:[35,35]});
  const props=data.features[0].properties||{}, km=(props['track-length']||props['total-distance']||0)/1000;
  $('routeInfo').hidden=false;$('routeInfo').innerHTML=`<b>Rota para bicicleta</b><br>Distância aproximada: <b>${km?km.toFixed(2)+' km':'consulte o traçado'}</b><br>Paradas intermediárias: ${via.length}<br><small>Toque em outra rua para inserir mais um ponto.</small>`;
  status('Rota calculada. Confira o traçado antes de pedalar.');
 }catch(e){status('Não foi possível calcular: '+e.message+'. Tente novamente.')}
}
$('heatBtn').onclick=()=>{heatOn=!heatOn;$('heatBtn').classList.toggle('active',heatOn);if(heatOn){if(elevationLayer)elevationLayer.addTo(map);else loadElevation()}else if(elevationLayer)map.removeLayer(elevationLayer)};
$('layersBtn').onclick=()=>{if(map.hasLayer(topo)){map.removeLayer(topo);street.addTo(map)}else{map.removeLayer(street);topo.addTo(map)}};
async function getElevation(p){
 const key=p.lat.toFixed(5)+','+p.lng.toFixed(5);if(elevationCache.has(key))return elevationCache.get(key);
 const r=await fetch('https://api.opentopodata.org/v1/mapzen?locations='+encodeURIComponent(key));if(!r.ok)throw Error('Fonte topográfica indisponível');
 const d=await r.json(),v=d.results?.[0]?.elevation;if(v===null||v===undefined)throw Error('Sem dado de altitude');elevationCache.set(key,Math.round(v));return Math.round(v);
}
async function queryElevation(p,isSelected){try{const v=await getElevation(p);if(isSelected){selectedElevation=v;selectedPointMarker=setMarker(selectedPointMarker,p,`Ponto selecionado: ${v} m`,'#e3a52d');$('elevationInfo').hidden=false;$('selectedElev').textContent=v+' m'}else{currentElevation=v;$('elevationInfo').hidden=false;$('currentElev').textContent=v+' m'}updateElevationDifference()}catch(e){status('Não foi possível consultar a altitude agora. Tente novamente em alguns segundos.')}}
function updateElevationDifference(){if(currentElevation===null||selectedElevation===null)return;const d=selectedElevation-currentElevation,s=d>0?'+':'';$('elevDiff').textContent=s+d+' m '+(d>0?'acima da sua posição':d<0?'abaixo da sua posição':'na mesma altitude');$('elevDiff').style.color=d>0?'#b65b24':d<0?'#176b47':'#52645a'}
async function loadElevation(){
 if(heatBusy)return;heatBusy=true;status('Atualizando mapa térmico com dados de elevação...');
 const b=map.getBounds(),rows=10,cols=12,pts=[];for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const lat=b.getSouth()+(b.getNorth()-b.getSouth())*y/(rows-1),lon=b.getWest()+(b.getEast()-b.getWest())*x/(cols-1);pts.push([lat,lon])}
 try{const vals=[];for(let i=0;i<pts.length;i+=100){if(i>0)await new Promise(r=>setTimeout(r,1100));const part=pts.slice(i,i+100),loc=part.map(p=>p[0]+','+p[1]).join('|');const r=await fetch('https://api.opentopodata.org/v1/mapzen?locations='+encodeURIComponent(loc));if(!r.ok)throw Error('Limite/indisponibilidade da API');const d=await r.json();vals.push(...d.results.map(x=>x.elevation))}
 if(vals.some(v=>v===null||v===undefined))throw Error('Amostras sem elevação');const min=Math.min(...vals),max=Math.max(...vals),c=document.createElement('canvas');c.width=cols*24;c.height=rows*24;const ctx=c.getContext('2d');
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const t=(vals[y*cols+x]-min)/(max-min||1);ctx.fillStyle=t<.25?'rgba(35,190,105,.42)':t<.5?'rgba(210,220,55,.48)':t<.75?'rgba(255,145,50,.53)':'rgba(230,55,85,.58)';ctx.fillRect(x*24,y*24,24,24)}
 const bounds=L.latLngBounds([b.getSouth(),b.getWest()],[b.getNorth(),b.getEast()]);if(elevationLayer)map.removeLayer(elevationLayer);elevationLayer=L.imageOverlay(c.toDataURL(),bounds,{opacity:.78,interactive:false});if(heatOn)elevationLayer.addTo(map);$('legend').querySelector('b').textContent=`ALTITUDE ${Math.round(min)}–${Math.round(max)} m`;status(`Mapa térmico atualizado: ${Math.round(min)}–${Math.round(max)} m. Fonte Mapzen.`)
 }catch(e){status('Mapa térmico detalhado indisponível. Tente novamente ou use a camada topográfica.')}finally{heatBusy=false}
}
let heatTimer=null;map.on('moveend',()=>{if(heatOn){clearTimeout(heatTimer);heatTimer=setTimeout(loadElevation,900)}});
loadElevation();
if('serviceWorker'in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
