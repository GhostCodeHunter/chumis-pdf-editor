import asyncio
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'
async def open_file(pg, name):
    async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
    await (await fc.value).set_files(FX+name)
    await pg.wait_for_selector('.view-doc:not([hidden]) .page canvas', timeout=15000); await pg.wait_for_timeout(700)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(400)
        for name in ['aadhaar-like.pdf','gst-signed.pdf','gst-signed-tampered.pdf']:
            await open_file(pg, name)
            await pg.click('.view-doc:not([hidden]) .rail-btn[data-id=verify]'); await pg.wait_for_selector('.view-doc:not([hidden]) .dv-right .btn-primary')
            await pg.click('.view-doc:not([hidden]) .dv-right .btn-primary:has-text("Scan this document")')
            await pg.wait_for_selector('.view-doc:not([hidden]) .vf-summary', timeout=20000); await pg.wait_for_timeout(500)
            txt = await pg.inner_text('.view-doc:not([hidden]) .vf-out')
            print('=====', name); print(txt[:1400])
            await pg.screenshot(path=f'/tmp/v_{name[:-4]}.png')
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
