import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPins, pinScale } from '../src/pinGroups.js';

const size = { width: 62, height: 82, gap: 8 };

test('pins far apart stay on their own', () => {
  const groups = groupPins([{ x: 0, y: 0, item: 'a' }, { x: 200, y: 0, item: 'b' }, { x: 0, y: 200, item: 'c' }], size);
  assert.deepEqual(groups.map(g => g.items), [['a'], ['b'], ['c']]);
});

test('pins that would cover or touch each other become one, standing where the first one is', () => {
  const groups = groupPins([{ x: 100, y: 100, item: 'new' }, { x: 130, y: 140, item: 'old' }, { x: 169, y: 100, item: 'touching' }, { x: 171, y: 100, item: 'apart' }], size);
  assert.deepEqual(groups.map(g => [g.x, g.y, g.items]), [[100, 100, ['new', 'old', 'touching']], [171, 100, ['apart']]]);
});

test('photos at the very same place always share one pin', () => {
  const groups = groupPins([1, 2, 3].map(item => ({ x: 5, y: 5, item })), size);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items, [1, 2, 3]);
});

test('group pins never cover each other', () => {
  const points = Array.from({ length: 300 }, (_, i) => ({ x: (i * 37) % 500, y: (i * 53) % 400, item: i }));
  const groups = groupPins(points, size);
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i], b = groups[j];
    assert.ok(Math.abs(a.x - b.x) >= 70 || Math.abs(a.y - b.y) >= 90);
  }
  assert.equal(groups.reduce((sum, g) => sum + g.items.length, 0), 300);
});

test('pins are smaller far out but never too small to tap', () => {
  assert.equal(pinScale(16), 1);
  assert.equal(pinScale(20), 1.15);
  assert.equal(pinScale(5), 0.45);
  assert.ok(62 * pinScale(5) >= 27);
});
