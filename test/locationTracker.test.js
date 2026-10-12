import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackLocation } from '../src/locationTracker.js';
function mock() {
  const page = new EventTarget();
  page.visibilityState = 'visible';
  const watches = [], cleared = [], positions = [], errors = [];
  const geolocation = {
    watchPosition(success, error, options) { watches.push({ success, error, options }); return watches.length - 1; },
    clearWatch(id) { cleared.push(id); },
  };
  const tracker = trackLocation({ geolocation, page, onPosition: p => positions.push(p), onError: e => errors.push(e) });
  return { page, watches, cleared, positions, errors, tracker };
}
const fix = lat => ({ coords: { latitude: lat, longitude: 130, accuracy: 5 }, timestamp: 100 });
test('moving updates position and retry does not duplicate active watch', () => {
  const m = mock();
  m.watches[0].success(fix(31)); m.watches[0].success(fix(32));
  assert.deepEqual(m.positions.map(p => p.lat), [31,32]);
  m.tracker.retry();
  assert.equal(m.watches.length, 1);
  m.tracker.dispose();
  assert.deepEqual(m.cleared, [0]);
});
test('hidden page stops tracking, ignores late fixes, and resumes when visible', () => {
  const m = mock();
  m.page.visibilityState = 'hidden'; m.page.dispatchEvent(new Event('visibilitychange'));
  m.watches[0].success(fix(99));
  assert.equal(m.positions.length, 0);
  assert.deepEqual(m.cleared, [0]);
  m.page.visibilityState = 'visible'; m.page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(m.watches.length, 2);
  m.watches[1].success(fix(33)); assert.equal(m.positions[0].lat, 33);
  m.tracker.dispose();
  m.page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(m.watches.length, 2);
});
test('permission denial stops watch and requires explicit retry', () => {
  const m = mock();
  m.watches[0].error({ code: 1 });
  m.page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(m.watches.length, 1);
  m.tracker.retry(); assert.equal(m.watches.length, 2);
  m.tracker.dispose();
});
