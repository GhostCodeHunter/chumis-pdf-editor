# Edited text uses the PDF's own typeface (Arial -> Arimo here, served from a mocked CDN), and Print builds the printable PDF.
import asyncio, re, subprocess
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '
async def route_fonts(route):
    u = route.request.url; m = re.search(r'/fontsource/fonts/([a-z0-9-]+)@latest/latin-(\d+-(?:normal|italic))\.woff$', u)
    if m and m.group(1) == 'arimo' and __import__('os').path.exists(f'/tmp/gf/roboto-{m.group(2)}.woff'):   # stand-in for Arimo
        await route.fulfill(status=200, content_type='font/woff', headers={'access-control-allow-origin':'*'}, body=open(f'/tmp/gf/roboto-{m.group(2)}.woff','rb').read())
    else: await route.fulfill(status=404, body='nope', headers={'access-control-allow-origin':'*'})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        await pg.route(re.compile(r'https://cdn\.jsdelivr\.net/(fontsource|npm/@fontsource)/.*'), route_fonts)
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and '404' not in m.text else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/invoice-table.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1200)
        await pg.select_option('.zoom-select', '150'); await pg.wait_for_timeout(1200)
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1200)
        info = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0); return t.segments.map(s => s.text); }""")
        idx = next(i for i, s in enumerate(info) if s.startswith('Rent & Internet'))
        await pg.locator(V+'.page').first.locator('.hit').nth(idx).click(); await pg.wait_for_timeout(1500)
        a = await pg.evaluate("() => window.__app.activeDoc.pages[0].annots.map(a => ({ font: a.font, gname: a.gname, bold: a.bold }))"); print('ANNOT', a)
        await pg.keyboard.press('Control+A'); await pg.keyboard.type('Same typeface check', delay=5); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        async with pg.expect_download() as dl: await pg.click('#btn-download')
        await (await dl.value).save_as('/tmp/t11_out.pdf')
        print(subprocess.run(['pdffonts','/tmp/t11_out.pdf'],capture_output=True,text=True).stdout)
        # print
        print('print button visible:', await pg.locator('#btn-print').is_visible())
        await pg.evaluate("() => { window.__printed = 0; const orig = HTMLIFrameElement.prototype; }")
        await pg.click('#btn-print'); await pg.wait_for_selector('iframe[aria-hidden=true]', state='attached', timeout=20000)
        head = await pg.evaluate("async () => { const f = document.querySelector('iframe[aria-hidden=true]'); const r = await fetch(f.src); const b = new Uint8Array(await r.arrayBuffer()); return [f.src.slice(0,5), String.fromCharCode(...b.slice(0,5)), b.length]; }")
        print('print iframe:', head)
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
