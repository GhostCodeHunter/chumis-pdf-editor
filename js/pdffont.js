// Embeds a TrueType font into a pdf-lib document as a Type0 / CIDFontType2 (Identity-H) font with a ToUnicode map,
// so text stays selectable and searchable. Works without fontkit (pdf-lib only embeds custom fonts through it).
import { PDFLib } from './pdfio.js';

const { PDFFont, PDFName, PDFHexString, PDFString } = PDFLib;

class TtfEmbedder {
  constructor(ttf, bytes) {
    this.ttf = ttf; this.bytes = bytes; this.fontName = ttf.psName || 'EmbeddedFont';
    this.font = { characterSet: [...ttf.cmap.keys()] }; // PDFFont.getCharacterSet() reads this
    this.used = new Map(); // gid -> code point
  }
  encodeText(text) {
    let hex = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0); const gid = this.ttf.cmap.get(cp) || 0;
      if (gid) this.used.set(gid, cp);
      hex += gid.toString(16).padStart(4, '0');
    }
    return PDFHexString.of(hex);
  }
  widthOfTextAtSize(text, size) {
    let w = 0; for (const ch of text) w += this.ttf.advance(this.ttf.cmap.get(ch.codePointAt(0)) || 0);
    return (w * size) / this.ttf.unitsPerEm;
  }
  heightAtSize(size) { return ((this.ttf.ascent - this.ttf.descent) * size) / this.ttf.unitsPerEm; }
  sizeAtHeight(h) { return (h * this.ttf.unitsPerEm) / (this.ttf.ascent - this.ttf.descent); }

  async embedIntoContext(context, ref) {
    const t = this.ttf; const k = 1000 / t.unitsPerEm; const R = Math.round;
    const fontFile = context.register(context.flateStream(this.bytes, { Length1: this.bytes.length }));
    const descriptor = context.register(context.obj({
      Type: 'FontDescriptor', FontName: PDFName.of(this.fontName), Flags: 4, ItalicAngle: R(t.italicAngle),
      Ascent: R(t.ascent * k), Descent: R(t.descent * k), CapHeight: R(t.capHeight * k), StemV: t.weight >= 600 ? 140 : 80,
      FontBBox: t.bbox.map(v => R(v * k)), FontFile2: fontFile,
    }));
    const W = []; for (const gid of [...this.used.keys()].sort((a, b) => a - b)) W.push(gid, [R(t.advance(gid) * k)]);
    const cid = context.register(context.obj({
      Type: 'Font', Subtype: 'CIDFontType2', BaseFont: PDFName.of(this.fontName),
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor, CIDToGIDMap: PDFName.of('Identity'), DW: R((t.advance(this.ttf.cmap.get(0x20) || 0) || t.unitsPerEm / 2) * k), W,
    }));
    // ToUnicode CMap so copy/paste, search and text extraction work
    const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
    const utf16 = cp => (cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp));
    const pairs = [...this.used.entries()].sort((a, b) => a[0] - b[0]); let body = '';
    for (let i = 0; i < pairs.length; i += 100) { const chunk = pairs.slice(i, i + 100); body += `${chunk.length} beginbfchar\n${chunk.map(([g, c]) => `<${hex4(g)}> <${utf16(c)}>`).join('\n')}\nendbfchar\n`; }
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const toUnicode = context.register(context.flateStream(new TextEncoder().encode(cmap)));
    context.assign(ref, context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: PDFName.of(this.fontName), Encoding: PDFName.of('Identity-H'), DescendantFonts: [cid], ToUnicode: toUnicode }));
  }
}

// pdf-lib only accepts its own embedder classes for PDFFont, so make ours count as a CustomFontEmbedder.
Object.setPrototypeOf(TtfEmbedder.prototype, PDFLib.CustomFontEmbedder.prototype);

const cache = new WeakMap();
/** Returns a pdf-lib PDFFont for the parsed TTF, embedded once per document. */
export function embedTtf(pdf, ttf, bytes, key) {
  let m = cache.get(pdf); if (!m) cache.set(pdf, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const embedder = new TtfEmbedder(ttf, bytes);
  const ref = pdf.context.nextRef(); const font = PDFFont.of(ref, pdf, embedder); pdf.fonts.push(font);
  font._cs = new Set(embedder.font.characterSet);
  m.set(key, font); return font;
}
