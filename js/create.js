// Create a PDF from blank pages, images, text, Word (.docx) or spreadsheets (.xlsx / .csv).
import { h, icon, button, toast, field, select, segmented, pickFiles, readBytes, withProgress, baseName } from './ui.js';
import { PDFLib, PAGE_SIZES } from './pdfio.js';
import { renderBlocksToPdf, markdownToBlocks, inlineMd } from './layout.js';
import { normalizeImage } from './annots.js';

const { PDFDocument } = PDFLib;
const ext = n => (n.split('.').pop() || '').toLowerCase();
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];

/* ------------------------------------------------------------------ converters (also used by Open / Combine / Organize) */
export async function fileToPdf(file, bytes) {
  const e = ext(file.name); bytes = bytes || await readBytes(file);
  if (file.type.startsWith('image/') || IMG_EXT.includes(e)) return imagesToPdf([file], { size: 'fit' });
  if (e === 'docx') return docxToPdf(bytes);
  if (e === 'csv') return tableToPdf([{ name: '', rows: parseCsv(new TextDecoder().decode(bytes)) }]);
  if (e === 'xlsx') return tableToPdf(await readXlsx(bytes));
  if (e === 'txt' || e === 'md' || e === 'markdown' || file.type.startsWith('text/')) return textToPdf(new TextDecoder().decode(bytes), { md: e !== 'txt' });
  if (e === 'doc' || e === 'xls' || e === 'ppt' || e === 'pptx') throw new Error(`.${e} files can’t be read in the browser. Save as .docx / .xlsx first.`);
  throw new Error(`Don’t know how to convert “.${e}” files`);
}

export async function imagesToPdf(files, { size = 'fit', margin = 0, landscape = false } = {}) {
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const { bytes, mime, w, h: hh } = await normalizeImage(f);
    const img = mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    let pw, ph;
    if (size === 'fit') { const k = Math.min(1, 1400 / Math.max(w, hh)); pw = w * 0.75 * (k < 1 ? 1 : 1); ph = hh * 0.75; if (Math.max(pw, ph) > 1200) { const s = 1200 / Math.max(pw, ph); pw *= s; ph *= s; } }
    else { [pw, ph] = PAGE_SIZES[size] || PAGE_SIZES.A4; if ((w > hh) !== (pw > ph) || landscape) { if (w > hh || landscape) [pw, ph] = [Math.max(pw, ph), Math.min(pw, ph)]; } }
    const page = pdf.addPage([pw, ph]);
    const maxW = pw - margin * 2, maxH = ph - margin * 2; const k = Math.min(maxW / w, maxH / hh);
    const dw = size === 'fit' && !margin ? pw : w * k, dh = size === 'fit' && !margin ? ph : hh * k;
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  }
  return pdf.save({ useObjectStreams: true });
}

export async function textToPdf(text, { md = true, size = 11, pageSize = 'A4', title = '' } = {}) {
  const blocks = markdownToBlocks(text, md);
  if (title) blocks.unshift({ type: 'h', level: 1, runs: [{ text: title }] });
  return renderBlocksToPdf(blocks, { pageSize: PAGE_SIZES[pageSize] || PAGE_SIZES.A4, baseSize: size, mono: !md });
}

export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

export async function tableToPdf(sheets, { pageSize } = {}) {
  const blocks = [];
  sheets.forEach((s, i) => { if (i) blocks.push({ type: 'pagebreak' }); if (s.name) blocks.push({ type: 'h', level: 2, runs: [{ text: s.name }] }); blocks.push({ type: 'table', rows: s.rows }); });
  const cols = Math.max(...sheets.flatMap(s => s.rows.map(r => r.length)), 1);
  const base = PAGE_SIZES[pageSize] || PAGE_SIZES.A4; const ps = cols > 6 ? [base[1], base[0]] : base;
  return renderBlocksToPdf(blocks, { pageSize: ps, margin: 36 });
}

/* -------- xlsx reader (shared strings + first rows of each sheet) -------- */
async function readXlsx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const sst = await xml('xl/sharedStrings.xml'); const shared = sst ? [...sst.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const wb = await xml('xl/workbook.xml'); const rels = await xml('xl/_rels/workbook.xml.rels');
  const relMap = new Map([...(rels?.getElementsByTagName('Relationship') || [])].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sheets = [];
  for (const s of [...(wb?.getElementsByTagName('sheet') || [])]) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap.get(rid) || ''; target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
    const doc = await xml(target); if (!doc) continue;
    const rows = [];
    for (const r of [...doc.getElementsByTagName('row')]) {
      const row = [];
      for (const c of [...r.getElementsByTagName('c')]) {
        const ref = c.getAttribute('r') || ''; const col = [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val = v; if (t === 's') val = shared[+v] ?? ''; else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        row[col >= 0 ? col : row.length] = val;
      }
      rows.push(Array.from(row, x => x ?? ''));
    }
    if (rows.length) sheets.push({ name: s.getAttribute('name'), rows });
  }
  if (!sheets.length) throw new Error('No data found in this spreadsheet');
  return sheets;
}

/* -------- docx reader (headings, paragraphs, lists, tables, images) -------- */
async function docxToPdf(bytes, { pageSize = 'A4' } = {}) {
  const zip = await JSZip.loadAsync(bytes);
  const parse = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const doc = await parse('word/document.xml'); if (!doc) throw new Error('This is not a valid .docx file');
  const rels = await parse('word/_rels/document.xml.rels'); const relMap = new Map([...(rels?.getElementsByTagName('Relationship') || [])].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const numbering = await parse('word/numbering.xml'); const numFmt = new Map();
  if (numbering) {
    const abs = new Map([...numbering.getElementsByTagName('w:abstractNum')].map(a => [a.getAttribute('w:abstractNumId'), a.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val')]));
    for (const n of [...numbering.getElementsByTagName('w:num')]) numFmt.set(n.getAttribute('w:numId'), abs.get(n.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val')));
  }
  const W = n => n.localName; const kids = (n, name) => [...n.children].filter(c => W(c) === name);
  const blocks = []; const counters = new Map();
  const runsOf = p => {
    const runs = [];
    const walk = node => {
      for (const c of node.children) {
        const nm = W(c);
        if (nm === 'r') {
          const rPr = kids(c, 'rPr')[0]; const bold = !!rPr && kids(rPr, 'b').some(b => b.getAttribute('w:val') !== '0'); const italic = !!rPr && kids(rPr, 'i').some(b => b.getAttribute('w:val') !== '0');
          const sz = rPr && kids(rPr, 'sz')[0]?.getAttribute('w:val'); const colorEl = rPr && kids(rPr, 'color')[0]?.getAttribute('w:val');
          let text = '';
          for (const t of c.children) { const tn = W(t); if (tn === 't') text += t.textContent; else if (tn === 'tab') text += '    '; else if (tn === 'br') { if (t.getAttribute('w:type') === 'page') { if (text) runs.push({ text, bold, italic }); text = ''; runs.push({ pagebreak: true }); } else text += '\n'; } }
          if (text) runs.push({ text, bold, italic, size: sz ? +sz / 2 : undefined, color: colorEl && /^[0-9a-f]{6}$/i.test(colorEl) && colorEl !== '000000' ? '#' + colorEl : undefined });
          for (const d of c.getElementsByTagName('a:blip')) runs.push({ image: d.getAttribute('r:embed') });
        } else if (nm === 'hyperlink' || nm === 'smartTag' || nm === 'sdt' || nm === 'sdtContent' || nm === 'ins') walk(c);
      }
    };
    walk(p); return runs;
  };
  const para = async p => {
    const pPr = kids(p, 'pPr')[0]; const style = pPr && kids(pPr, 'pStyle')[0]?.getAttribute('w:val') || '';
    const jc = pPr && kids(pPr, 'jc')[0]?.getAttribute('w:val'); const numPr = pPr && kids(pPr, 'numPr')[0];
    const runs = runsOf(p); const out = [];
    for (const r of runs.filter(x => x.image)) {
      const target = relMap.get(r.image); const f = target && zip.file('word/' + target.replace(/^\.?\//, ''));
      if (f) { const b = new Uint8Array(await f.async('uint8array')); const mime = /\.jpe?g$/i.test(target) ? 'image/jpeg' : /\.png$/i.test(target) ? 'image/png' : null; if (mime) out.push({ type: 'img', bytes: b, mime }); }
    }
    const textRuns = runs.filter(x => x.text);
    if (runs.some(x => x.pagebreak)) out.push({ type: 'pagebreak' });
    if (!textRuns.length) { if (!out.length && !runs.length) out.push({ type: 'p', runs: [] }); return out; }
    const hm = /^(?:Heading|heading)\s?([1-6])$/.exec(style) || (/^Title$/i.test(style) ? [0, 1] : null);
    if (hm) out.unshift({ type: 'h', level: +hm[1], runs: textRuns });
    else if (numPr) { const id = kids(numPr, 'numId')[0]?.getAttribute('w:val'); const ordered = ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman'].includes(numFmt.get(id)); const n = (counters.get(id) || 0) + 1; counters.set(id, n); out.unshift({ type: 'li', ordered, n, depth: +(kids(numPr, 'ilvl')[0]?.getAttribute('w:val') || 0), runs: textRuns }); }
    else out.unshift({ type: 'p', runs: textRuns, align: jc === 'center' ? 'center' : jc === 'right' ? 'right' : 'left' });
    return out;
  };
  const body = doc.getElementsByTagName('w:body')[0];
  for (const el of body.children) {
    const nm = W(el);
    if (nm === 'p') blocks.push(...await para(el));
    else if (nm === 'tbl') {
      const rows = kids(el, 'tr').map(tr => kids(tr, 'tc').map(tc => kids(tc, 'p').map(p => runsOf(p).filter(x => x.text).map(x => x.text).join('')).join('\n')));
      blocks.push({ type: 'table', rows });
    }
  }
  if (!blocks.length) throw new Error('No readable content found in this document');
  return renderBlocksToPdf(blocks, { pageSize: PAGE_SIZES[pageSize] });
}

/* ------------------------------------------------------------------ screen */
export function mount(root, app) {
  const MODES = [
    ['blank', 'blank', 'Blank pages', 'Start with empty pages and add text, images and shapes.'],
    ['images', 'image-file', 'From images', 'Turn photos or scans (JPG, PNG, WebP…) into pages.'],
    ['text', 'txt', 'From text', 'Type or paste text; Markdown headings and lists are supported.'],
    ['word', 'word', 'From Word', 'Convert a .docx document with headings, lists, tables and pictures.'],
    ['sheet', 'excel', 'From spreadsheet', 'Convert an .xlsx or .csv table into printable pages.'],
  ];
  let mode = 'blank'; const form = h('div.cr-form'); const list = h('div.cr-modes');
  const sizeOpts = Object.keys(PAGE_SIZES).map(k => [k, k]);

  const modeBtn = ([id, ic, title, desc]) => h('button.cr-mode', { type: 'button', 'aria-pressed': String(id === mode), onclick: () => { mode = id; draw(); } }, h('span.tc-icon', icon(ic, 22)), h('span.tc-body', h('span.tc-title', title), h('span.tc-desc', desc)));

  async function finish(name, bytes) { await app.openBytes(name, bytes); app.closeTab('create'); }

  function draw() {
    list.replaceChildren(...MODES.map(modeBtn)); form.replaceChildren(); form.classList.remove('in'); void form.offsetWidth; form.classList.add('in');
    if (mode === 'blank') {
      const size = select(sizeOpts, 'A4'); const orient = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], 'portrait', () => {}); let o = 'portrait'; orient.addEventListener('click', e => { const b = e.target.closest('button'); if (b) o = b.dataset.v; });
      const count = h('input.input', { type: 'number', min: 1, max: 500, value: 1 });
      form.append(h('h2', 'Blank pages'), field('Page size', size), field('Orientation', orient), field('Number of pages', count),
        button({ label: 'Create PDF', kind: 'primary', onClick: async () => {
          const pdf = await PDFDocument.create(); let [w, hh] = PAGE_SIZES[size.value]; if (o === 'landscape') [w, hh] = [hh, w];
          for (let i = 0; i < clampN(count.value, 1, 500); i++) pdf.addPage([w, hh]);
          await finish('Untitled.pdf', await pdf.save());
        } }));
    } else if (mode === 'images') {
      let files = []; const listEl = h('ul.cr-files'); const size = select([['fit', 'Same as image'], ...sizeOpts], 'fit'); const margin = h('input.input', { type: 'number', min: 0, max: 144, value: 0 });
      const redraw = () => { listEl.replaceChildren(...files.map((f, i) => h('li', icon('image-file', 18), h('span', f.name), button({ icon: 'up', kind: 'ghost', size: 'sm', title: 'Move up', onClick: () => { if (i) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; redraw(); } } }), button({ icon: 'down', kind: 'ghost', size: 'sm', title: 'Move down', onClick: () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; redraw(); } } }), button({ icon: 'trash', kind: 'ghost', size: 'sm', title: 'Remove', onClick: () => { files.splice(i, 1); redraw(); } })))); go.disabled = !files.length; };
      const go = button({ label: 'Create PDF', kind: 'primary', disabled: true, onClick: async () => { const out = await withProgress('Creating PDF', () => imagesToPdf(files, { size: size.value, margin: +margin.value || 0 })); if (out) await finish('Images.pdf', out); } });
      form.append(h('h2', 'From images'), button({ label: 'Add images', icon: 'image-add', onClick: async () => { files.push(...await pickFiles({ accept: 'image/*', multiple: true })); redraw(); } }), listEl, field('Page size', size), field('Margin (points)', margin), go);
    } else if (mode === 'text') {
      const ta = h('textarea.textarea.mono', { rows: 12, placeholder: '# Title\n\nWrite or paste your text here.\n\n- Bullet one\n- Bullet two' });
      const md = h('input', { type: 'checkbox', checked: true }); const size = select([9, 10, 11, 12, 14].map(n => [n, n + ' pt']), 11); const ps = select(sizeOpts, 'A4');
      form.append(h('h2', 'From text'), button({ label: 'Load .txt or .md file', icon: 'import', kind: 'secondary', onClick: async () => { const [f] = await pickFiles({ accept: '.txt,.md,text/plain', multiple: false }); if (f) ta.value = await f.text(); } }), ta,
        h('label.check', md, ' Treat as Markdown (headings, lists, **bold**, *italic*)'), h('div.cr-row', field('Font size', size), field('Page size', ps)),
        button({ label: 'Create PDF', kind: 'primary', onClick: async () => { if (!ta.value.trim()) return toast('Type or paste some text first.', 'error'); const out = await withProgress('Creating PDF', () => textToPdf(ta.value, { md: md.checked, size: +size.value, pageSize: ps.value })); if (out) await finish('Text.pdf', out); } }));
    } else if (mode === 'word' || mode === 'sheet') {
      const word = mode === 'word'; const name = h('p.hint', word ? 'No file chosen' : 'No file chosen'); let file = null;
      const go = button({ label: 'Create PDF', kind: 'primary', disabled: true, onClick: async () => { const out = await withProgress('Converting', async () => fileToPdf(file)); if (out) await finish(baseName(file.name) + '.pdf', out); } });
      form.append(h('h2', word ? 'From Word' : 'From spreadsheet'), button({ label: word ? 'Choose .docx file' : 'Choose .xlsx or .csv file', icon: 'folder-open', onClick: async () => { const [f] = await pickFiles({ accept: word ? '.docx' : '.xlsx,.csv,text/csv', multiple: false }); if (f) { file = f; name.textContent = f.name; go.disabled = false; } } }), name,
        h('p.hint', word ? 'Text, headings, lists, tables and PNG/JPEG pictures are converted. Fonts, columns and complex layout are simplified.' : 'The first rows of every sheet are laid out as a table. Dates stored as numbers may appear as serial numbers.'), go);
    }
  }
  const clampN = (v, a, b) => Math.min(b, Math.max(a, +v | 0 || a));
  root.append(h('div.home-inner', h('div.sec-h', h('h1', 'Create a PDF')), h('div.cr-grid', list, form)));
  draw();
}
