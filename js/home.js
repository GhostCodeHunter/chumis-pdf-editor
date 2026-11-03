// Home and Tools screens.
import { h, icon, button, emptyState } from './ui.js';
import { APP_NAME, APP_TAGLINE, COPYRIGHT_HOLDER, COPYRIGHT_YEAR, REPO_URL } from './config.js';

/** Every tool card. `view` opens a stand-alone screen; `run(dv)` needs an open document. */
export const TOOL_CARDS = [
  { id: 'edit', group: 'Create & edit', icon: 'edit-text', title: 'Edit a PDF', desc: 'Change text, add images, shapes, drawings and highlights.', run: dv => dv.setTool('edittext') },
  { id: 'create', group: 'Create & edit', icon: 'file-plus', title: 'Create a PDF', desc: 'Start from blank pages, images, text, Word or a spreadsheet.', view: 'create' },
  { id: 'combine', group: 'Create & edit', icon: 'merge', title: 'Combine files', desc: 'Merge PDFs and images into one document, in any order.', view: 'combine' },
  { id: 'organize', group: 'Organize', icon: 'layers', title: 'Organize pages', desc: 'Reorder, rotate, delete, extract, insert and split pages.', run: dv => dv.openOrganize() },
  { id: 'split', group: 'Organize', icon: 'scissors', title: 'Split a PDF', desc: 'Cut a document into several files by page range.', run: dv => dv.openOrganize().then(() => dv.organizer?.splitDialog()) },
  { id: 'ocr', group: 'Convert', icon: 'ocr', title: 'Scan & OCR', desc: 'Turn scanned pages into searchable, editable text.', run: dv => dv.openPanel('ocr') },
  { id: 'export', group: 'Convert', icon: 'export', title: 'Export a PDF', desc: 'Word, Excel, PowerPoint, images, HTML, Markdown or plain text.', run: dv => dv.openPanel('export') },
  { id: 'sign', group: 'Review & sign', icon: 'sign', title: 'Fill & Sign', desc: 'Draw, type or upload a signature and place it on any page.', run: dv => dv.openPanel('sign') },
  { id: 'comment', group: 'Review & sign', icon: 'highlight', title: 'Add comments', desc: 'Highlight, underline, strike through and leave sticky notes.', run: dv => dv.setTool('highlight') },
  { id: 'redact', group: 'Review & sign', icon: 'redact', title: 'Redact a PDF', desc: 'Permanently black out sensitive text and images.', run: dv => dv.setTool('redact') },
  { id: 'verify', group: 'Verify', icon: 'shield-check', title: 'Verify documents', desc: 'Check Aadhaar, PAN, GST and Certificate of Incorporation details.', run: dv => dv.openPanel('verify'), badge: 'New' },
  { id: 'watermark', group: 'Protect & optimize', icon: 'drop', title: 'Watermark & page numbers', desc: 'Stamp text across pages and number them.', run: dv => dv.openPanel('tools') },
  { id: 'compress', group: 'Protect & optimize', icon: 'compress', title: 'Reduce file size', desc: 'Shrink scanned or image-heavy PDFs.', run: dv => dv.openPanel('tools') },
];
const QUICK = ['edit', 'create', 'combine', 'organize', 'ocr', 'export', 'sign', 'verify'];

export function legalLinks() {
  return h('nav.legal-links', { 'aria-label': 'Legal' },
    h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy'),
    h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, 'Terms'),
    h('a', { href: 'disclaimer.html', target: '_blank', rel: 'noopener' }, 'Disclaimer'),
    h('a', { href: 'licenses.html', target: '_blank', rel: 'noopener' }, 'Open-source licences'),
    h('a', { href: 'index.html' }, 'About'),
    REPO_URL ? h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'GitHub') : null);
}
export function copyrightLine() {
  return h('p.copyright', `© ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER}. All rights reserved. ${APP_NAME} is not affiliated with Adobe, UIDAI, the Income Tax Department, GSTN or the Ministry of Corporate Affairs.`);
}

function card(t, onOpen) {
  return h('button.tool-card', { type: 'button', onclick: () => onOpen(t) },
    h('span.tc-icon', icon(t.icon, 24)),
    h('span.tc-body', h('span.tc-title', t.title, t.badge ? h('em.badge', t.badge) : null), h('span.tc-desc', t.desc)));
}

export function renderHome(root, app) {
  root.replaceChildren();
  const drop = h('div.home-hero',
    h('div.hero-copy',
      h('h1', 'What would you like to do?'),
      h('p', APP_TAGLINE),
      h('div.hero-actions',
        button({ label: 'Open a PDF', icon: 'folder-open', kind: 'primary', onClick: () => app.openDialog() }),
        button({ label: 'Create a PDF', icon: 'file-plus', onClick: () => app.activate('create') }),
        button({ label: 'Combine files', icon: 'merge', onClick: () => app.activate('combine') })),
      h('p.hero-hint', icon('lock', 16), ' Files stay on your device. Nothing is uploaded.')),
    h('button.dropzone', { type: 'button', onclick: () => app.openDialog(), 'aria-label': 'Open files' },
      icon('cloud', 40), h('strong', 'Drop a PDF here'), h('span', 'or click to browse — you can also drop images, Word or Excel files to convert them')));
  const quick = h('section.home-sec', h('div.sec-h', h('h2', 'Quick tools'), button({ label: 'All tools', kind: 'ghost', icon: 'chev-right', onClick: () => app.activate('tools') })),
    h('div.card-grid', QUICK.map(id => card(TOOL_CARDS.find(t => t.id === id), t => app.runTool(t)))));
  const open = h('section.home-sec.open-docs', h('div.sec-h', h('h2', 'Open documents')),
    app.docs.length ? h('ul.doc-list', app.docs.map(d => h('li', h('button', { type: 'button', onclick: () => app.activate(d.id) }, icon('pdf', 22), h('span.dl-name', d.name), h('span.dl-meta', `${d.numPages} page${d.numPages === 1 ? '' : 's'}`)))))
      : emptyState({ icon: 'file', title: 'No documents open', text: 'Open a PDF to start editing. It stays in this tab until you close it.' }));
  root.append(h('div.home-inner', drop, quick, open, h('footer.page-foot', legalLinks(), copyrightLine())));
}

export function renderTools(root, app) {
  root.replaceChildren();
  const q = h('input.input', { type: 'search', placeholder: 'Search tools', 'aria-label': 'Search tools', oninput: () => draw() });
  const holder = h('div');
  const draw = () => {
    const term = q.value.trim().toLowerCase(); holder.replaceChildren();
    const groups = [...new Set(TOOL_CARDS.map(t => t.group))];
    let any = false;
    for (const g of groups) {
      const items = TOOL_CARDS.filter(t => t.group === g && (!term || (t.title + ' ' + t.desc).toLowerCase().includes(term)));
      if (!items.length) continue; any = true;
      holder.append(h('section.home-sec', h('div.sec-h', h('h2', g)), h('div.card-grid', items.map(t => card(t, x => app.runTool(x))))));
    }
    if (!any) holder.append(emptyState({ icon: 'search', title: 'No tools match', text: 'Try “merge”, “OCR” or “sign”.' }));
  };
  draw();
  root.append(h('div.home-inner', h('div.sec-h.tools-h', h('h1', 'All tools'), q), holder, h('footer.page-foot', legalLinks(), copyrightLine())));
}
