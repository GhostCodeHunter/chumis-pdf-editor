import asyncio, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width':1360,'height':860}, accept_downloads=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(400)
        async with pg.expect_file_chooser() as fc:
            await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/sample.pdf')
        await pg.wait_for_selector('.page canvas'); await pg.wait_for_timeout(1200)
        page0 = pg.locator('.page').first
        box = await page0.bounding_box()
        # zoom to 100% for predictable coordinates
        await pg.select_option('.zoom-select', '100'); await pg.wait_for_timeout(800)
        box = await page0.bounding_box(); print('page box', box)
        # 1. add text
        await pg.click('[data-id=text]')
        await pg.mouse.click(box['x']+300, box['y']+60)
        await pg.keyboard.type('Hello from Chumi ₹500 and plain text')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # 2. rectangle
        await pg.click('[data-id=rect]')
        await pg.mouse.move(box['x']+100, box['y']+500); await pg.mouse.down(); await pg.mouse.move(box['x']+300, box['y']+560, steps=5); await pg.mouse.up()
        await pg.wait_for_timeout(200)
        # 3. pen
        await pg.click('[data-id=pen]')
        await pg.mouse.move(box['x']+350, box['y']+500); await pg.mouse.down()
        for i in range(20): await pg.mouse.move(box['x']+350+i*8, box['y']+500+ (i%5)*6)
        await pg.mouse.up()
        # 4. edit text on 'Line 3' : find hit boxes
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1200)
        n = await pg.locator('.page').first.locator('.hit').count(); print('hit boxes', n)
        await pg.locator('.page').first.locator('.hit').nth(4).click()
        await pg.wait_for_timeout(200)
        await pg.keyboard.type('EDITED: payment received in full', delay=5)
        await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/s_edit.png')
        # 5. download
        async with pg.expect_download() as dl:
            await pg.click('#btn-download')
        d = await dl.value; await d.save_as('/tmp/out.pdf'); print('saved', d.suggested_filename)
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
