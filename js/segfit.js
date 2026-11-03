// Reads the rendered page around a piece of text so that editing it behaves like Acrobat:
//  - the white cover only spans the real text (not an inflated width, and never the neighbouring table cells),
//  - table borders and rules that cross the covered box are kept,
//  - the original weight (bold) and family (sans / serif / mono) are carried over.
import { CSS_BUILTIN } from './fonts.js';
import { makeSeg } from './pdfio.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0xffffff; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = v => '#' + v.map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
const dist = (d, i, bg) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);

/** Pixels of a rectangle given in page points. */
function pixels(info, x, y, w, h) {
  const c = info.canvas; if (!c || !c.width) return null;
  const sx = c.width / info.w;
  const x0 = clamp(Math.floor(x * sx), 0, c.width), y0 = clamp(Math.floor(y * sx), 0, c.height);
  const x1 = clamp(Math.ceil((x + w) * sx), 0, c.width), y1 = clamp(Math.ceil((y + h) * sx), 0, c.height);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { d: c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data, W: x1 - x0, H: y1 - y0, x0, y0, sx };
}

/** Most common colour in a text box = background; the pixel farthest from it = ink colour. */
export function sampleColors(info, seg) {
  try {
    const P = pixels(info, seg.x - 1, seg.top, seg.w + 2, seg.h); if (!P) throw 0;
    const d = P.d, bins = new Map();
    for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); const b = bins.get(k) || bins.set(k, { n: 0, r: 0, g: 0, b: 0 }).get(k); b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; }
    let top = null; for (const b of bins.values()) if (!top || b.n > top.n) top = b;
    const bgc = [top.r / top.n, top.g / top.n, top.b / top.n].map(Math.round); // exact average of the dominant colour, so a white page stays #ffffff
    let far = 0, fc = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { const t = dist(d, i, bgc); if (t > far) { far = t; fc = [d[i], d[i + 1], d[i + 2]]; } }
    return { bg: toHex(bgc), fg: far > 90 ? toHex(fc) : '#000000' };
  } catch { return { bg: '#ffffff', fg: '#000000' }; }
}

const INK = 120; // colour distance from the background that counts as "ink"

/**
 * Real horizontal extent of a text segment (from the pixels), plus a stem-thickness figure used to tell bold from regular.
 * The extent stops at the first table border, and at a gap too wide to be inside one piece of text.
 */
export function fitSegment(info, seg) {
  const sx0 = info.canvas?.width ? info.canvas.width / info.w : 0;
  if (seg.fit && seg.fit.sx >= sx0 * 0.75) return seg.fit;
  const fit = { w: seg.w, stem: 0, bold: false, sx: sx0 };
  try {
    const { bg } = sampleColors(info, { x: seg.x, top: seg.top, w: Math.min(seg.w, seg.fs * 40), h: seg.h });
    const rgb = hexRgb(bg);
    const left = seg.x - 3, width = Math.min(seg.w + 6, info.w - left);
    const P = pixels(info, left, seg.top, width, seg.h); if (!P) throw 0;
    const { d, W, H, sx } = P;
    const cnt = new Uint16Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist(d, (y * W + x) * 4, rgb) > INK) cnt[x]++;
    // vertical rules: a thin band of columns that is inked from top to bottom of the line box
    const border = new Uint8Array(W), maxBand = Math.max(4, Math.ceil(2.6 * sx));
    for (let x = 0; x < W;) {
      if (cnt[x] >= Math.max(5, H * 0.92)) { let e = x; while (e + 1 < W && cnt[e + 1] >= Math.max(5, H * 0.92)) e++; if (e - x + 1 <= maxBand) for (let k = x; k <= e; k++) border[k] = 1; x = e + 1; } else x++;
    }
    const start = Math.max(0, Math.floor((seg.x - 1 - P.x0 / sx) * sx));
    const gapMax = Math.ceil(1.3 * seg.fs * sx);
    let last = -1, gap = 0;
    for (let x = start; x < W; x++) {
      if (border[x]) { if (last >= 0) break; continue; }
      if (cnt[x] > 0) { last = x; gap = 0; } else if (last >= 0 && ++gap > gapMax) break;
    }
    if (last >= 0) {
      const ink = (P.x0 + last + 1) / sx - seg.x + 0.5;
      fit.w = ink > seg.w * 1.15 + 3 ? seg.w : ink;
      // stem thickness: mean length of ink runs across the x-height band, in em
      let sum = 0, n = 0; const maxRun = Math.ceil(0.45 * seg.fs * sx);
      for (let y = Math.floor(H * 0.45); y < Math.ceil(H * 0.78); y++) {
        let run = 0;
        for (let x = start; x <= last + 1; x++) {
          const on = x <= last && !border[x] && dist(d, (y * W + x) * 4, rgb) > 200;
          if (on) run++; else { if (run > 0 && run <= maxRun) { sum += run; n++; } run = 0; }
        }
      }
      fit.stem = n ? sum / n / (seg.fs * sx) : 0;
      fit.bold = fit.stem > 0.19 && n > 6;
    }
  } catch {}
  seg.fit = fit; return fit;
}

const SANS = /arial|helvet|calibri|verdana|tahoma|segoe|roboto|open\s?sans|liberation\s?sans|dejavu\s?sans|lato|noto\s?sans|ubuntu|trebuchet|gill\s?sans|myriad|frutiger|futura|source\s?sans|sans/i;
const SERIF = /times|georgia|garamond|palatino|book\s?antiqua|bookman|century|cambria|minion|liberation\s?serif|dejavu\s?serif|roman|serif/i;
const MONO = /mono|courier|consol|lucida\s?console|menlo|fixed/i;

/** Picks the built-in family closest to the original: by font name first, then by how wide the text really is, then by the font's own flags. */
export function chooseFamily(seg, fi, fit) {
  const name = String(fi?.name || '').replace(/^[A-Z]{6}\+/, '');
  if (name) { if (MONO.test(name)) return 'cour'; if (SANS.test(name)) return 'helv'; if (SERIF.test(name)) return 'times'; }
  try {
    if (fit?.w > 8 && seg.text.length > 3) {
      const cx = (chooseFamily.cx ||= document.createElement('canvas').getContext('2d'));
      let best = null;
      for (const [fam, bold] of [['helv', false], ['helv', true], ['times', false], ['times', true], ['cour', false]]) {
        cx.font = `${bold ? 700 : 400} ${seg.fs}px ${CSS_BUILTIN[fam]}`;
        const err = Math.abs(cx.measureText(seg.text).width - fit.w) / fit.w;
        if (!best || err < best.err) best = { fam, err };
      }
      if (best.err < 0.07) return best.fam;
    }
  } catch {}
  return fi?.mono || /mono|courier/i.test(seg.family) ? 'cour' : (fi?.serif || /^serif$/i.test(seg.family) ? 'times' : 'helv');
}

/**
 * Thin vertical / horizontal rules (table borders, row lines) that pass through the box that is about to be covered.
 * They are redrawn on top of the cover so editing a cell never removes the lines around it.
 */
export function detectKeep(info, a, bg) {
  const out = [];
  try {
    const P = pixels(info, a.x - 1, a.y, a.coverW + 2, a.h); if (!P || P.W < 3 || P.H < 3) return out;
    const { d, W, H, sx } = P, rgb = hexRgb(bg), maxBand = Math.max(4, Math.ceil(2.6 * sx));
    const LINE = 90;
    const colorAt = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const bands = (len, count, total) => {
      const res = []; const ok = i => count(i) >= total * 0.9;
      for (let i = 0; i < len;) { if (ok(i)) { let e = i; while (e + 1 < len && ok(e + 1)) e++; if (e - i + 1 <= maxBand) res.push([i, e]); i = e + 1; } else i++; }
      return res;
    };
    const vc = new Uint16Array(W), hc = new Uint16Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist(d, (y * W + x) * 4, rgb) > LINE) { vc[x]++; hc[y]++; }
    for (const [x0, x1] of bands(W, i => vc[i], H)) {
      let far = 0, col = [0, 0, 0]; for (let x = x0; x <= x1; x++) for (let y = 0; y < H; y += 2) { const c = colorAt(x, y), t = Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]); if (t > far) { far = t; col = c; } }
      out.push({ x: +((P.x0 + x0) / sx).toFixed(2), y: +(P.y0 / sx).toFixed(2), w: +((x1 - x0 + 1) / sx).toFixed(2), h: +(H / sx).toFixed(2), c: toHex(col) });
    }
    for (const [y0, y1] of bands(H, i => hc[i], W)) {
      let far = 0, col = [0, 0, 0]; for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x += 2) { const c = colorAt(x, y), t = Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]); if (t > far) { far = t; col = c; } }
      out.push({ x: +(P.x0 / sx).toFixed(2), y: +((P.y0 + y0) / sx).toFixed(2), w: +(W / sx).toFixed(2), h: +((y1 - y0 + 1) / sx).toFixed(2), c: toHex(col) });
    }
  } catch {}
  return out;
}

/**
 * Splits runs of text wherever a table border passes between two of their pieces, so each cell is its own editable piece
 * (narrow columns can leave only a couple of points between one cell's text and the next).
 */
export function splitAtRules(info, segs) {
  const out = [];
  for (const seg of segs) {
    const its = seg.items;
    if (!its || its.length < 2 || seg.ocr || !info.canvas?.width) { out.push(seg); continue; }
    let rgb = null; const cuts = [];
    for (let k = 1; k < its.length; k++) {
      const gx0 = its[k - 1].x + its[k - 1].w, gx1 = its[k].x;
      if (!its[k].str.trim() || !its[k - 1].str.trim()) { /* blank items are decided with their neighbours below */ }
      const x0 = Math.min(gx0, gx1) - 1, x1 = Math.max(gx0, gx1) + 1;
      const P = pixels(info, x0, seg.top, x1 - x0, seg.h); if (!P) continue;
      rgb ||= hexRgb(sampleColors(info, { x: seg.x, top: seg.top, w: Math.min(seg.w, seg.fs * 40), h: seg.h }).bg);
      const { d, W, H, sx } = P; const maxBand = Math.max(4, Math.ceil(2.6 * sx));
      let found = false;
      for (let x = 0; x < W && !found;) {
        let c = 0; for (let y = 0; y < H; y++) if (dist(d, (y * W + x) * 4, rgb) > 90) c++;
        if (c >= Math.max(5, H * 0.9)) { let e = x; for (;;) { if (e + 1 >= W) break; let c2 = 0; for (let y = 0; y < H; y++) if (dist(d, (y * W + e + 1) * 4, rgb) > 90) c2++; if (c2 >= Math.max(5, H * 0.9)) e++; else break; } if (e - x + 1 <= maxBand) found = true; x = e + 1; } else x++;
      }
      if (found) cuts.push(k);
    }
    if (!cuts.length) { out.push(seg); continue; }
    let from = 0;
    for (const k of [...cuts, its.length]) {
      const part = its.slice(from, k), pre = seg.pre.slice(from, k);
      if (part.some(i => i.str.trim())) { const s2 = makeSeg(part, pre); if (s2.text.trim()) out.push(s2); }
      from = k;
    }
  }
  return out;
}

/**
 * The PDF's own font name -> the open-source font that has the same design/metrics (Arial → Arimo, Times New Roman → Tinos, …).
 * Returns { font: 'g:<id>', gname } for the editor's font system, or null when no close match is known.
 */
const FONT_MATCH = [
  [/arialnarrow|helveticanarrow|liberationsansnarrow/i, null],
  [/arial|helvetica|liberationsans|arimo/i, ['arimo', 'Arimo']],
  [/timesnewroman|times|liberationserif|tinos/i, ['tinos', 'Tinos']],
  [/couriernew|courier|liberationmono|cousine/i, ['cousine', 'Cousine']],
  [/calibri|carlito/i, ['carlito', 'Carlito']], [/cambria|caladea/i, ['caladea', 'Caladea']], [/georgia|gelasio/i, ['gelasio', 'Gelasio']],
  [/robotomono/i, ['roboto-mono', 'Roboto Mono']], [/robotoslab/i, ['roboto-slab', 'Roboto Slab']], [/roboto/i, ['roboto', 'Roboto']],
  [/opensans|segoeui/i, ['open-sans', 'Open Sans']], [/^lato/i, ['lato', 'Lato']], [/montserrat/i, ['montserrat', 'Montserrat']], [/poppins/i, ['poppins', 'Poppins']],
  [/notosans/i, ['noto-sans', 'Noto Sans']], [/notoserif/i, ['noto-serif', 'Noto Serif']], [/sourcesans/i, ['source-sans-3', 'Source Sans 3']], [/ubuntu/i, ['ubuntu', 'Ubuntu']],
  [/^inter(-|$|regular|bold)/i, ['inter', 'Inter']], [/nunito/i, ['nunito', 'Nunito']], [/raleway/i, ['raleway', 'Raleway']], [/merriweather/i, ['merriweather', 'Merriweather']],
  [/^lora/i, ['lora', 'Lora']], [/playfair/i, ['playfair-display', 'Playfair Display']], [/ptserif/i, ['pt-serif', 'PT Serif']], [/ebgaramond|garamond/i, ['eb-garamond', 'EB Garamond']],
];
export function matchPdfFont(rawName) {
  const name = String(rawName || '').replace(/^[A-Z]{6}\+/, '').replace(/[\s_-]+/g, '');
  if (!name) return null;
  for (const [re, to] of FONT_MATCH) if (re.test(name)) return to ? { font: 'g:' + to[0], gname: to[1] } : null;
  return null;
}
