import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width':1366,'height':800})).new_page()
        pg.on('console', lambda m: print('[console]', m.type, m.text) if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: print('[pageerror]', e))
        await pg.goto('http://127.0.0.1:8765/app.html'); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/sample.pdf'); await pg.wait_for_selector('.page canvas'); await pg.wait_for_timeout(1200)
        await pg.click('.view-doc:not([hidden]) .rail-btn[data-id=organize]'); await pg.wait_for_selector('.og-card'); await pg.wait_for_timeout(900)
        await pg.locator('.og-card').nth(1).click(); await pg.wait_for_timeout(400)
        await pg.screenshot(path='/tmp/o1.png')
        sw = await pg.evaluate("document.documentElement.scrollWidth"); print('scrollWidth', sw)
        await b.close()
asyncio.run(main())
