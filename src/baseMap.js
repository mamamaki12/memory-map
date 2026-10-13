import L from 'leaflet';
import config from './map-config.json';

const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const key = typeof config.cartoApiKey === 'string' ? config.cartoApiKey.trim() : '';

// Keep the map usable until the site's browser API key has been configured.
export function addBaseMap(map, { attribution = '', onError } = {}) {
  const url = key
    ? 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' + encodeURIComponent(key)
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  let warned = false;
  const layer = L.tileLayer(url, {
    maxZoom: 20,
    maxNativeZoom: key ? 20 : 19,
    attribution: osmAttribution + (key ? ' &copy; <a href="https://carto.com/attribution/">CARTO</a>' : '') + attribution,
  });
  layer.on('tileerror', () => {
    if (!warned) onError?.('地図を読み込めません。通信状態を確認してください。');
    warned = true;
  });
  return layer.addTo(map);
}
