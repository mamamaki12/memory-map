import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

export default function PhotoMap({ photos, onOpen, onPick, selecting, view, fitRequest, onError }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const callbacks = useRef({ onOpen, onPick, selecting, onError });
  useEffect(() => { callbacks.current = { onOpen, onPick, selecting, onError }; });
  useEffect(() => {
    const map = L.map(container.current).setView([31.5966, 130.5571], 12);
    mapRef.current = map;
    let warned = false;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map).on('tileerror', () => {
      if (!warned) callbacks.current.onError('地図を読み込めません。通信状態を確認してください。');
      warned = true;
    });
    map.on('click', event => {
      if (callbacks.current.selecting) callbacks.current.onPick(event.latlng);
    });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    const group = L.layerGroup().addTo(map);
    const urls = [];
    photos.forEach(photo => {
      const url = URL.createObjectURL(photo.blob);
      urls.push(url);
      const pin = document.createElement('div');
      pin.className = 'photo-pin';
      const image = document.createElement('img');
      image.src = url;
      image.alt = photo.caption || '思い出の写真';
      pin.append(image);
      L.marker([photo.lat, photo.lng], {
        icon: L.divIcon({ html: pin, className: '', iconSize: [62, 62], iconAnchor: [31, 70] }),
        title: photo.caption || '写真を開く',
      }).addTo(group).on('click', event => {
        L.DomEvent.stopPropagation(event);
        if (!callbacks.current.selecting) callbacks.current.onOpen(photo);
      });
    });
    return () => { group.remove(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [photos]);
  useEffect(() => {
    if (view) mapRef.current.setView([view.lat, view.lng], 16);
  }, [view]);
  useEffect(() => {
    if (fitRequest && photos.length) {
      mapRef.current.fitBounds(L.latLngBounds(photos.map(p => [p.lat, p.lng])).pad(.2), { maxZoom: 16 });
    }
  }, [fitRequest, photos]);
  return <div id="map" ref={container} />;
}
