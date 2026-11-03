import asyncio
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def open_file(pg, name):
    async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
    await (await fc.value).set_files(FX+name)
    await pg.wait_for_selector(V+'.page canvas', timeout=15000); await pg.wait_for_timeout(1200)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':860}); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        # 1. untrusted self-signed
        await open_file(pg, 'gst-signed.pdf')
        print('BANNER 1:', await pg.inner_text(V+'.dv-sigbar'))
        print('badges:', await pg.locator(V+'.sig-badge').count(), 'class:', await pg.locator(V+'.sig-badge').first.get_attribute('class'))
        await pg.screenshot(path='/tmp/sg1.png')
        await pg.locator(V+'.sig-badge').first.click(); await pg.wait_for_selector('.popmenu'); print('MENU:', (await pg.inner_text('.popmenu')).replace('\n',' | '))
        await pg.screenshot(path='/tmp/sg2.png')
        await pg.click('.popmenu button:has-text("Validate Signature")'); await pg.wait_for_selector('.modal .sg-status'); print('DIALOG:', (await pg.inner_text('.modal')).replace('\n',' | ')[:700])
        await pg.screenshot(path='/tmp/sg3.png'); await pg.click('.modal .btn-primary:has-text("Close")'); await pg.wait_for_timeout(300)
        # certificate viewer + trust it via panel import
        await pg.click(V+'.rail-btn[data-id=signatures]'); await pg.wait_for_selector(V+'.sg-card')
        async with pg.expect_file_chooser() as fc: await pg.click(V+'.dv-right button:has-text("Import certificate")')
        await (await fc.value).set_files(FX+'test-signer.pem'); await pg.wait_for_selector('.modal button:has-text("Trust certificate")'); await pg.click('.modal button:has-text("Trust certificate")')
        await pg.wait_for_timeout(1200)
        print('BANNER after trust:', await pg.inner_text(V+'.dv-sigbar')); print('badge class:', await pg.locator(V+'.sig-badge').first.get_attribute('class'))
        await pg.screenshot(path='/tmp/sg4.png')
        # 2. tampered
        await open_file(pg, 'gst-signed-tampered.pdf'); print('BANNER tampered:', await pg.inner_text(V+'.dv-sigbar'))
        # 3. modified after signing
        await open_file(pg, 'gst-signed-then-edited.pdf'); print('BANNER edited:', await pg.inner_text(V+'.dv-sigbar'))
        await pg.locator(V+'.sig-badge').first.click(); await pg.click('.popmenu button:has-text("Compare Signed Version")'); await pg.wait_for_selector('.cmp-grid canvas', timeout=15000); await pg.wait_for_timeout(1500)
        print('COMPARE:', await pg.inner_text('.cmp-bar')); await pg.screenshot(path='/tmp/sg5.png'); await pg.click('.modal .btn-primary:has-text("Close")'); await pg.wait_for_timeout(300)
        n0 = await pg.evaluate("window.__app.docs.length")
        await pg.locator(V+'.sig-badge').first.click(); await pg.click('.popmenu button:has-text("View Signed Version")'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(800)
        print('VIEW SIGNED: docs', n0, '->', await pg.evaluate("window.__app.docs.length"), '| name:', await pg.evaluate("window.__app.activeDoc.name"), '| banner:', await pg.inner_text(V+'.dv-sigbar'))
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
