// Fonts: built-in PDF fonts, one bundled Google Font (Poppins, works offline) and a catalogue of popular Google Fonts
// loaded on demand from the Fontsource CDN (jsDelivr) and cached on the device. Fonts are used for the on-screen
// preview (FontFace), for exact baseline measurement, and for real embedding into the PDF (see pdffont.js).
import { parseTtf, woffToSfnt } from './ttf.js';
import { embedTtf } from './pdffont.js';

export const CSS_BUILTIN = {
  helv: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  times: '"Times New Roman", "Liberation Serif", Times, serif',
  cour: '"Courier New", "Liberation Mono", Courier, monospace',
};
export const BUILTIN = [{ key: 'helv', name: 'Helvetica / Arial', cat: 'sans' }, { key: 'times', name: 'Times New Roman', cat: 'serif' }, { key: 'cour', name: 'Courier New', cat: 'mono' }];

const G = (id, name, cat, extra = {}) => ({ id, name, cat, ...extra });
export const BUNDLED = [G('poppins', 'Poppins', 'sans', { bundled: true })];
export const CATALOG = [
  G('roboto', 'Roboto', 'sans'), G('open-sans', 'Open Sans', 'sans'), G('lato', 'Lato', 'sans'), G('montserrat', 'Montserrat', 'sans'), G('inter', 'Inter', 'sans'),
  G('nunito', 'Nunito', 'sans'), G('source-sans-3', 'Source Sans 3', 'sans'), G('work-sans', 'Work Sans', 'sans'), G('raleway', 'Raleway', 'sans'), G('ubuntu', 'Ubuntu', 'sans'),
  G('rubik', 'Rubik', 'sans'), G('dm-sans', 'DM Sans', 'sans'), G('mulish', 'Mulish', 'sans'), G('noto-sans', 'Noto Sans', 'sans'), G('arimo', 'Arimo', 'sans'),
  G('josefin-sans', 'Josefin Sans', 'sans'), G('quicksand', 'Quicksand', 'sans'), G('oswald', 'Oswald', 'sans'), G('karla', 'Karla', 'sans'), G('cabin', 'Cabin', 'sans'),
  G('playfair-display', 'Playfair Display', 'serif'), G('merriweather', 'Merriweather', 'serif'), G('lora', 'Lora', 'serif'), G('pt-serif', 'PT Serif', 'serif'),
  G('libre-baskerville', 'Libre Baskerville', 'serif'), G('crimson-text', 'Crimson Text', 'serif'), G('eb-garamond', 'EB Garamond', 'serif'), G('roboto-slab', 'Roboto Slab', 'serif'),
  G('noto-serif', 'Noto Serif', 'serif'), G('tinos', 'Tinos', 'serif'), G('cormorant-garamond', 'Cormorant Garamond', 'serif'), G('bitter', 'Bitter', 'serif'),
  G('roboto-mono', 'Roboto Mono', 'mono'), G('source-code-pro', 'Source Code Pro', 'mono'), G('jetbrains-mono', 'JetBrains Mono', 'mono'), G('fira-code', 'Fira Code', 'mono'),
  G('ibm-plex-mono', 'IBM Plex Mono', 'mono'), G('cousine', 'Cousine', 'mono'),
  G('bebas-neue', 'Bebas Neue', 'display'), G('anton', 'Anton', 'display'), G('abril-fatface', 'Abril Fatface', 'display'), G('lobster', 'Lobster', 'display'), G('righteous', 'Righteous', 'display'),
  G('dancing-script', 'Dancing Script', 'script'), G('great-vibes', 'Great Vibes', 'script'), G('pacifico', 'Pacifico', 'script'), G('caveat', 'Caveat', 'script'), G('satisfy', 'Satisfy', 'script'),
  G('allura', 'Allura', 'script'), G('kaushan-script', 'Kaushan Script', 'script'), G('shadows-into-light', 'Shadows Into Light', 'script'), G('sacramento', 'Sacramento', 'script'), G('homemade-apple', 'Homemade Apple', 'script'),
  // Indian-language fonts: shown with the browser's own text shaping and saved into the PDF as images of the text
  G('noto-sans-malayalam', 'Noto Sans Malayalam', 'indian', { subset: 'malayalam', raster: true }), G('manjari', 'Manjari', 'indian', { subset: 'malayalam', raster: true }),
  G('noto-sans-devanagari', 'Noto Sans Devanagari', 'indian', { subset: 'devanagari', raster: true }), G('hind', 'Hind', 'indian', { subset: 'devanagari', raster: true }),
  G('noto-sans-tamil', 'Noto Sans Tamil', 'indian', { subset: 'tamil', raster: true }), G('noto-sans-telugu', 'Noto Sans Telugu', 'indian', { subset: 'telugu', raster: true }),
  G('noto-sans-kannada', 'Noto Sans Kannada', 'indian', { subset: 'kannada', raster: true }), G('noto-sans-bengali', 'Noto Sans Bengali', 'indian', { subset: 'bengali', raster: true }),
  G('noto-sans-gujarati', 'Noto Sans Gujarati', 'indian', { subset: 'gujarati', raster: true }), G('noto-sans-gurmukhi', 'Noto Sans Gurmukhi', 'indian', { subset: 'gurmukhi', raster: true }),
];
export const CATEGORIES = [['all', 'All'], ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['display', 'Display'], ['script', 'Script'], ['indian', 'Indian']];
const GENERIC = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif', script: 'cursive', indian: 'sans-serif' };

/* ---------------------------------------------------------------- identity helpers */
export const isCustom = f => typeof f === 'string' && f.startsWith('g:');
export const idOf = f => f.slice(2);
const EXTRA_KEY = 'chumi.fonts.extra', RECENT_KEY = 'chumi.fonts.recent';
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || ''); } catch { return d; } };
export const extras = () => readJson(EXTRA_KEY, []);
export const recents = () => readJson(RECENT_KEY, []);
export function remember(id) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recents().filter(x => x !== id)].slice(0, 6))); } catch {} }
export function allFonts() { return [...BUNDLED, ...CATALOG, ...extras().filter(e => !CATALOG.some(c => c.id === e.id))]; }
export function entryFor(id, nameHint) {
  return allFonts().find(f => f.id === id) || { id, name: nameHint || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), cat: 'sans' };
}
export const idFromName = name => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function labelFor(f, gname) { return isCustom(f) ? gname || entryFor(idOf(f)).name : BUILTIN.find(b => b.key === f)?.name || 'Helvetica / Arial'; }

export function cssFamilyFor(a) {
  if (!isCustom(a.font)) return CSS_BUILTIN[a.font] || CSS_BUILTIN.helv;
  const e = entryFor(idOf(a.font), a.gname);
  return `"${e.name.replace(/"/g, '')}", ${GENERIC[e.cat] || 'sans-serif'}`;
}
export const familyOf = (id) => { const e = entryFor(id); return `"${e.name.replace(/"/g, '')}", ${GENERIC[e.cat] || 'sans-serif'}`; };

/* ---------------------------------------------------------------- loading */
const CACHE = 'chumi-fonts-v1';
async function fetchBytes(url, bundled) {
  if (bundled) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); }
  let cache = null; try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
  const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status);
  try { cache && cache.put(url, r.clone()); } catch {}
  return new Uint8Array(await r.arrayBuffer());
}
function urlsFor(e, weight, style) {
  const tag = `${weight}${style === 'italic' ? 'i' : ''}`;
  if (e.bundled) return [new URL(`../vendor/fonts/${e.id}-${tag}.ttf`, import.meta.url).href];
  const sub = e.subset || 'latin', w = `${sub}-${weight}-${style}`;
  return [`https://cdn.jsdelivr.net/fontsource/fonts/${e.id}@latest/${w}.woff`, `https://cdn.jsdelivr.net/npm/@fontsource/${e.id}/files/${e.id}-${w}.woff`];
}

const styles = new Map();   // "id|weight|style" -> {ttf, bytes, face, weight, style} | null (not available)
const pending = new Map();
export function loadStyle(e, weight, style) {
  const key = `${e.id}|${weight}|${style}`;
  if (styles.has(key)) return Promise.resolve(styles.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    for (const url of urlsFor(e, weight, style)) {
      try {
        let bytes = await fetchBytes(url, e.bundled); bytes = await woffToSfnt(bytes);
        let ttf = null; try { ttf = parseTtf(bytes); } catch { /* indian/CFF fonts: preview only */ }
        const face = new FontFace(e.name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { weight: String(weight), style });
        await face.load(); document.fonts.add(face);
        const rec = { ttf, bytes, face, weight, style, id: e.id }; styles.set(key, rec); return rec;
      } catch (err) { /* try the next URL */ }
    }
    styles.set(key, null); return null;
  })().finally(() => pending.delete(key));
  pending.set(key, p); return p;
}

/** Loads the best available face for the annotation's bold/italic request and returns it (or null). */
export async function ensureFont(a) {
  if (!isCustom(a.font)) return null;
  const e = entryFor(idOf(a.font), a.gname); const w = a.bold ? 700 : 400, s = a.italic ? 'italic' : 'normal';
  const wants = [[w, s]]; if (a.italic) wants.push([w, 'normal']); if (a.bold) { wants.push([400, s]); if (a.italic) wants.push([400, 'normal']); }
  for (const [ww, ss] of wants) { const r = await loadStyle(e, ww, ss); if (r) return r; }
  return null;
}
export function isLoaded(a) {
  if (!isCustom(a.font)) return true; const e = entryFor(idOf(a.font), a.gname);
  return [[a.bold ? 700 : 400, a.italic ? 'italic' : 'normal'], [400, 'normal'], [700, 'normal'], [400, 'italic']].some(([w, s]) => styles.get(`${e.id}|${w}|${s}`));
}
export function isRasterOnly(a) { return isCustom(a.font) && !!entryFor(idOf(a.font), a.gname).raster; }

/* ---------------------------------------------------------------- measuring */
const probeCache = new Map();
/** Where the first baseline sits inside a 1.2-line-height box, as a fraction of the font size, measured in this browser. */
export async function probeBase(a) {
  if (!isCustom(a.font)) return null;
  const rec = await ensureFont(a); const fam = cssFamilyFor(a); const key = `${fam}|${rec ? rec.weight : 0}|${rec ? rec.style : 0}`;
  if (probeCache.has(key)) return probeCache.get(key);
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-size:100px;line-height:1.2;font-family:${fam};font-weight:${rec ? rec.weight : 400};font-style:${rec ? rec.style : 'normal'};font-synthesis:none;`;
  box.innerHTML = 'Hxg<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  document.body.append(box); const probe = box.lastChild; const base = (probe.offsetTop + probe.offsetHeight) / 100; box.remove();
  probeCache.set(key, base); return base;
}

/* ---------------------------------------------------------------- PDF embedding */
/** Returns { font: PDFFont, rec } when the text can be embedded as live text with this font, otherwise null. */
export async function embeddedFontFor(pdf, a, text) {
  if (!isCustom(a.font) || isRasterOnly(a)) return null;
  const rec = await ensureFont(a); if (!rec || !rec.ttf || !rec.ttf.embeddable) return null;
  for (const ch of text) { if (ch === '\n') continue; if (!rec.ttf.cmap.has(ch.codePointAt(0))) return null; }
  try { const font = embedTtf(pdf, rec.ttf, rec.bytes, `${rec.id}|${rec.weight}|${rec.style}`); return { font, rec }; }
  catch (e) { console.warn('font embedding failed, using picture text', e); return null; }
}
/** Makes sure the browser font is ready for canvas drawing (picture text). */
export async function readyForCanvas(a) { if (isCustom(a.font)) { await ensureFont(a); try { await document.fonts.ready; } catch {} } }
