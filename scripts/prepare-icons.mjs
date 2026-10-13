import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/icon-landscape.svg', import.meta.url));
for (const size of [180, 192, 512]) {
  const png = await sharp(source).resize(size, size).png().toBuffer();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('../public/icon-landscape-' + size + '.png', import.meta.url), png);
  // Keep earlier manifest URLs consistent for installed apps that refresh them.
  if (size !== 180) await writeFile(new URL('../public/icon-' + size + '.png', import.meta.url), png);
}
console.log('Generated landscape pin app icons (180, 192, 512px).');
