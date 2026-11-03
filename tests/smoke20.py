# Phone-style (touch, high DPR) editing of an invoice: edited text keeps the page's sans look, replaces the old text (no ghost), and never duplicates.
import asyncio, os, re, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'
async def route_fonts(route):
    u = route.request.url; m = re.search(r'/fontsource/fonts/([a-z0-9-]+)@latest/latin-(\d+-(?:normal|italic))\.woff$', u)
    f = f'/tmp/gf/roboto-{m.group(2)}.woff' if m else None
    if f and os.path.exists(f): await route.fulfill(status=200, content_type='font/woff', headers={'access-control-allow-origin':'*'}, body=open(f,'rb').read())
    else: await route.fulfill(status=404, body='nope', headers={'access-control-allow-origin':'*'})
STATE = """() => window.__app.activeDoc.pages[0].annots.filter(a => a.type === 'textedit').map(a => ({ text: a.text, orig: a.orig, x: +a.x.toFixed(1), y: +a.y.toFixed(1), font: a.font, bold: a.bold, size: a.size, patch: !!a.patch, keep: (a.keep||[]).length }))"""
async def main():
    pdf = sys.argv[1] if len(sys.argv) > 1 else 'invoice-serif.pdf'
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width':1100,'height':800}, device_scale_factor=2.75, has_touch=True, is_mobile=True, accept_downloads=True); pg = await ctx.new_page()
        await pg.route(re.compile(r'https://cdn\.jsdelivr\.net/(fontsource|npm/@fontsource)/.*'), route_fonts)
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and '404' not in m.text else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX + pdf); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1200)
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1200)
        segs = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0); return t.segments.map(s => [s.text, +s.x.toFixed(1), +s.baseline.toFixed(1), +s.fs.toFixed(1), +s.w.toFixed(1), s.family, s.fontName]); }""")
        for s in segs[:8]: print('SEG', s)
        fi = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0); const out = {}; for (const s of t.segments.slice(0, 6)) out[s.text] = await m.getFontInfo(window.__app.activeDoc.pdf, 0, s.fontName); return out; }""")
        for k, v in fi.items(): print('FONTINFO', k, v)
        async def hitbox(prefix):
            idx = next(i for i, s in enumerate(segs) if s[0].startswith(prefix))
            return await pg.locator(V+'.page').first.locator('.hit').nth(idx).bounding_box()
        hb = await hitbox('Invoice'); await pg.touchscreen.tap(hb['x'] + hb['width']*0.5, hb['y'] + hb['height']/2); await pg.wait_for_timeout(2500)
        await pg.keyboard.type('XY', delay=30); await pg.wait_for_timeout(200)
        print('after 1st tap+type:', await pg.evaluate(STATE))
        await pg.screenshot(path='/tmp/t20_a.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        r = await pg.evaluate("() => { const r = document.querySelector('.view-doc:not([hidden]) .annot.a-textedit').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; }")
        await pg.touchscreen.tap(r['x'] + 20, r['y'] + r['h']/2); await pg.wait_for_timeout(1500)
        await pg.keyboard.type('Q', delay=30); await pg.wait_for_timeout(200)
        print('after 2nd tap+type:', await pg.evaluate(STATE))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        for pref, add in (('Invoice number', 'rrr'), ('Anthropic', 'dfd')):
            hb = await hitbox(pref); await pg.touchscreen.tap(hb['x'] + hb['width']*0.4, hb['y'] + hb['height']/2); await pg.wait_for_timeout(2500)
            await pg.keyboard.type(add, delay=30); await pg.wait_for_timeout(200); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        st = await pg.evaluate(STATE); print('final:', st)
        want = 'helv' if 'sans' in pdf else 'times'
        print('CHECK', 'PASS' if len(st) == 3 and all(a['patch'] and a['font'] == want for a in st) else 'FAIL', f'3 edits, each with a redrawn background and the {want} family')
        await pg.screenshot(path='/tmp/t20_b.png')
        print('textedit elements in DOM:', await pg.evaluate("() => document.querySelectorAll('.view-doc:not([hidden]) .annot.a-textedit').length"))
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
