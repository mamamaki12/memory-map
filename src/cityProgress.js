function ringContains(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(ax,bx) && x <= Math.max(ax,bx) && y >= Math.min(ay,by) && y <= Math.max(ay,by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function geometryContains(geometry, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some(rings => ringContains([lng,lat], rings[0]) && !rings.slice(1).some(ring => ringContains([lng,lat],ring)));
}
export function indexCities(collection) {
  return collection.features.map(feature => {
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    function visit(value) {
      if (typeof value[0] === 'number') { west=Math.min(west,value[0]);east=Math.max(east,value[0]);south=Math.min(south,value[1]);north=Math.max(north,value[1]); }
      else value.forEach(visit);
    }
    visit(feature.geometry.coordinates);
    return { feature, bounds:[west,south,east,north] };
  });
}
export function cityForPhoto(index, photo) {
  if (photo.shared || !Number.isFinite(photo.lat) || !Number.isFinite(photo.lng)) return null;
  return index.find(({ bounds:[w,s,e,n], feature }) => photo.lng>=w && photo.lng<=e && photo.lat>=s && photo.lat<=n && geometryContains(feature.geometry,photo.lat,photo.lng))?.feature ?? null;
}
export function computeProgress(index, photos) {
  const completed = new Map();
  let unmatched = 0;
  for (const photo of photos) {
    if (photo.shared) continue;
    const city = cityForPhoto(index, photo);
    if (!city) { unmatched++; continue; }
    const code = city.properties.code;
    if (!completed.has(code)) completed.set(code, { city:city.properties, photos:[] });
    completed.get(code).photos.push(photo);
  }
  return { completed, unmatched };
}
