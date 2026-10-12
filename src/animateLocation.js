// Interpolate display coordinates only; acquired GPS coordinates remain untouched.
export function animateLocation({
  from, to, onFrame, duration = 1000,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  now = () => performance.now(),
}) {
  let frame = null, stopped = false;
  const start = now();
  const longitudeDelta = ((to.lng - from.lng + 540) % 360) - 180;
  function tick(time) {
    if (stopped) return;
    const progress = Math.max(0, Math.min(1, (time - start) / duration));
    const eased = progress * progress * (3 - 2 * progress);
    onFrame({
      lat: from.lat + (to.lat - from.lat) * eased,
      lng: from.lng + longitudeDelta * eased,
      accuracy: from.accuracy + (to.accuracy - from.accuracy) * eased,
    });
    if (progress < 1) frame = requestFrame(tick);
    else frame = null;
  }
  frame = requestFrame(tick);
  return () => { stopped = true; if (frame !== null) cancelFrame(frame); };
}
