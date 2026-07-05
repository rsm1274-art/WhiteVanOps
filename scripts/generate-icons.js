// Renders public/logo.svg into all raster brand assets:
//   public/logo.png            512px app logo (replaces old logo.png)
//   public/icons/icon-192.png  PWA manifest icon
//   public/icons/icon-512.png  PWA manifest icon
//   public/apple-touch-icon.png 180px iOS home-screen icon
//   src/app/favicon.ico        multi-size favicon (16/32/48/64/128/256)
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'logo.svg'));

async function render(size, dest) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(dest);
  console.log(`${dest} (${size}px)`);
}

(async () => {
  fs.mkdirSync(path.join(root, 'public', 'icons'), { recursive: true });

  await render(512, path.join(root, 'public', 'logo.png'));
  await render(192, path.join(root, 'public', 'icons', 'icon-192.png'));
  await render(512, path.join(root, 'public', 'icons', 'icon-512.png'));
  await render(180, path.join(root, 'public', 'apple-touch-icon.png'));

  const icoSizes = [16, 32, 48, 64, 128, 256];
  const tmp = [];
  for (const s of icoSizes) {
    const p = path.join(root, 'public', 'icons', `_fav-${s}.png`);
    await render(s, p);
    tmp.push(p);
  }
  const ico = await pngToIco(tmp);
  fs.writeFileSync(path.join(root, 'src', 'app', 'favicon.ico'), ico);
  console.log('src/app/favicon.ico');
  tmp.forEach((p) => fs.unlinkSync(p));
})();
