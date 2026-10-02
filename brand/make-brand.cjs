// Builds the Davo logo files: SVGs with the wordmark outlined (no font needed) and PNG app icons.
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const sharp = require('sharp');

// Run from the repo root after: npm i --no-save opentype.js@1 sharp@0.34, with Fredoka Bold (OFL) saved as brand/fredoka-700.ttf.
const OUT = __dirname;
fs.mkdirSync(OUT, { recursive: true });

const BRAND = '#6D28D9';
const GOLD = '#FBBF24';
const WHITE = '#FFFFFF';
const INK = '#1E1B3A';

// The mark in its 64-unit design grid: a D-shaped shopping bag with a wide gold carrier handle.
// (A narrow thick handle plus a centred dot read as a padlock, so the handle is a thin wide loop and there is no dot.)
const mark = (body, handle = GOLD) =>
  `<path d="M19 28C19 13 37 13 37 28" fill="none" stroke="${handle}" stroke-width="4" stroke-linecap="round"/>` +
  `<path d="M16 26h16a17 17 0 0 1 0 34H16a4 4 0 0 1-4-4V30a4 4 0 0 1 4-4z" fill="${body}"/>`;
// Visual box of the mark: x 12–49, y 15–60.
const MARK_BOX = { x: 12, y: 15, w: 37, h: 45 };

const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>\n`;

// Mark alone, trimmed to its visual box.
const markOnly = (color) =>
  svg(MARK_BOX.w, MARK_BOX.h, `<g transform="translate(${-MARK_BOX.x} ${-MARK_BOX.y})">${mark(color)}</g>`).replace(
    `width="${MARK_BOX.w}" height="${MARK_BOX.h}"`,
    `width="${MARK_BOX.w * 4}" height="${MARK_BOX.h * 4}"`,
  );

// App icon: mark centred on a blue tile. `scale` keeps it inside the safe zone; `radius` 0 for maskable.
const appIcon = (size, { radius = 0.225, scale = 0.62 } = {}) => {
  const s = (size * scale) / MARK_BOX.h;
  const tx = size / 2 - (MARK_BOX.x + MARK_BOX.w / 2) * s;
  const ty = size / 2 - (MARK_BOX.y + MARK_BOX.h / 2) * s;
  return svg(size, size, `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${BRAND}"/><g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${mark(WHITE)}</g>`);
};

// Wordmark "davo" in Fredoka Bold, outlined.
const font = opentype.loadSync(path.join(__dirname, 'fredoka-700.ttf'));
const FONT_SIZE = 136;
const text = font.getPath('davo', 0, 0, FONT_SIZE, { letterSpacing: -2 / FONT_SIZE });
const tb = text.getBoundingBox();
const textPath = (color) => text.toPathData(2).length && `<path d="${text.toPathData(2)}" fill="${color}"/>`;

// Lockup: mark 132 px tall-ish beside the wordmark, as on the concept board.
const lockup = (markColor, textColor) => {
  const markH = (132 * MARK_BOX.h) / 64;
  const s = markH / MARK_BOX.h;
  const gap = 24;
  const textH = tb.y2 - tb.y1;
  const height = Math.ceil(Math.max(markH, textH));
  const markY = (height - markH) / 2;
  const textX = MARK_BOX.w * s + gap - tb.x1;
  const textY = (height - textH) / 2 - tb.y1;
  const width = Math.ceil(MARK_BOX.w * s + gap + (tb.x2 - tb.x1));
  return svg(
    width,
    height,
    `<g transform="translate(${(-MARK_BOX.x * s).toFixed(2)} ${(markY - MARK_BOX.y * s).toFixed(2)}) scale(${s.toFixed(4)})">${mark(markColor)}</g>` +
      `<g transform="translate(${textX.toFixed(2)} ${textY.toFixed(2)})">${textPath(textColor)}</g>`,
  );
};

const wordmark = (color) => {
  const w = Math.ceil(tb.x2 - tb.x1);
  const h = Math.ceil(tb.y2 - tb.y1);
  return svg(w, h, `<g transform="translate(${-tb.x1} ${-tb.y1})">${textPath(color)}</g>`);
};

const files = {
  'davo-logo.svg': lockup(BRAND, BRAND),
  'davo-logo-white.svg': lockup(WHITE, WHITE),
  'davo-logo-ink.svg': lockup(BRAND, INK),
  'davo-wordmark.svg': wordmark(BRAND),
  'davo-mark.svg': markOnly(BRAND),
  'davo-mark-white.svg': markOnly(WHITE),
  'davo-app-icon.svg': appIcon(512),
  'davo-app-icon-maskable.svg': appIcon(512, { radius: 0, scale: 0.5 }),
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);

(async () => {
  const png = async (svgText, size, name) => {
    await sharp(Buffer.from(svgText), { density: 300 }).resize(size, size).png().toFile(path.join(OUT, name));
  };
  await png(files['davo-app-icon.svg'], 512, 'davo-app-icon-512.png');
  await png(files['davo-app-icon.svg'], 192, 'davo-app-icon-192.png');
  await png(files['davo-app-icon-maskable.svg'], 512, 'davo-app-icon-maskable-512.png');
  // Apple draws its own rounded corners, so the touch icon is full-bleed.
  await png(appIcon(180, { radius: 0, scale: 0.6 }), 180, 'apple-touch-icon.png');
  await png(appIcon(64, { radius: 0.2, scale: 0.7 }), 32, 'favicon-32.png');
  await sharp(Buffer.from(files['davo-logo.svg']), { density: 300 }).resize({ width: 1200 }).png().toFile(path.join(OUT, 'davo-logo-1200.png'));
  await sharp(Buffer.from(files['davo-logo-white.svg']), { density: 300 }).resize({ width: 1200 }).flatten({ background: BRAND }).png().toFile(path.join(OUT, 'davo-logo-on-violet-1200.png'));
  console.log(fs.readdirSync(OUT).map((f) => `${f} ${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)}KB`).join('\n'));
})();
