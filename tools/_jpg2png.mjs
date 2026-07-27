// Decode a JPEG to PNG so the PNG-only measurement tools can read the
// reference frames. No image library is vendored and none may be downloaded
// (§4 no-assets), but playwright's chromium is already a devDependency and
// decodes JPEG natively.
//   node tools/_jpg2png.mjs in.jpg out.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const [inp, outp] = process.argv.slice(2);
const b64 = readFileSync(inp).toString('base64');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const data = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}, `data:image/jpeg;base64,${b64}`);
writeFileSync(outp, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
console.log(`${inp} -> ${outp}`);
