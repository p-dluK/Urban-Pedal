// 1. Ruas padrão (OSM)
const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
});

// 2. Camada topográfica
const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}{r}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap (CC-BY-SA)'
});

// 3. Terceira opção: Ruas nítidas e limpas (CartoDB Positron - limpa, sem construções pesadas)
const cleanStreetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors © CARTO',
  subdomains: 'abcd'
});

// Inicia com a camada limpa ativa por padrão embaixo
let currentBaseLayer = cleanStreetLayer.addTo(map);