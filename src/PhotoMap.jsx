import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { addBaseMap } from './baseMap.js';
import { animateLocation } from './animateLocation.js';

export default function PhotoMap({ photos, onOpen, onPick, selecting, view, currentLocation, fitRequest, onError }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const locationLayers = useRef(null);
  const stopLocationAnimation = useRef(null);
  const callbacks = useRef({ onOpen, onPick, selecting, onError });
  useEffect(() => { callbacks.current = { onOpen, onPick, selecting, onError }; });
  useEffect(() => {
    const map = L.map(container.current).setView([31.5966, 130.5571], 12);
    mapRef.current = map;
    // Keep the location indicator above photo pins without intercepting map taps.
    const locationPane = map.createPane('current-location');
    locationPane.style.zIndex = '650';
    locationPane.style.pointerEvents = 'none';
    addBaseMap(map, { onError: message => callbacks.current.onError(message) });
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
    const pins = [];
    // Shrink at regional/world zooms, with a readable minimum and a capped close-up size.
    const updatePinSizes = () => {
      const scale = Math.max(0.32, Math.min(1.15, 2 ** ((map.getZoom() - 16) / 6)));
      pins.forEach(({ marker, pin }) => {
        pin.style.width = '62px';
        pin.style.height = '82px';
        pin.style.transformOrigin = '0 0';
        pin.style.transform = 'scale(' + scale + ')';
        marker.setIcon(L.divIcon({
          html: pin,
          className: '',
          iconSize: [62 * scale, 82 * scale],
          iconAnchor: [31 * scale, 90 * scale],
        }));
      });
    };
    photos.forEach(photo => {
      const url = URL.createObjectURL(photo.blob);
      urls.push(url);
      const pin = document.createElement('div');
      pin.className = 'photo-pin';
      const image = document.createElement('img');
      image.src = url;
      image.alt = photo.caption || '思い出の写真';
      const caption = document.createElement('span');
      caption.className = 'photo-pin-caption';
      caption.textContent = photo.caption || '';
      caption.title = photo.caption || '';
      pin.append(caption, image);
      const marker = L.marker([photo.lat, photo.lng], {
        icon: L.divIcon({ html: pin, className: '', iconSize: [62, 82], iconAnchor: [31, 90] }),
        title: photo.caption || '写真を開く',
      }).addTo(group).on('click', event => {
        L.DomEvent.stopPropagation(event);
        if (!callbacks.current.selecting) callbacks.current.onOpen(photo);
      });
      pins.push({ marker, pin });
    });
    updatePinSizes();
    map.on('zoomend', updatePinSizes);
    return () => {
      map.off('zoomend', updatePinSizes);
      group.remove();
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [photos]);
  useEffect(() => {
    const map = mapRef.current;
    stopLocationAnimation.current?.();
    stopLocationAnimation.current = null;
    if (!currentLocation) {
      locationLayers.current?.group.remove();
      return;
    }
    const center = [currentLocation.lat, currentLocation.lng];
    let layers = locationLayers.current;
    if (!layers) {
      const group = L.layerGroup();
      const accuracy = L.circle(center, {
        radius: 0, color: '#4285f4', weight: 1, opacity: 0.25,
        fillColor: '#4285f4', fillOpacity: 0.10, interactive: false,
      }).addTo(group);
      const sonar = document.createElement('div');
      sonar.className = 'location-sonar';
      sonar.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) {
        const ring = document.createElement('span');
        ring.className = 'location-sonar-ring';
        sonar.append(ring);
      }
      const dot = document.createElement('span');
      dot.className = 'location-sonar-dot';
      sonar.append(dot);
      const marker = L.marker(center, {
        pane: 'current-location',
        icon: L.divIcon({ html: sonar, className: 'location-sonar-icon', iconSize: [100, 100], iconAnchor: [50, 50] }),
        interactive: false, keyboard: false,
      }).addTo(group);
      layers = { group, marker, accuracy };
      locationLayers.current = layers;
    }
    const wasVisible = map.hasLayer(layers.group);
    const start = layers.marker.getLatLng();
    const target = {
      lat: currentLocation.lat, lng: currentLocation.lng,
      accuracy: Number.isFinite(currentLocation.accuracy) && currentLocation.accuracy > 0 ? currentLocation.accuracy : 0,
    };
    layers.group.addTo(map);
    const draw = point => {
      const position = [point.lat, point.lng];
      layers.marker.setLatLng(position);
      layers.accuracy.setLatLng(position).setRadius(point.accuracy);
    };
    if (!wasVisible || window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        map.distance(start, center) > 5000) {
      draw(target);
    } else {
      // Retarget from the currently displayed position, even if the previous movement is unfinished.
      stopLocationAnimation.current = animateLocation({
        from: { lat: start.lat, lng: start.lng, accuracy: layers.accuracy.getRadius() },
        to: target, onFrame: draw,
      });
    }
    return () => { stopLocationAnimation.current?.(); stopLocationAnimation.current = null; };
  }, [currentLocation]);
  useEffect(() => () => {
    stopLocationAnimation.current?.();
    stopLocationAnimation.current = null;
    locationLayers.current?.group.remove();
    locationLayers.current = null;
  }, []);
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
