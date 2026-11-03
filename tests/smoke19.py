# Edit an existing heading in place (letterhead with an Ubuntu-named embedded font): the edit overlay must sit exactly on the original text.
import asyncio, os, re, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'
async def route_fonts(route):
    u = route.request.url; m = re.search(r'/fontsource/fonts/([a-z0-9-]+)@latest/latin-(\d+-(?:normal|italic))\.woff$', u)
    f = f'/tmp/gf/roboto-{m.group(2)}.woff' if m else None
    if f and os.path.exists(f): await route.fulfill(status=200, content_type='font/woff', headers={'access-control-allow-origin':'*'}, body=open(f,'rb').read())
    else: await route.fulfill(status=404, body='nope', headers={'access-control-allow-origin':'*'})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        await pg.route(re.compile(r'https://cdn\.jsdelivr\.net/(fontsource|npm/@fontsource)/.*'), route_fonts)
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and '404' not in m.text else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'letterhead-ubuntu.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1200)
        await pg.select_option('.zoom-select', '150'); await pg.wait_for_timeout(1000)
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1200)
        segs = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0); return t.segments.map(s => [s.text, +s.x.toFixed(1), +s.baseline.toFixed(1), +s.fs.toFixed(1), +s.w.toFixed(1)]); }""")
        for s in segs: print('SEG', s)
        idx = next(i for i, s in enumerate(segs) if s[0].startswith('Collab'))
        hit = await pg.locator(V+'.page').first.locator('.hit').nth(idx).bounding_box(); print('hit box (screen px):', {k: round(v,1) for k, v in hit.items()})
        # click in the middle of the heading: the caret goes THERE (nothing selected), typing inserts at that spot
        cx, cy = hit['x'] + hit['width'] * 0.42, hit['y'] + hit['height'] / 2
        await pg.mouse.click(cx, cy); await pg.wait_for_timeout(2500)
        info = await pg.evaluate("""() => { const a = window.__app.activeDoc.pages[0].annots[0]; const el = document.querySelector('.view-doc:not([hidden]) .annot.a-textedit'); const r = el.getBoundingClientRect(); const s = getSelection(); return { a: { x: a.x, y: a.y, text: a.text, font: a.font }, el: { left: r.left, top: r.top, editing: el.classList.contains('editing') }, selCollapsed: s.isCollapsed, caretOffset: s.anchorOffset, selbox: document.querySelectorAll('.selbox').length }; }""")
        print('after click:', info)
        await pg.keyboard.type('ZZ', delay=20); await pg.wait_for_timeout(200)
        print('text now:', await pg.evaluate("() => document.querySelector('.view-doc:not([hidden]) .annot.a-textedit').innerText"))
        await pg.screenshot(path='/tmp/t19_a.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        # a drag on the edited text must not move it
        r = await pg.evaluate("() => { const e = document.querySelector('.view-doc:not([hidden]) .annot.a-textedit').getBoundingClientRect(); return [e.left, e.top, e.width, e.height]; }")
        await pg.mouse.move(r[0] + 30, r[1] + 8); await pg.mouse.down(); await pg.mouse.move(r[0] + 70, r[1] + 45, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(300)
        after = await pg.evaluate("() => { const a = window.__app.activeDoc.pages[0].annots[0]; return { x: a.x, y: a.y, text: a.text, editing: !!document.querySelector('.annot.editing') }; }")
        print('after a drag attempt: x,y =', after['x'], after['y'], '(was', info['a']['x'], info['a']['y'], ') editing:', after['editing'])
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
