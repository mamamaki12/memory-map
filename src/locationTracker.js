// One watch per visible page; ignore late callbacks after hiding or stopping.
export function trackLocation({ geolocation, page, onPosition, onError }) {
  let watch = null, generation = 0, disposed = false, denied = false, lastError = null;
  function stop() {
    generation++;
    if (watch !== null) geolocation.clearWatch(watch);
    watch = null;
  }
  function start() {
    if (disposed || denied || page.visibilityState === 'hidden' || watch !== null) return;
    const token = ++generation;
    watch = geolocation.watchPosition(position => {
      if (disposed || token !== generation || page.visibilityState === 'hidden') return;
      lastError = null;
      onPosition({
        lat: position.coords.latitude, lng: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp,
      });
    }, error => {
      if (disposed || token !== generation) return;
      if (error.code === 1) { denied = true; stop(); }
      if (lastError !== error.code) { lastError = error.code; onError(error); }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function visibility() { if (page.visibilityState === 'hidden') stop(); else start(); }
  page.addEventListener('visibilitychange', visibility);
  start();
  return {
    retry() { denied = false; lastError = null; start(); },
    dispose() { disposed = true; stop(); page.removeEventListener('visibilitychange', visibility); },
  };
}
