import asyncio, re, os, subprocess
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def route_fonts(route):
    u = route.request.url
    m = re.search(r'/fontsource/fonts/([a-z0-9-]+)@latest/latin-(\d+-(?:normal|italic))\.woff$', u)
    if m and os.path.exists(f'/tmp/gf/{m.group(1)}-{m.group(2)}.woff'):
        await route.fulfill(status=200, content_type='font/woff', headers={'access-control-allow-origin':'*'}, body=open(f'/tmp/gf/{m.group(1)}-{m.group(2)}.woff','rb').read())
    else: await route.fulfill(status=404, body='nope', headers={'access-control-allow-origin':'*'})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':860}, accept_downloads=True); pg = await ctx.new_page()
        await pg.route(re.compile(r'https://cdn\.jsdelivr\.net/(fontsource|npm/@fontsource)/.*'), route_fonts)
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'sample.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(900)
        await pg.select_option(V+'.zoom-select','100'); await pg.wait_for_timeout(700)
        box = await pg.locator(V+'.page').first.bounding_box()
        async def add_text(x, y, text, font_query=None, bold=False, italic=False):
            await pg.click(V+'[data-id=text]'); await pg.mouse.click(box['x']+x, box['y']+y); await pg.keyboard.type(text); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(250)
            await pg.locator(V+'.annot.a-text').last.click(); await pg.wait_for_timeout(150)
            if font_query:
                await pg.click(V+'.fp-btn'); await pg.fill('.fp-pop input', font_query); await pg.wait_for_timeout(400)
                await pg.locator('.fp-pop .fp-row').first.click(); await pg.wait_for_timeout(900)
            if bold: await pg.click(V+'.dv-props [title=Bold]')
            if italic: await pg.click(V+'.dv-props [title=Italic]')
            await pg.wait_for_timeout(500)
        await add_text(60, 560, 'Poppins: Hello World ₹500 fi ffl', 'poppins')
        await add_text(60, 600, 'Roboto online font (mock CDN) bold italic', 'roboto', bold=True, italic=True)
        await add_text(60, 640, 'Dancing Script has only one style', 'dancing', bold=True)
        await add_text(60, 680, 'മലയാളം नमस्ते mixed in Poppins', 'poppins')
        info = await pg.evaluate("""() => [...document.querySelectorAll('.view-doc:not([hidden]) .annot.a-text')].map(e => ({text: e.textContent.slice(0,22), fam: getComputedStyle(e).fontFamily, w: getComputedStyle(e).fontWeight, st: getComputedStyle(e).fontStyle}))""")
        for i in info: print(i)
        print('fonts registered:', await pg.evaluate("[...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.style).join(' | ')"))
        await pg.screenshot(path='/tmp/fonts_ui.png')
        # picker screenshot
        await pg.locator(V+'.annot.a-text').first.click(); await pg.click(V+'.fp-btn'); await pg.wait_for_timeout(900); await pg.screenshot(path='/tmp/fonts_picker.png'); await pg.keyboard.press('Escape')
        async with pg.expect_download() as d: await pg.click('#btn-download')
        dd = await d.value; path='/tmp/dl/fonts_out.pdf'; await dd.save_as(path)
        print(subprocess.run(['pdffonts',path],capture_output=True,text=True).stdout)
        print(subprocess.run(['pdftotext','-f','1','-l','1',path,'-'],capture_output=True,text=True).stdout[-420:])
        subprocess.run(['pdftoppm','-r','90','-png','-f','1','-l','1','-x','0','-y','560','-W','800','-H','380',path,'/tmp/fonts_out'])
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
