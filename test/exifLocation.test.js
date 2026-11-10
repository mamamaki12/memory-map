import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exifLocation, readPhotoLocation, EXIF_READ_BYTES } from '../src/exifLocation.js';

// Build a small JPEG whose EXIF holds a GPS position, like a phone camera writes it.
function jpegWithGps({ little = false, latRef = 'N', lat = [35, 40, 48.3], lngRef = 'E', lng = [139, 45, 36.9], before = [] } = {}) {
  const tiff = new DataView(new ArrayBuffer(200));
  const u16 = (at, value) => tiff.setUint16(at, value, little);
  const u32 = (at, value) => tiff.setUint32(at, value, little);
  const entry = (at, tag, type, count, value) => { u16(at, tag); u16(at + 2, type); u32(at + 4, count); u32(at + 8, value); };
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d); // "II" or "MM" reads the same in either order
  u16(2, 42);
  u32(4, 8);
  // IFD0: one entry pointing to the GPS IFD at 26.
  u16(8, 1);
  entry(10, 0x8825, 4, 1, 26);
  u32(22, 0);
  // GPS IFD at 26: 4 entries, rationals stored after it at 80 and 104.
  u16(26, 4);
  const ascii = letter => little ? letter.charCodeAt(0) : letter.charCodeAt(0) * 0x1000000;
  entry(28, 1, 2, 2, ascii(latRef));
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, ascii(lngRef));
  entry(64, 4, 5, 3, 104);
  u32(76, 0);
  const rationals = (at, values) => values.forEach((value, index) => { u32(at + index * 8, Math.round(value * 100)); u32(at + index * 8 + 4, 100); });
  rationals(80, lat);
  rationals(104, lng);
  const body = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat([...new Uint8Array(tiff.buffer, 0, 128)]);
  const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return new Uint8Array([0xff, 0xd8, ...before, ...app1, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
}
const jfif = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
const near = (actual, lat, lng) => {
  assert.ok(actual, 'position expected');
  assert.ok(Math.abs(actual.lat - lat) < 1e-6, `lat ${actual.lat}`);
  assert.ok(Math.abs(actual.lng - lng) < 1e-6, `lng ${actual.lng}`);
};

test('big-endian EXIF in the northern and eastern hemispheres', () => {
  near(exifLocation(jpegWithGps()), 35 + 40 / 60 + 48.3 / 3600, 139 + 45 / 60 + 36.9 / 3600);
});
test('little-endian EXIF in the southern and western hemispheres', () => {
  near(exifLocation(jpegWithGps({ little: true, latRef: 'S', lat: [22, 54, 30], lngRef: 'W', lng: [43, 10, 15] })),
    -(22 + 54 / 60 + 30 / 3600), -(43 + 10 / 60 + 15 / 3600));
});
test('mixed hemispheres and an APP0 block before the EXIF', () => {
  near(exifLocation(jpegWithGps({ little: true, latRef: 'N', lngRef: 'W', lat: [51, 30, 0], lng: [0, 7, 30], before: jfif })), 51.5, -0.125);
  near(exifLocation(jpegWithGps({ latRef: 'S', lngRef: 'E', lat: [33, 52, 0], lng: [151, 12, 0] }).buffer), -(33 + 52 / 60), 151.2);
});
test('photos without a usable position give null', () => {
  const noExif = new Uint8Array([0xff, 0xd8, ...jfif, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const zero = jpegWithGps({ lat: [0, 0, 0], lng: [0, 0, 0] });
  const outOfRange = jpegWithGps({ lat: [95, 0, 0] });
  const badRef = jpegWithGps({ latRef: 'X' });
  for (const bytes of [new Uint8Array(), noExif, png, zero, outOfRange, badRef]) assert.equal(exifLocation(bytes), null);
});
test('broken EXIF data gives null instead of throwing', () => {
  const full = jpegWithGps();
  const truncated = full.slice(0, 60);
  const badOrder = full.slice(); badOrder[12] = 0x41; badOrder[13] = 0x41;
  const zeroDenominator = full.slice(); zeroDenominator.fill(0, 12 + 80 + 4, 12 + 80 + 8);
  const pointerOutside = full.slice(); pointerOutside.set([0x7f, 0xff, 0xff, 0xff], 12 + 18);
  const badLength = full.slice(); badLength[4] = 0; badLength[5] = 1;
  for (const bytes of [truncated, badOrder, zeroDenominator, pointerOutside, badLength]) assert.equal(exifLocation(bytes), null);
});
test('readPhotoLocation reads only the start of the file', async () => {
  const photo = new Blob([jpegWithGps(), new Uint8Array(EXIF_READ_BYTES)], { type: 'image/jpeg' });
  let sliced;
  const file = { slice: (...range) => { sliced = range; return photo.slice(...range); } };
  near(await readPhotoLocation(file), 35 + 40 / 60 + 48.3 / 3600, 139 + 45 / 60 + 36.9 / 3600);
  assert.deepEqual(sliced, [0, EXIF_READ_BYTES]);
  assert.equal(await readPhotoLocation(new Blob(['not a photo'])), null);
  assert.equal(await readPhotoLocation({ slice() { throw new Error('unreadable'); } }), null);
});
