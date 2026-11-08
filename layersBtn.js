// Alterna entre as 3 opções de mapa base:
// 1. Clean/Limpo -> 2. OpenStreetMap -> 3. TopoMap
$('layersBtn').onclick = () => {
  if (map.hasLayer(cleanStreetLayer)) {
    map.removeLayer(cleanStreetLayer);
    street.addTo(map);
    status('Camada: OpenStreetMap');
  } else if (map.hasLayer(street)) {
    map.removeLayer(street);
    topoMap.addTo(map);
    status('Camada: Topográfica (TopoMap)');
  } else {
    map.removeLayer(topoMap);
    cleanStreetLayer.addTo(map);
    status('Camada: Ruas Limpas e Nítidas');
  }
  // Garante que o mapa térmico continue prioritário por cima da nova base escolhida
  updateLayerOrder();
};