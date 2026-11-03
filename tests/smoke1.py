import asyncio, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1360,'height':860})
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(600)
        await pg.screenshot(path='/tmp/s_home.png')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/sample.pdf')
        await pg.wait_for_selector('.page canvas', timeout=15000)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='/tmp/s_doc.png')
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
