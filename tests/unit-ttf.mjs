import { readFileSync } from 'node:fs';
import { parseTtf, woffToSfnt } from '../js/ttf.js';
const exp = JSON.parse(readFileSync('/tmp/ttf_expect.json', 'utf8'));
let fails = 0; const t = (n, c) => { console.log(c ? 'ok  ' : 'FAIL', n); if (!c) fails++; };
for (const name of Object.keys(exp)) {
  const e = exp[name]; const ttf = new Uint8Array(readFileSync(new URL(`../vendor/fonts/${name}.ttf`, import.meta.url)));
  const f = parseTtf(ttf);
  t(`${name}: unitsPerEm`, f.unitsPerEm === e.upem); t(`${name}: 'A' glyph + advance`, f.cmap.get(0x41) === e.A[0] && f.advance(e.A[0]) === e.A[1]);
  t(`${name}: Rupee sign present`, f.cmap.get(0x20B9) === e.rupee[0]); t(`${name}: cmap size`, f.cmap.size === e.n); t(`${name}: ascent/descent`, f.ascent === e.asc && f.descent === e.desc);
  t(`${name}: PostScript name ${f.psName}`, f.psName === e.ps); t(`${name}: embeddable`, f.embeddable); t(`${name}: italic angle ${f.italicAngle.toFixed(1)}`, Math.abs(f.italicAngle - e.italic) < 0.01);
  const woff = new Uint8Array(readFileSync(`/tmp/${name}.woff`)); const back = await woffToSfnt(woff); const f2 = parseTtf(back);
  t(`${name}: WOFF→TTF round trip (cmap + advances equal)`, f2.cmap.size === f.cmap.size && f2.advance(e.A[0]) === f.advance(e.A[0]) && f2.psName === f.psName);
}
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
