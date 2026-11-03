// Font picker: standard fonts, the bundled Google Font, a searchable Google Fonts catalogue and "add another".
import { h, icon, button, toast, dialog, field } from './ui.js';
import { BUILTIN, BUNDLED, CATALOG, CATEGORIES, allFonts, extras, recents, remember, entryFor, familyOf, labelFor, isCustom, idOf, idFromName, loadStyle } from './fonts.js';

const EXTRA_KEY = 'chumi.fonts.extra';

/** value: { font, gname }  —  onChange({ font, gname }) */
export function fontPicker({ value, onChange }) {
  let cur = { ...value };
  let pop = null, io = null;
  const label = h('span.fp-label'); const btn = h('button.fp-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': 'Font' }, label, icon('chev-down', 16));
  const paint = () => { label.textContent = labelFor(cur.font, cur.gname); label.style.fontFamily = isCustom(cur.font) ? familyOf(idOf(cur.font)) : ''; if (isCustom(cur.font)) loadStyle(entryFor(idOf(cur.font), cur.gname), 400, 'normal').then(() => { label.style.fontFamily = familyOf(idOf(cur.font)); }); };
  paint();
  btn.addEventListener('click', () => open());
  const root = h('div.fp', btn); root.set = v => { cur = { ...v }; paint(); };
  return root;

  function pick(font, gname) { cur = { font, gname }; if (isCustom(font)) remember(idOf(font)); paint(); close(); onChange({ font, gname }); }
  function close() { if (!pop) return; pop.classList.add('leaving'); const p = pop; setTimeout(() => p.remove(), 140); pop = null; io && io.disconnect(); document.removeEventListener('pointerdown', off, true); btn.focus(); }
  function off(e) { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }

  function open() {
    if (pop) return close();
    let cat = 'all', term = '';
    const search = h('input.input', { type: 'search', placeholder: 'Search fonts', 'aria-label': 'Search fonts', oninput: e => { term = e.target.value.trim().toLowerCase(); draw(); }, onkeydown: e => { if (e.key === 'Enter') list.querySelector('.fp-row')?.click(); if (e.key === 'Escape') close(); } });
    const tabs = h('div.fp-tabs', CATEGORIES.map(([id, l]) => h('button', { type: 'button', 'aria-pressed': String(id === cat), dataset: { id }, onclick: () => { cat = id; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id))); draw(); } }, l)));
    const list = h('div.fp-list', { role: 'listbox' });
    const r = btn.getBoundingClientRect();
    pop = h('div.fp-pop', { style: { left: Math.max(8, Math.min(r.left, innerWidth - 340)) + 'px', top: Math.min(r.bottom + 4, innerHeight - 440) + 'px' } }, search, tabs, list,
      h('div.fp-foot', button({ label: 'Add another Google Font…', icon: 'plus', kind: 'ghost', size: 'sm', onClick: () => { close(); addDialog(); } }), h('span.hint', 'Google Fonts load on first use')));
    document.body.append(pop); setTimeout(() => document.addEventListener('pointerdown', off, true), 0); search.focus();
    io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); const e = entryFor(en.target.dataset.id); loadStyle(e, 400, 'normal').then(rec => { en.target.classList.toggle('missing', !rec); }); } }), { root: list, rootMargin: '120px' });

    function row(f, isG) {
      const font = isG ? 'g:' + f.id : f.key; const on = cur.font === font;
      const el = h('button.fp-row', { type: 'button', role: 'option', 'aria-selected': String(on), dataset: { id: f.id || '' }, onclick: () => pick(font, isG ? f.name : undefined) },
        h('span.fp-name', { style: { fontFamily: isG ? familyOf(f.id) : '' } }, f.name), f.bundled ? h('em.badge', 'Offline') : isG ? h('span.fp-cloud', { title: 'Loaded from Google Fonts when first used' }, icon('cloud', 14)) : null, on ? icon('check', 16) : null);
      if (isG) io.observe(el); return el;
    }
    function draw() {
      list.replaceChildren(); const ok = f => (cat === 'all' || f.cat === cat) && (!term || f.name.toLowerCase().includes(term));
      const sec = (title, items, isG) => { if (!items.length) return; list.append(h('div.fp-sec', title)); items.forEach(f => list.append(row(f, isG))); };
      if (cat === 'all' && !term) sec('Standard', BUILTIN, false);
      const rec = recents().map(id => entryFor(id)).filter(ok); if (!term && cat === 'all') sec('Recently used', rec, true);
      sec('Bundled with the app', BUNDLED.filter(ok), true);
      sec('Google Fonts', allFonts().filter(f => !f.bundled && ok(f)), true);
      if (!list.children.length) list.append(h('p.hint', { style: { padding: '12px' } }, 'No fonts match. Use “Add another Google Font…” to type its exact name.'));
    }
    draw();
  }

  function addDialog() {
    const input = h('input.input', { type: 'text', placeholder: 'e.g. Josefin Slab', autofocus: true });
    const msg = h('p.hint', 'Type the family name exactly as it appears on fonts.google.com.');
    const go = async () => {
      const name = input.value.trim(); if (!name) return; const id = idFromName(name);
      go_btn.disabled = true; msg.textContent = 'Checking…';
      const e = { id, name, cat: 'sans' }; const rec = await loadStyle(e, 400, 'normal');
      if (!rec) { msg.textContent = `“${name}” could not be loaded. Check the spelling and your internet connection.`; go_btn.disabled = false; return; }
      try { const ex = extras().filter(x => x.id !== id); ex.push(e); localStorage.setItem(EXTRA_KEY, JSON.stringify(ex)); } catch {}
      d.close(); pick('g:' + id, name);
    };
    const go_btn = button({ label: 'Add font', kind: 'primary', onClick: go });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
    const d = dialog({ title: 'Add a Google Font', width: 420, body: h('div', field('Font family', input), msg), actions: [button({ label: 'Cancel', onClick: () => d.close() }), go_btn] });
  }
}
