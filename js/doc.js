// The document model: bytes + pdf.js proxy + per-page edits (annotations, OCR) + undo history.
import { openPdfJs, destroyPdf, PDFLib, renderToCanvas, canvasToBytes, getPageText, clearTextCache } from './pdfio.js';
import { bakeDoc, readFormFields, addInvisibleText } from './bake.js';
import { uid, bytesToDataUrl } from './ui.js';
import { MAX_UNDO } from './config.js';

const newPage = () => ({ uid: uid(), annots: [], ocr: null });

export class PdfDoc extends EventTarget {
  constructor(name, bytes) {
    super();
    this.id = uid(); this.name = name; this.bytes = bytes; this.originalBytes = bytes; // originalBytes is what was opened (used for signature checks)
    this.assets = new Map();
    this.undoStack = []; this.redoStack = [];
    this.dirty = false; this.formValues = {}; this.formFields = null; this.flattenForm = false;
    this.rev = 0; // increments whenever bytes are replaced
  }

  static async open(name, bytes) {
    const d = new PdfDoc(name, bytes);
    await d.load();
    return d;
  }

  async load(password) {
    const { pdf, password: pw } = await openPdfJs(this.bytes, { name: this.name, password });
    this.pdf = pdf; this.password = pw; this.numPages = pdf.numPages;
    this.editable = true; this.lockReason = null;
    if (pw) { this.editable = false; this.lockReason = 'This file is password protected.'; }
    else {
      try { await PDFLib.PDFDocument.load(this.bytes, { updateMetadata: false }); }
      catch (e) { this.editable = false; this.lockReason = /encrypt/i.test(e.message) ? 'This file is encrypted.' : 'This file has a structure that can’t be edited directly.'; }
    }
    this.pages = Array.from({ length: pdf.numPages }, newPage);
    this.formFields = null;
    this.snapshotBase = this.snapshot();
    this.rev++;
  }

  /* ----- assets (images used by annotations) ----- */
  addAsset(bytes, mime) {
    const id = uid();
    this.assets.set(id, { bytes, mime, url: bytesToDataUrl(bytes, mime) });
    return id;
  }

  /* ----- history ----- */
  snapshot() { return JSON.stringify(this.pages.map(p => p.annots)); }
  restore(snap) {
    const arr = JSON.parse(snap);
    this.pages.forEach((p, i) => { p.annots = arr[i] || []; });
  }
  /** Call after any change to annotations. */
  checkpoint() {
    const snap = this.snapshot();
    if (snap === this.snapshotBase) return;
    this.undoStack.push(this.snapshotBase); if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0; this.snapshotBase = snap; this.dirty = true;
    this.emit('history');
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshotBase); this.snapshotBase = this.undoStack.pop(); this.restore(this.snapshotBase); this.dirty = true; this.emit('annots', { all: true }); this.emit('history'); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshotBase); this.snapshotBase = this.redoStack.pop(); this.restore(this.snapshotBase); this.dirty = true; this.emit('annots', { all: true }); this.emit('history'); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  hasEdits() { return this.pages.some(p => p.annots.length || p.ocr) || Object.keys(this.formValues).length > 0; }

  /* ----- output ----- */
  async bake(opts) { return bakeDoc(this, opts); }

  /** Replace the underlying file (after organize, watermark, unlock, …). Edits are expected to be baked in already. */
  async replaceBytes(bytes, { name, keepPages } = {}) {
    const old = this.pages;
    clearTextCache(this.pdf);
    destroyPdf(this.pdf);
    this.bytes = bytes; if (name) this.name = name;
    await this.load(this.password);
    if (keepPages) this.pages = keepPages.map(oldIdx => (oldIdx == null ? newPage() : old[oldIdx]));
    this.undoStack = []; this.redoStack = []; this.snapshotBase = this.snapshot();
    this.dirty = true;
    this.emit('structure');
  }

  /** Bake everything, then run `op(bytes) -> bytes` and swap the result in. */
  async applyBytesOp(op) {
    const baked = await this.bake();
    const out = await op(baked);
    await this.replaceBytes(out);
  }

  async getFormFields() {
    if (!this.formFields) this.formFields = this.editable ? await readFormFields(this.bytes) : [];
    return this.formFields;
  }

  /** Re-creates the file from page pictures so it can be edited (used for password-protected / unreadable files). */
  async unlock({ onProgress } = {}) {
    const out = await rasterizeToPdf(this.pdf, { scale: 2, quality: 0.88, withText: true, onProgress });
    this.password = undefined;
    await this.replaceBytes(out);
  }

  destroy() { destroyPdf(this.pdf); }
}

/** Renders every page to an image and builds a new PDF from them, keeping text selectable (hidden text layer). */
export async function rasterizeToPdf(pdf, { scale = 2, quality = 0.85, withText = true, onProgress } = {}) {
  const { PDFDocument } = PDFLib;
  const out = await PDFDocument.create();
  for (let i = 0; i < pdf.numPages; i++) {
    onProgress && onProgress(i / pdf.numPages, `Page ${i + 1} of ${pdf.numPages}`);
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const c = await renderToCanvas(pdf, i, scale);
    const jpg = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', quality));
    const np = out.addPage([vp.width, vp.height]);
    np.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
    if (withText) {
      const t = await getPageText(pdf, i);
      const words = t.items.filter(it => Math.abs(it.angle) < 0.05).map(it => ({ text: it.str, x: it.x, y: it.baseline - it.fs, w: it.w, h: it.fs / 0.85 }));
      if (words.length) await addInvisibleText(out, np, words);
    }
  }
  return out.save({ useObjectStreams: true });
}
