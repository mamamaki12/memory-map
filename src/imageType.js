// Identify JPEG, PNG and WebP from their first bytes; anything else is not treated as a photo.
export function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'png';
  const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  return null;
}
