import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { addBaseMap } from './baseMap.js';
import { animateLocation } from './animateLocation.js';
import { groupPins, pinScale } from './pinGroups.js';

export default function PhotoMap({ photos, onOpen, onOpenGroup, onCenter, selecting, view, currentLocation, fitRequest, onError }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const locationLayers = useRef(null);
  const stopLocationAnimation = useRef(null);
  const callbacks = useRef({ onOpen, onOpenGroup, onCenter, selecting, onError });
  useEffect(() => { callbacks.current = { onOpen, onOpenGroup, onCenter, selecting, onError }; });
  useEffect(() => {
    const map = L.map(container.current).setView([31.5966, 130.5571], 12);
    mapRef.current = map;
    // Keep the location indicator above photo pins without intercepting map taps.
    const locationPane = map.createPane('current-location');
    locationPane.style.zIndex = '650';
    locationPane.style.pointerEvents = 'none';
    addBaseMap(map, { onError: message => callbacks.current.onError(message) });
    // While choosing a place, a tap moves the centre mark there; the place is decided with a button.
    map.on('click', event => {
      if (callbacks.current.selecting) map.panTo(event.latlng);
    });
    map.on('moveend', () => callbacks.current.onCenter?.(map.getCenter()));
    callbacks.current.onCenter?.(map.getCenter());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);
    // One picture address per photo, made once and reused each time the pins are regrouped.
    const urls = new Map(photos.map(photo => [photo, URL.createObjectURL(photo.blob)]));
    // Pins that would cover each other at this zoom become one pin with the number of photos.
    const groupsAt = (items, zoom) => {
      const scale = pinScale(zoom);
      return groupPins(items.map(photo => {
        const { x, y } = map.project([photo.lat, photo.lng], zoom);
        return { x, y, item: photo };
      }), { width: 62 * scale, height: 82 * scale });
    };
    const makeIcon = (photo, count, scale) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-pin-wrap' + (count > 1 ? ' is-group' : '');
      // The pin's name comes from the marker's title (the caption, or the number of photos).
      wrap.setAttribute('aria-hidden', 'true');
      const pin = document.createElement('div');
      pin.className = 'photo-pin';
      pin.style.transformOrigin = '0 0';
      pin.style.transform = 'scale(' + scale + ')';
      const image = document.createElement('img');
      image.src = urls.get(photo);
      image.alt = '';
      const caption = document.createElement('span');
      caption.className = 'photo-pin-caption';
      caption.textContent = count > 1 ? count + '枚' : photo.caption || '';
      pin.append(caption, image);
      wrap.append(pin);
      if (count > 1) {
        // The number stays the same size at every zoom, so it can be read even on small pins.
        const badge = document.createElement('span');
        badge.className = 'photo-pin-count';
        badge.textContent = count;
        wrap.append(badge);
      }
      return L.divIcon({ html: wrap, className: '', iconSize: [62 * scale, 82 * scale], iconAnchor: [31 * scale, 90 * scale] });
    };
    // A pin with several photos: zoom in until they come apart; photos taken at one spot are listed instead.
    // Each tap goes deep enough that no single pin keeps more than half of the photos, as long as three in five
    // of them stay on the screen (centred on the middle photo), so a large pile comes apart in a few taps.
    const openGroup = items => {
      const bounds = L.latLngBounds(items.map(photo => [photo.lat, photo.lng]));
      const max = map.getMaxZoom();
      // Photos within a few dozen metres of each other (at most three pins even fully zoomed in) are listed instead.
      if (groupsAt(items, max).length <= 3) { callbacks.current.onOpenGroup?.(items); return; }
      // Room above each point for its photo, and below for the add button.
      const { x: width, y: height } = map.getSize();
      const top = Math.min(100, height * .3), bottom = Math.min(120, height * .3);
      const fitting = { paddingTopLeft: [40, top], paddingBottomRight: [40, bottom] };
      const fit = map.getBoundsZoom(bounds, false, L.point(fitting.paddingTopLeft).add(fitting.paddingBottomRight));
      // Up to 24 photos within a couple of kilometres (they fit on the screen at zoom 14): a list is quicker than more taps.
      if (items.length <= 24 && fit >= 14) { callbacks.current.onOpenGroup?.(items); return; }
      const middle = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const centre = L.latLng(middle(items.map(photo => photo.lat)), middle(items.map(photo => photo.lng)));
      const shown = zoom => {
        const c = map.project(centre, zoom);
        return items.filter(photo => { const p = map.project([photo.lat, photo.lng], zoom);
          return Math.abs(p.x - c.x) <= width / 2 - 40 && p.y - c.y >= top - height / 2 && p.y - c.y <= height / 2 - bottom; }).length / items.length;
      };
      let chosen = null;
      for (let zoom = Math.min(max, Math.max(map.getZoom() + 1, fit)); zoom <= max; zoom++) {
        const groups = groupsAt(items, zoom);
        if (groups.length < 2) continue;
        if (chosen !== null && zoom > fit && shown(zoom) < .6) break;
        chosen = zoom;
        if (Math.max(...groups.map(group => group.items.length)) <= items.length / 2) break;
      }
      if (chosen === null) callbacks.current.onOpenGroup?.(items);
      else if (chosen <= fit) map.fitBounds(bounds, { ...fitting, maxZoom: chosen });
      else map.setView(centre, chosen);
    };
    const draw = () => {
      // Regrouping replaces the pins; keep the keyboard on the pin that holds the same photo.
      const focused = layer.getLayers().find(marker => marker.getElement() === document.activeElement);
      layer.clearLayers();
      const zoom = map.getZoom();
      const scale = pinScale(zoom);
      for (const { items } of groupsAt(photos, zoom)) {
        const [face] = items;
        const activate = () => {
          if (callbacks.current.selecting) return;
          if (items.length > 1) openGroup(items);
          else callbacks.current.onOpen(face);
        };
        const marker = L.marker([face.lat, face.lng], {
          icon: makeIcon(face, items.length, scale),
          title: items.length > 1 ? 'この辺りの写真 ' + items.length + '枚' : face.caption || '写真を開く',
        }).addTo(layer).on('click', event => { L.DomEvent.stopPropagation(event); activate(); })
          // Leaflet only focuses pins; Enter and Space open them like a tap.
          .on('keypress', event => {
            if (event.originalEvent.key !== 'Enter' && event.originalEvent.key !== ' ') return;
            event.originalEvent.preventDefault();
            activate();
          });
        marker.photos = items;
        if (focused && items.includes(focused.photos[0])) marker.getElement()?.focus({ preventScroll: true });
      }
    };
    draw();
    map.on('zoomend', draw);
    return () => {
      map.off('zoomend', draw);
      layer.remove();
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
      // Room above for the photo on each pin, and below for the add button, so no pin hides under it.
      const bar = container.current.parentElement?.querySelector('.capture-bar');
      const below = bar ? Math.max(0, container.current.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) + 12 : 24;
      // Low screens (phones held sideways) keep a thinner edge, so the photos can spread over the short map.
      // The sides stay wide enough that no pin ends up under the zoom pair (left) or "すべて表示" (right).
      const low = window.matchMedia?.('(max-height: 500px)').matches;
      mapRef.current.fitBounds(L.latLngBounds(photos.map(p => [p.lat, p.lng])).pad(low ? .05 : .2),
        { maxZoom: 16, paddingTopLeft: [low ? 40 : 24, 80], paddingBottomRight: [low ? 72 : 24, below] });
    }
  }, [fitRequest, photos]);
  return <div id="map" ref={container} />;
}
