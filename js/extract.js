// Turns PDF pages into structured content (headings, paragraphs, lists, tables) and writes TXT / Markdown / HTML / DOCX / XLSX.
import { getPageText, getFontInfo } from './pdfio.js';

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 11; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlSafe = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Text segments of a page, including edits made in the editor (original text under covers is dropped). */
export async function pageSegments(doc, i) {
  const meta = doc.pages[i]; let segs = [];
  if (meta.ocr?.lines?.length) segs = meta.ocr.lines.map(l => ({ text: l.text, x: l.x, top: l.y, w: l.w, fs: l.h * 0.85, base: l.y + l.h * 0.8, bold: false, italic: false }));
  else {
    const t = await getPageText(doc.pdf, i); const cache = new Map();
    for (const s of t.segments) {
      let fi = cache.get(s.fontName); if (!fi) { fi = s.fontName ? await getFontInfo(doc.pdf, i, s.fontName) : {}; cache.set(s.fontName, fi); }
      segs.push({ text: s.text, x: s.x, top: s.top, w: s.w, fs: s.fs, base: s.baseline, bold: !!fi.bold, italic: !!fi.italic });
    }
  }
  const covers = [];
  for (const a of meta.annots) {
    if (a.type === 'whiteout' || a.type === 'redact') covers.push([a.x, a.y, a.w, a.h]);
    else if (a.type === 'textedit') covers.push([a.x - 1, a.y - 2, a.coverW + 2, a.h + 4]);
  }
  segs = segs.filter(s => { const cx = s.x + s.w / 2, cy = s.top + s.fs / 2; return !covers.some(([x, y, w, h]) => cx >= x && cx <= x + w && cy >= y && cy <= y + h); });
  for (const a of meta.annots) {
    if (a.type === 'text' || a.type === 'textedit') String(a.text || '').split('\n').forEach((ln, k) => { if (ln.trim()) segs.push({ text: ln, x: a.x, top: a.y + k * a.size * 1.2, w: ln.length * a.size * 0.5, fs: a.size, base: a.y + k * a.size * 1.2 + a.size, bold: !!a.bold, italic: !!a.italic }); });
  }
  return segs;
}

function toRows(segs) {
  const sorted = [...segs].sort((a, b) => a.base - b.base || a.x - b.x); const rows = [];
  for (const s of sorted) {
    const r = rows.find(r => Math.abs(r.base - s.base) < Math.max(2, 0.45 * Math.min(r.fs, s.fs)));
    if (r) { r.segs.push(s); r.fs = Math.max(r.fs, s.fs); } else rows.push({ base: s.base, fs: s.fs, segs: [s] });
  }
  rows.forEach(r => { r.segs.sort((a, b) => a.x - b.x); r.x0 = r.segs[0].x; r.text = r.segs.map(s => s.text).join(' '); r.bold = r.segs.every(s => s.bold); });
  return rows.sort((a, b) => a.base - b.base);
}

/** Plain-text lines of a page (rows rebuilt from positions). */
export async function pageLines(doc, i) { return toRows(await pageSegments(doc, i)).map(r => r.segs.map(s => s.text).join('  ')); }

const LIST_RE = /^\s*([•●▪○◦\-–*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

/** pagesSegs: array (one per page) of segment arrays → flat list of blocks. */
export function buildBlocks(pagesSegs) {
  const blocks = []; const allFs = [];
  pagesSegs.forEach(ss => ss.forEach(s => { for (let k = 0; k < Math.min(s.text.length, 80); k++) allFs.push(Math.round(s.fs * 2) / 2); }));
  const body = median(allFs) || 11;
  pagesSegs.forEach((segs, pi) => {
    if (pi) blocks.push({ type: 'pagebreak' });
    const rows = toRows(segs); let prev = null, tbl = null;
    const closeTbl = () => { if (tbl) { if (tbl.rows.length >= 2) blocks.push({ type: 'table', rows: tbl.rows.map(r => r.segs.map(s => s.text)), segs: tbl.rows }); else tbl.rows.forEach(r => blocks.push({ type: 'p', runs: [{ text: r.text }] })); tbl = null; } };
    for (const r of rows) {
      const multi = r.segs.length >= 2 && r.segs.every(s => s.text.length < 60) && r.fs <= body * 1.2;
      if (multi) { if (!tbl) tbl = { rows: [] }; tbl.rows.push(r); prev = null; continue; }
      closeTbl();
      const runsOf = row => row.segs.map(s => ({ text: s.text, bold: s.bold, italic: s.italic }));
      if (r.fs >= body * 1.25 && r.text.length < 140) { const level = r.fs >= body * 1.8 ? 1 : r.fs >= body * 1.45 ? 2 : 3; blocks.push({ type: 'h', level, text: r.text }); prev = null; continue; }
      if (r.bold && r.text.length < 70 && r.segs.length === 1 && r.fs >= body * 0.98 && !/[.,;:]$/.test(r.text)) { blocks.push({ type: 'h', level: 3, text: r.text }); prev = null; continue; }
      const lm = LIST_RE.exec(r.text);
      if (lm) { blocks.push({ type: 'li', ordered: /\d|[a-zA-Z]/.test(lm[1][0]), text: r.text.slice(lm[0].length), runs: [{ text: r.text.slice(lm[0].length) }] }); prev = null; continue; }
      const last = blocks[blocks.length - 1];
      const merge = prev && last && last.type === 'p' && r.base - prev.base < prev.fs * 1.7 && Math.abs(r.fs - prev.fs) < prev.fs * 0.15 && Math.abs(r.x0 - prev.x0) < prev.fs * 1.5 && !/[.:!?]$/.test(prev.text.trim());
      if (merge) { last.runs.push({ text: ' ' }, ...runsOf(r)); } else blocks.push({ type: 'p', runs: runsOf(r) });
      prev = r;
    }
    closeTbl();
  });
  for (const b of blocks) if (b.runs) b.runs = b.runs.reduce((o, r) => { const l = o[o.length - 1]; if (l && !!l.bold === !!r.bold && !!l.italic === !!r.italic) l.text += r.text; else o.push({ ...r }); return o; }, []);
  return blocks;
}

const plain = b => (b.runs ? b.runs.map(r => r.text).join('') : b.text || '');

/* ---------------------------------------------------------------- writers */
export function toTxt(blocks) {
  return blocks.map(b => b.type === 'pagebreak' ? '\n' : b.type === 'li' ? (b.ordered ? '1. ' : '• ') + plain(b) : b.type === 'table' ? b.rows.map(r => r.join('\t')).join('\n') : plain(b)).join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}
export function toMd(blocks) {
  return blocks.map(b => {
    if (b.type === 'pagebreak') return '\n---\n';
    if (b.type === 'h') return '#'.repeat(b.level) + ' ' + b.text + '\n';
    if (b.type === 'li') return (b.ordered ? '1. ' : '- ') + plain(b);
    if (b.type === 'table') { const w = Math.max(...b.rows.map(r => r.length)); const row = r => '| ' + Array.from({ length: w }, (_, i) => (r[i] || '').replace(/\|/g, '\\|')).join(' | ') + ' |'; return [row(b.rows[0]), '|' + ' --- |'.repeat(w), ...b.rows.slice(1).map(row)].join('\n') + '\n'; }
    return b.runs.map(r => (r.bold && r.text.trim() ? `**${r.text.trim()}** ` : r.italic && r.text.trim() ? `*${r.text.trim()}* ` : r.text)).join('').trim() + '\n';
  }).join('\n');
}
export function toHtml(blocks, title = 'Document') {
  let out = '', list = null;
  const closeList = () => { if (list) { out += `</${list}>\n`; list = null; } };
  for (const b of blocks) {
    if (b.type === 'li') { const t = b.ordered ? 'ol' : 'ul'; if (list !== t) { closeList(); out += `<${t}>\n`; list = t; } out += `<li>${esc(plain(b))}</li>\n`; continue; }
    closeList();
    if (b.type === 'h') out += `<h${b.level}>${esc(b.text)}</h${b.level}>\n`;
    else if (b.type === 'p') out += '<p>' + b.runs.map(r => { let t = esc(r.text); if (r.bold) t = `<strong>${t}</strong>`; if (r.italic) t = `<em>${t}</em>`; return t; }).join('') + '</p>\n';
    else if (b.type === 'table') out += '<table>\n' + b.rows.map((r, i) => '<tr>' + r.map(c => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('\n') + '\n</table>\n';
    else if (b.type === 'pagebreak') out += '<hr>\n';
  }
  closeList();
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#222}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #bbb;padding:4px 10px;text-align:left}th{background:#f0f0f0}hr{margin:2em 0;border:0;border-top:1px solid #ccc}</style></head>\n<body>\n${out}</body></html>\n`;
}

const CT = (extra) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${extra}</Types>`;
const REL = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;

/** DOCX from blocks (editable text) or from page images ([{bytes, w, h}] in points). */
export async function toDocx(blocks, { images } = {}) {
  const zip = new JSZip(); let body = '';
  const run = r => `<w:r><w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(xmlSafe(r.text))}</w:t></w:r>`;
  const para = (runs, style, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${runs}</w:p>`;
  let pgW = 11906, pgH = 16838, mar = 1440;
  if (images?.length) {
    pgW = Math.round(images[0].w * 20); pgH = Math.round(images[0].h * 20); mar = 0;
    images.forEach((im, i) => {
      zip.file(`word/media/page${i + 1}.png`, im.bytes);
      const cx = Math.round(im.w * 12700), cy = Math.round(im.h * 12700);
      body += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Page ${i + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="page${i + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${i + 1}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    });
  } else {
    for (const b of blocks) {
      if (b.type === 'h') body += para(run({ text: b.text, bold: true }), `Heading${Math.min(3, b.level)}`);
      else if (b.type === 'p') body += para(b.runs.map(run).join(''));
      else if (b.type === 'li') body += para(`<w:r><w:t xml:space="preserve">${b.ordered ? '' : '• '}</w:t></w:r>` + run({ text: plain(b) }), '', '<w:ind w:left="540" w:hanging="270"/>');
      else if (b.type === 'pagebreak') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map(r => r.length)); const bd = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('');
        body += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${bd}</w:tblBorders></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>` + b.rows.map(r => '<w:tr>' + Array.from({ length: cols }, (_, i) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(run({ text: r[i] || '' }))}</w:tc>`).join('') + '</w:tr>').join('') + '</w:tbl>' + para('');
      }
    }
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"/><w:pgMar w:top="${mar}" w:right="${mar}" w:bottom="${mar}" w:left="${mar}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[[1, 40], [2, 32], [3, 26]].map(([n, sz]) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('')}</w:styles>`;
  zip.file('[Content_Types].xml', CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'));
  zip.file('_rels/.rels', REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'));
  zip.file('word/document.xml', doc); zip.file('word/styles.xml', styles);
  zip.file('word/_rels/document.xml.rels', REL('<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + (images || []).map((_, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i + 1}.png"/>`).join('')));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** XLSX: one sheet per page; rows are rebuilt from text positions and columns from aligned text. */
export async function toXlsx(pagesSegs) {
  const zip = new JSZip(); const colName = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const sheets = pagesSegs.map((segs, pi) => {
    const rows = toRows(segs); const tol = Math.max(6, median(segs.map(s => s.fs)) * 0.9);
    const xs = []; rows.filter(r => r.segs.length >= 2).forEach(r => r.segs.forEach(s => xs.push(s.x))); xs.sort((a, b) => a - b);
    const cols = []; for (const x of xs) { if (!cols.length || x - cols[cols.length - 1] > tol) cols.push(x); }
    const colOf = x => { if (!cols.length) return 0; let c = 0; cols.forEach((cx, k) => { if (x >= cx - tol) c = k; }); return c; };
    const data = rows.map(r => { const cells = []; r.segs.forEach(s => { const c = r.segs.length >= 2 || cols.length ? colOf(s.x) : 0; cells[c] = cells[c] ? cells[c] + ' ' + s.text : s.text; }); return cells; });
    return { name: `Page ${pi + 1}`, data };
  });
  const sheetXml = ({ data }) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data.map((row, r) => `<row r="${r + 1}">${Array.from(row, (v, c) => [v, c]).filter(([v]) => v != null && v !== '').map(([v, c]) => { const ref = colName(c) + (r + 1); const num = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(String(v).trim()) ? String(v).replace(/,/g, '').trim() : null; return num != null && isFinite(num) ? `<c r="${ref}"><v>${num}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(xmlSafe(v))}</t></is></c>`; }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  zip.file('[Content_Types].xml', CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')));
  zip.file('_rels/.rels', REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'));
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', REL(sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`));
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>');
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
