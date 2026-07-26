// Refresh reference/ — the visual bar this project is aiming at, as actual
// frames rather than recollection. Pulls a curated, varied spread from the two
// game wikis, normalises everything to PNG at a sane width, and writes a
// manifest with source URLs so provenance stays attached to every file.
//
//   node tools/fetch_reference.mjs
//
// Both wikis serve WebP by content negotiation regardless of file extension,
// and this container has neither ImageMagick nor PIL — so decode/downscale goes
// through the Chromium that Playwright already installed.

import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Node's global fetch does not honour HTTPS_PROXY, so in a proxied sandbox it
// tries to connect directly and dies on a TLS protocol alert. curl already
// respects the environment's proxy and CA bundle — use it.
const curl = (url, binary = false) => execFileSync('curl', [
  '-sSL', '--max-time', '120', '-A', 'Mozilla/5.0', url,
], { maxBuffer: 1 << 28, encoding: binary ? 'buffer' : 'utf8' });

const MAX_W = 1600;

// Curated for VARIETY of view, not for prettiness: surface at eye level,
// surface from the air, orbit, limb/terminator, rings, nebulae, canyons,
// sunsets, hardware against a planet. Those are the situations this renderer
// has to hold up in.
const SETS = {
  'star-citizen': {
    api: 'https://starcitizen.tools/api.php',
    credit: 'Cloud Imperium Games — Star Citizen. Via starcitizen.tools.',
    files: [
      'File:MicroTech 01 122019-Min.jpg',        // snow vista, deep aerial perspective
      'File:Dunboro aerial view, microTech.jpg', // green hills from the air
      'File:Drifters, microTech.jpg',            // long shadows, ground micro-relief
      'File:Planet-microtech-1.jpg',             // planet from space
      'File:Planet-arccorp-1.jpg',               // planet from space
      'File:AresIon-microTech-VolumetricClouds.png',
      'File:ArcCorp Clouds.jpg',
      'File:Hurston 122019-Min.jpg',
      'File:Hurston OuterDistricts v002.jpg',
      'File:Daymar 122019-Min.jpg',
      'File:Wailing Rock, Daymar.webp',
      'File:Arccorp-area18-low-orbit.jpg',       // low orbit, limb
      'File:Stanton-arccorp-orbit-3.12.jpg',
      'File:Pyro - Monox from orbit.png',
      'File:Pyro I from orbit.png',
      'File:Ursa Rover Daymar Sunset.jpg',
      'File:Aurora MR flying over canyon on Daymar.jpg',
      'File:Syulen leaving microTech.png',
    ],
  },
  'elite-dangerous': {
    api: 'https://elite-dangerous.fandom.com/api.php',
    credit: 'Frontier Developments — Elite Dangerous. Via elite-dangerous.fandom.com.',
    files: [
      'File:ED-Odyssey-Atmospheric-Planet.jpg',  // the limb: the reference frame
      'File:ED-Odyssey-Desert-Planet-Cobra-mk3.png',
      'File:Sidewinder atmospheric planet.jpg',
      'File:Oxygen Atmosphere 2 SRV.jpg',
      'File:Nitrogen Atmosphere ED 1.jpg',
      'File:Methane Atmosphere ED 1.jpg',
      'File:Canyon Planet.jpg',
      'File:Canyon Planet 2.jpg',
      'File:Sunset on Aquari.png',
      'File:Star Rise over a Planet.jpg',
      'File:Star Rise Anaconda.jpg',
      'File:Gas-Giant-Planetary-Ring-Col-359-Sector-MW-V-D2-62.png',
      'File:Planetary-Ring-Imperial-Clipper.png',
      'File:Lava-Planet-Planetary-Ring-Close-Up.png',
      'File:Horsehead-Nebula.png',               // nebula structure in deep space
      'File:California-Nebula-2.png',
      'File:Coriolis-Station-and-Planet.png',
      'File:Apex shuttle orbit.png',
    ],
  },
};

async function resolve(api, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 10) {
    const batch = titles.slice(i, i + 10);
    const url = `${api}?action=query&prop=imageinfo&iiprop=url|size&format=json&titles=${
      batch.map(encodeURIComponent).join('|')}`;
    const d = JSON.parse(curl(url));
    for (const p of Object.values(d.query.pages)) {
      if (p.imageinfo) out[p.title] = p.imageinfo[0].url;
    }
  }
  return out;
}

const slug = (t) => t.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const manifest = [];

for (const [dir, set] of Object.entries(SETS)) {
  await mkdir(`reference/${dir}`, { recursive: true });
  const urls = await resolve(set.api, set.files);
  let n = 0;
  for (const title of set.files) {
    const src = urls[title];
    if (!src) { console.warn('! unresolved', title); continue; }
    try {
      const b64 = curl(src, true).toString('base64');
      if (b64.length < 100) throw new Error('empty response');
      // decode whatever it actually is (usually WebP) and downscale in-page
      const dataUrl = await page.evaluate(async ([d, maxW]) => {
        const img = new Image();
        img.src = 'data:image/*;base64,' + d;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = Math.min(img.width, maxW);
        c.height = Math.round(img.height * c.width / img.width);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        // JPEG, not PNG: these are photographic frames, and lossless encoding
        // cost 66 MB of repo for no visible benefit over q0.88.
        return c.toDataURL('image/jpeg', 0.88);
      }, [b64, MAX_W]);
      const name = `${slug(title)}.jpg`;
      await writeFile(`reference/${dir}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
      manifest.push({ dir, file: name, title, source: src, credit: set.credit });
      n++;
      console.log(`✓ ${dir}/${name}`);
    } catch (e) {
      console.warn(`! ${title}: ${e.message}`);
    }
  }
  console.log(`${dir}: ${n} image(s)`);
}

await writeFile('reference/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
console.log(`\nmanifest: ${manifest.length} entries`);
