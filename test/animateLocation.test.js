import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animateLocation } from '../src/animateLocation.js';
function clock() {
  let sequence = 0;
  const callbacks = new Map();
  return {
    now: () => 0,
    requestFrame: cb => { callbacks.set(++sequence, cb); return sequence; },
    cancelFrame: id => callbacks.delete(id),
    step(time) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(cb => cb(time)); },
    callbacks,
  };
}
test('position and accuracy move smoothly together and arrive at the fix', () => {
  const timer = clock(), output = [];
  animateLocation({ from: { lat: 0, lng: 0, accuracy: 10 }, to: { lat: 1, lng: 2, accuracy: 30 }, onFrame: p => output.push(p), ...timer });
  timer.step(0); timer.step(500); timer.step(1000);
  assert.deepEqual(output[0], { lat: 0, lng: 0, accuracy: 10 });
  assert.deepEqual(output[1], { lat: .5, lng: 1, accuracy: 20 });
  assert.deepEqual(output[2], { lat: 1, lng: 2, accuracy: 30 });
  assert.equal(timer.callbacks.size, 0);
});
test('retargeting continues from the currently displayed position; old callbacks cannot move it', () => {
  const timer = clock();
  let shown = { lat: 0, lng: 0, accuracy: 10 };
  const stop = animateLocation({ from: shown, to: { lat: 1, lng: 2, accuracy: 20 }, onFrame: p => { shown = p; }, ...timer });
  timer.step(500);
  const stale = [...timer.callbacks.values()][0];
  stop();
  const start = { ...shown };
  animateLocation({ from: start, to: { lat: 2, lng: 4, accuracy: 30 }, onFrame: p => { shown = p; }, ...timer });
  stale(1000);
  assert.deepEqual(shown, start);
  timer.step(0); assert.deepEqual(shown, start);
  timer.step(1000); assert.deepEqual(shown, { lat: 2, lng: 4, accuracy: 30 });
});
test('crossing longitude boundary follows the short route', () => {
  const timer = clock(); let shown;
  animateLocation({ from: { lat: 0, lng: 179, accuracy: 1 }, to: { lat: 0, lng: -179, accuracy: 1 }, onFrame: p => { shown = p; }, ...timer });
  timer.step(500); assert.equal(shown.lng, 180);
  timer.step(1000); assert.equal(shown.lng, 181);
});
