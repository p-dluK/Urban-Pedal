// --- NOVAS CAMADAS BASE E CONFIGURAÇÃO ---

// 1. Rua padrão (OSM)
const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
});

// 2. Camada topográfica
const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA)'
});

// 3. Terceira opção: Ruas nítidas e limpas (CartoDB Positron / Light sem poluição de edifícios)
const cleanStreetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains: 'abcd'
});

// Inicia com a camada limpa ou padrão (vamos iniciar com a limpa como padrão ou deixar o OSM)
let currentBaseLayer = cleanStreetLayer.addTo(map);

// Camada topográfica hipsométrica em tempo real (O MAPA TÉRMICO É A PRIORIDADE E FICA POR CIMA)
const elevationLayer = L.topoLayer({ range: [722, 820], opacity: 0.78 }).addTo(map);

// Ruas detalhadas / rótulos por cima do mapa térmico (com mistura multiply para preservar as cores do relevo)
const streetDetail = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO', opacity: 0.78, className: 'street-detail', subdomains: 'abcd'
}).addTo(map);

// Garante que o mapa térmico e o detalhe fiquem na ordem correta de prioridade visual
function updateLayerOrder() {
  if (map.hasLayer(elevationLayer)) elevationLayer.bringToFront();
  if (map.hasLayer(streetDetail)) streetDetail.bringToFront();
}