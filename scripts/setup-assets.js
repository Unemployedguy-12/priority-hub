'use strict';
// Copia fuentes e iconos desde node_modules y genera el icono de la app (sin dependencias extra).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, ...p);

function copy(from, to) {
  if (!fs.existsSync(from)) { console.warn('setup-assets: falta', from); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

copy(nm('@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'), out('assets/fonts/bricolage-grotesque-latin-wght-normal.woff2'));
for (const w of [400, 500, 700]) copy(nm(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`), out(`assets/fonts/jetbrains-mono-latin-${w}-normal.woff2`));
for (const [dir, woff] of [['regular', 'Phosphor.woff2'], ['fill', 'Phosphor-Fill.woff2']]) {
  copy(nm('@phosphor-icons/web/src', dir, 'style.css'), out('assets/phosphor', dir, 'style.css'));
  copy(nm('@phosphor-icons/web/src', dir, woff), out('assets/phosphor', dir, woff));
}

/* ---- icono: tres barras de prioridad ámbar sobre grafito ---- */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(S) {
  const k = S / 512, raw = Buffer.alloc((S * 4 + 1) * S);
  const inRR = (x, y, x0, y0, w, h, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x0 + w - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
    return x >= x0 && x < x0 + w && y >= y0 && y < y0 + h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const bars = [[300, 1], [210, 0.75], [120, 0.5]];
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      let px = [0, 0, 0, 0];
      if (inRR(x, y, 16 * k, 16 * k, S - 32 * k, S - 32 * k, 110 * k)) {
        px = [14, 15, 16, 255];
        bars.forEach(([w, a], i) => {
          if (inRR(x, y, 106 * k, (150 + i * 86) * k, w * k, 54 * k, 27 * k)) px = [Math.round(255 * a + 14 * (1 - a)), Math.round(178 * a + 15 * (1 - a)), Math.round(36 * a + 16 * (1 - a)), 255];
        });
      }
      raw.set(px, y * (S * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [file, size] of [['build/icon.png', 512], ['assets/icon.png', 256]]) {
  fs.mkdirSync(path.dirname(out(file)), { recursive: true });
  fs.writeFileSync(out(file), icon(size));
}
console.log('setup-assets: listo');
