// Read the shooting place (GPS) that a camera stored in a JPEG photo's EXIF.
// Only the start of the file is read: EXIF sits in the APP1 block near the beginning.
export const EXIF_READ_BYTES = 128 * 1024;

const GPS_IFD_POINTER = 0x8825;
const TYPE_ASCII = 2, TYPE_LONG = 4, TYPE_RATIONAL = 5, TYPE_SRATIONAL = 10;

// Returns { lat, lng } or null when the bytes have no usable GPS position.
export function exifLocation(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const tiff = findExif(bytes);
    return tiff ? readGps(tiff) : null;
  } catch {
    return null;
  }
}

// Read the GPS position of a picked photo. Any problem means "no position".
export async function readPhotoLocation(file) {
  try {
    return exifLocation(await file.slice(0, EXIF_READ_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

// Walk the JPEG markers up to the image data and return the TIFF part of the EXIF block.
function findExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; } // no length
    if (marker === 0xda || marker === 0xd9) return null; // image data or end: no EXIF before it
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const start = offset + 4, end = offset + 2 + length;
    if (marker === 0xe1 && end <= bytes.length && end - start >= 6 &&
        String.fromCharCode(...bytes.subarray(start, start + 6)) === 'Exif\0\0') {
      return new DataView(bytes.buffer, bytes.byteOffset + start + 6, end - start - 6);
    }
    offset = end;
  }
  return null;
}

function readGps(view) {
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null; // "II" little endian, "MM" big endian
  const little = order === 0x4949;
  const u16 = at => view.getUint16(at, little);
  const u32 = at => view.getUint32(at, little);
  if (u16(2) !== 42) return null;

  const entries = ifdOffset => {
    const count = u16(ifdOffset);
    const list = new Map();
    for (let index = 0; index < count; index += 1) {
      const at = ifdOffset + 2 + index * 12;
      list.set(u16(at), { type: u16(at + 2), count: u32(at + 4), at: at + 8 });
    }
    return list;
  };

  const pointer = entries(u32(4)).get(GPS_IFD_POINTER);
  if (!pointer || pointer.type !== TYPE_LONG) return null;
  const gps = entries(u32(pointer.at));

  const ref = tag => {
    const entry = gps.get(tag);
    return entry && entry.type === TYPE_ASCII && entry.count >= 1 ? String.fromCharCode(view.getUint8(entry.at)) : null;
  };
  const degrees = tag => {
    const entry = gps.get(tag);
    if (!entry || (entry.type !== TYPE_RATIONAL && entry.type !== TYPE_SRATIONAL) || entry.count !== 3) return NaN;
    const start = u32(entry.at); // 3 rationals (24 bytes) never fit inline
    const parts = [0, 1, 2].map(index => {
      const denominator = u32(start + index * 8 + 4);
      return denominator ? u32(start + index * 8) / denominator : NaN;
    });
    return parts[0] + parts[1] / 60 + parts[2] / 3600;
  };

  const latRef = ref(1), lngRef = ref(3);
  if (!['N', 'S'].includes(latRef) || !['E', 'W'].includes(lngRef)) return null;
  const lat = degrees(2) * (latRef === 'S' ? -1 : 1);
  const lng = degrees(4) * (lngRef === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // cameras write 0/0 when they had no position
  return { lat, lng };
}
