// Minimal TrueType reader + WOFF→TTF converter. Pure functions (no DOM) so they can be unit-tested in Node.
const u16 = (d, o) => (d[o] << 8) | d[o + 1];
const i16 = (d, o) => (u16(d, o) << 16) >> 16;
const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const tag = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Converts WOFF 1.0 data to a plain sfnt (TTF/OTF). Returns the input unchanged if it is not WOFF. */
export async function woffToSfnt(data) {
  if (tag(data, 0) !== 'wOFF') return data;
  const flavor = u32(data, 4), n = u16(data, 12);
  const tables = [];
  for (let i = 0; i < n; i++) { const o = 44 + i * 20; tables.push({ tag: tag(data, o), off: u32(data, o + 4), comp: u32(data, o + 8), orig: u32(data, o + 12), sum: u32(data, o + 16) }); }
  const blobs = [];
  for (const t of tables) { const raw = data.subarray(t.off, t.off + t.comp); blobs.push(t.comp < t.orig ? await inflate(raw) : raw); }
  const dirEnd = 12 + 16 * n; let total = dirEnd; const offs = [];
  for (const b of blobs) { offs.push(total); total += (b.length + 3) & ~3; }
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor); dv.setUint16(4, n);
  let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; } dv.setUint16(6, sr * 16); dv.setUint16(8, es); dv.setUint16(10, n * 16 - sr * 16);
  const order = tables.map((t, i) => i).sort((a, b) => (tables[a].tag < tables[b].tag ? -1 : 1));
  order.forEach((ti, k) => { const t = tables[ti], o = 12 + k * 16; for (let c = 0; c < 4; c++) out[o + c] = t.tag.charCodeAt(c); dv.setUint32(o + 4, t.sum); dv.setUint32(o + 8, offs[ti]); dv.setUint32(o + 12, t.orig); });
  blobs.forEach((b, i) => out.set(b, offs[i]));
  return out;
}

/** Reads the parts of a TrueType font needed for PDF embedding. */
export function parseTtf(d) {
  const flavor = tag(d, 0); const isCFF = flavor === 'OTTO';
  if (!['\u0000\u0001\u0000\u0000', 'true', 'OTTO'].includes(flavor)) throw new Error('Not a TrueType/OpenType font');
  const n = u16(d, 4); const T = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; T[tag(d, o)] = { off: u32(d, o + 8), len: u32(d, o + 12) }; }
  const need = ['head', 'hhea', 'hmtx', 'maxp', 'cmap']; for (const k of need) if (!T[k]) throw new Error('Font is missing the ' + k + ' table');
  const head = T.head.off; const unitsPerEm = u16(d, head + 18);
  const bbox = [i16(d, head + 36), i16(d, head + 38), i16(d, head + 40), i16(d, head + 42)];
  const hhea = T.hhea.off; let ascent = i16(d, hhea + 4), descent = i16(d, hhea + 6); const nHM = u16(d, hhea + 34);
  const numGlyphs = u16(d, T.maxp.off + 4);
  const advance = gid => { const g = Math.min(gid, nHM - 1); return u16(d, T.hmtx.off + g * 4); };
  // OS/2
  let capHeight = Math.round(ascent * 0.7), weight = 400, fsType = 0, fsSelection = 0;
  if (T['OS/2']) { const o = T['OS/2'].off; const v = u16(d, o); weight = u16(d, o + 4); fsType = u16(d, o + 8); fsSelection = u16(d, o + 62); if (v >= 2 && T['OS/2'].len >= 90) capHeight = i16(d, o + 88) || capHeight; }
  // post
  let italicAngle = 0; if (T.post) italicAngle = (u32(d, T.post.off + 4) | 0) / 65536;
  // name
  const names = {};
  if (T.name) {
    const o = T.name.off, cnt = u16(d, o + 2), so = o + u16(d, o + 4);
    for (let i = 0; i < cnt; i++) {
      const r = o + 6 + i * 12; const pid = u16(d, r), eid = u16(d, r + 2), nid = u16(d, r + 6), len = u16(d, r + 8), off = u16(d, r + 10); if (names[nid] && pid !== 3) continue;
      const bytes = d.subarray(so + off, so + off + len); let s = '';
      if (pid === 3 || pid === 0) for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]); else for (const b of bytes) s += String.fromCharCode(b);
      if (pid === 3 || !names[nid]) names[nid] = s;
    }
  }
  // cmap → Map(codepoint → glyph id)
  const cmap = new Map(); const c0 = T.cmap.off; const nt = u16(d, c0 + 2); let best = null;
  for (let i = 0; i < nt; i++) { const pid = u16(d, c0 + 4 + i * 8), eid = u16(d, c0 + 6 + i * 8), off = u32(d, c0 + 8 + i * 8); const fmt = u16(d, c0 + off); const rank = pid === 3 && eid === 10 && fmt === 12 ? 4 : pid === 3 && eid === 1 && fmt === 4 ? 3 : pid === 0 && fmt === 12 ? 2 : pid === 0 && fmt === 4 ? 1 : 0; if (rank && (!best || rank > best.rank)) best = { rank, off: c0 + off, fmt }; }
  if (!best) throw new Error('Font has no Unicode character map');
  if (best.fmt === 4) {
    const o = best.off, segX2 = u16(d, o + 6), segs = segX2 / 2, endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < segs; s++) {
      const end = u16(d, endO + s * 2), start = u16(d, startO + s * 2), delta = i16(d, deltaO + s * 2), ro = u16(d, rangeO + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) { let g; if (ro === 0) g = (c + delta) & 0xffff; else { const gi = rangeO + s * 2 + ro + (c - start) * 2; g = u16(d, gi); if (g) g = (g + delta) & 0xffff; } if (g) cmap.set(c, g); }
    }
  } else {
    const o = best.off, ng = u32(d, o + 12);
    for (let g = 0; g < ng; g++) { const e = o + 16 + g * 12; const sc = u32(d, e), ec = u32(d, e + 4), sg = u32(d, e + 8); for (let c = sc; c <= ec; c++) cmap.set(c, sg + (c - sc)); }
  }
  const psName = (names[6] || (names[1] || 'Font') + '-' + (names[2] || 'Regular')).replace(/[^A-Za-z0-9-]/g, '');
  return { isCFF, unitsPerEm, bbox, ascent, descent, capHeight, weight, fsType, fsSelection, italicAngle, names, psName, cmap, numGlyphs, advance, embeddable: !isCFF && !(fsType & 0x0002) };
}
