// Photo pins that would cover each other on the screen are drawn as one pin with a number.
// `points` are screen positions ({ x, y, item }) in the order they should win (newest first);
// a pin is `width` x `height` pixels and should keep `gap` pixels from the next one.
// The first point of a group is where the group's pin stands, so group pins never cover each other.
export function groupPins(points, { width, height, gap = 8 }) {
  const groups = [];
  for (const point of points) {
    const group = groups.find(g => Math.abs(g.x - point.x) < width + gap && Math.abs(g.y - point.y) < height + gap);
    if (group) group.items.push(point.item);
    else groups.push({ x: point.x, y: point.y, items: [point.item] });
  }
  return groups;
}

// How big a pin is drawn at a map zoom: smaller far out, with a minimum that can still be tapped.
export function pinScale(zoom) {
  return Math.max(0.45, Math.min(1.15, 2 ** ((zoom - 16) / 6)));
}
