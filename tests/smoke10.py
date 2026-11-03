# Adobe-style result drawn over the signature field: tick when valid, cross when invalid, nothing extra when unknown.
import asyncio, shutil
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def open_file(pg, name):
    async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
    await (await fc.value).set_files(FX+name); await pg.wait_for_selector(V+'.page canvas', timeout=15000); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}, device_scale_factor=2); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        await open_file(pg, 'sig-adobe-appearance.pdf')
        print('unknown: skin?', await pg.locator(V+'.sig-skin').count(), '| badge', await pg.locator(V+'.sig-badge').first.get_attribute('class'))
        el = pg.locator(V+'.page').first; await el.screenshot(path='/tmp/t10_unknown.png')
        await pg.click(V+'.rail-btn[data-id=signatures]'); await pg.wait_for_selector(V+'.sg-card')
        async with pg.expect_file_chooser() as fc: await pg.click(V+'.dv-right button:has-text("Import certificate")')
        await (await fc.value).set_files(FX+'test-root-ca.pem'); await pg.wait_for_selector('.modal button:has-text("Trust certificate")'); await pg.click('.modal button:has-text("Trust certificate")')
        await pg.wait_for_timeout(1800)
        print('valid: skin?', await pg.locator(V+'.sig-skin').count(), '| glyph', await pg.locator(V+'.sig-glyph').first.get_attribute('class'), '| label', await pg.locator(V+'.sig-label').first.inner_text())
        await el.screenshot(path='/tmp/t10_valid.png')
        await pg.set_viewport_size({'width':900,'height':800}); await pg.select_option('.zoom-select', '200'); await pg.wait_for_timeout(2000)
        print('zoom 200: skin?', await pg.locator(V+'.sig-skin').count()); await el.screenshot(path='/tmp/t10_valid200.png')
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
