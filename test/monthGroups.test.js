import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGroups, showMonthHeadings } from '../src/monthGroups.js';

const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

test('photos are split into months in the order given, newest first', () => {
  const photos = [{ id: 'a', createdAt: at(2026, 11, 10) }, { id: 'b', createdAt: at(2026, 11, 1) }, { id: 'c', createdAt: at(2026, 10, 31) }, { id: 'd', createdAt: at(2025, 10, 5) }];
  const groups = monthGroups(photos);
  assert.deepEqual(groups.map(g => [g.label, g.photos.map(p => p.id)]), [['2026年11月', ['a', 'b']], ['2026年10月', ['c']], ['2025年10月', ['d']]]);
});

test('no photos, no months', () => {
  assert.deepEqual(monthGroups([]), []);
});

test('headings only for eight or more photos with about two or more per month', () => {
  const photos = (n, perMonth) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, createdAt: new Date(2026, 10 - Math.floor(i / perMonth), 1, 12).getTime() }));
  assert.equal(showMonthHeadings(monthGroups(photos(5, 5))), false);
  assert.equal(showMonthHeadings(monthGroups(photos(9, 1))), false);
  assert.equal(showMonthHeadings(monthGroups(photos(9, 3))), true);
  assert.equal(showMonthHeadings(monthGroups(photos(200, 15))), true);
});
