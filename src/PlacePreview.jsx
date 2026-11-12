import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { addBaseMap, usesCarto } from './baseMap.js';

// A small, still map in the save screen showing where the photo will be pinned.
export default function PlacePreview({ lat, lng, blob }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  // Put the pin's tip a little below the middle so the whole photo pin fits in the low map.
  const centre = () => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    map.setView(marker.getLatLng(), 16, { animate: false });
    // In the low side-by-side map the pin is drawn smaller and kept above the map credits.
    map.panBy([0, map.getSize().y < 150 ? -10 : -36], { animate: false });
  };
  useEffect(() => {
    const map = L.map(container.current, {
      zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, tap: false, attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    addBaseMap(map);
    mapRef.current = map;
    // The dialog opens after this runs, so redraw once the map has its real size.
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      centre();
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    const url = URL.createObjectURL(blob);
    const pin = document.createElement('div');
    pin.className = 'photo-pin';
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    pin.append(document.createElement('span'), image);
    pin.firstChild.className = 'photo-pin-caption';
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({ html: pin, className: '', iconSize: [62, 82], iconAnchor: [31, 90] }),
      interactive: false, keyboard: false,
    }).addTo(map);
    markerRef.current = marker;
    centre();
    return () => { marker.remove(); URL.revokeObjectURL(url); };
  }, [lat, lng, blob]);
  // In the narrow side-by-side layout the map credits do not fit on the small map, so they sit on one line under it instead.
  return <>
    <div className="place-preview" ref={container} />
    <p className="place-credit">&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
      {usesCarto && <> &copy; <a href="https://carto.com/attribution/">CARTO</a></>}</p>
  </>;
}
