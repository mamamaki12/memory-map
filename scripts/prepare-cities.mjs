import { mkdir, writeFile } from 'node:fs/promises';
import { feature } from 'topojson-client';
import { indexCities, cityForPhoto } from '../src/cityProgress.js';
const source = 'https://raw.githubusercontent.com/smartnews-smri/japan-topography/b403e71eb97f1fdf32f63d16bd485129f703855e/data/municipality/topojson/s0010/N03-21_210101_designated_city.json';
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('City boundary download failed: ' + response.status);
const topology = await response.json();
const collection = feature(topology, Object.values(topology.objects)[0]);
const cities = collection.features.flatMap(item => {
  const p = item.properties;
  const name = p.N03_003?.endsWith('市') ? p.N03_003 : p.N03_004;
  if (!name?.endsWith('市') || !p.N03_007) return [];
  return [{ ...item, properties: { code: p.N03_007, name, prefecture: p.N03_001 } }];
});
if (cities.length !== 792 || new Set(cities.map(c => c.properties.code)).size !== cities.length) {
  throw new Error('Unexpected city boundary schema/count');
}
const indexed = indexCities({ features: cities });
for (const [lat,lng,name] of [[31.5966,130.5571,'鹿児島市'],[43.0618,141.3545,'札幌市'],[35.1815,136.9066,'名古屋市']]) {
  if (cityForPhoto(indexed,{lat,lng})?.properties.name !== name) throw new Error('City classification check failed: '+name);
}
await mkdir('public', { recursive: true });
await writeFile('public/city-boundaries.json', JSON.stringify({
  type: 'FeatureCollection', features: cities,
  sourceYear: 2021, source, attribution: '国土数値情報（行政区域データ）を加工して作成',
}));
console.log('Prepared ' + cities.length + ' city boundaries (2021 dataset).');
