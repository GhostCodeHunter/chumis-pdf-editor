import asyncio
from playwright.async_api import async_playwright
V='.view-doc:not([hidden]) '
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width':1366,'height':860})).new_page()
        pg.on('console', lambda m: print('[console]', m.type, m.text)); pg.on('pageerror', lambda e: print('[pageerror]', e))
        await pg.goto('http://127.0.0.1:8765/app.html'); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/sample.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(900)
        await pg.click(V+'[data-id=text]'); box = await pg.locator(V+'.page').first.bounding_box(); await pg.mouse.click(box['x']+100, box['y']+300); await pg.keyboard.type('abc'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        print('props html:', (await pg.inner_html(V+'.dv-props'))[:300])
        print('fp-btn count', await pg.locator(V+'.fp-btn').count())
        await pg.click(V+'.fp-btn'); await pg.wait_for_timeout(500); print('pop count', await pg.locator('.fp-pop').count())
        await pg.screenshot(path='/tmp/dbg4.png')
        await b.close()
asyncio.run(main())
