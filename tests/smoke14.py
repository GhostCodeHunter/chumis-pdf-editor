# A password-protected signed file (the e-Aadhaar / e-PAN situation): open with the password, validate, tick on the field, print copy.
import asyncio, base64, subprocess
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}, device_scale_factor=2); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'encrypted-signed.pdf')
        await pg.wait_for_selector('.modal input[type=password]', timeout=15000); await pg.fill('.modal input[type=password]', 'secret'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector(V+'.page canvas', timeout=20000); await pg.wait_for_timeout(2000)
        print('opened; sigbar:', (await pg.inner_text(V+'.dv-sigbar')).split('\n')[0])
        await pg.click(V+'.rail-btn[data-id=signatures]'); await pg.wait_for_selector(V+'.sg-card')
        async with pg.expect_file_chooser() as fc: await pg.click(V+'.dv-right button:has-text("Import certificate")')
        await (await fc.value).set_files(FX+'test-root-ca-enc.pem'); await pg.wait_for_selector('.modal button:has-text("Trust certificate")'); await pg.click('.modal button:has-text("Trust certificate")'); await pg.wait_for_timeout(3500)
        print('after trusting:', (await pg.inner_text(V+'.dv-sigbar')).split('\n')[0], '| skin on page:', await pg.locator(V+'.sig-skin').count())
        await pg.locator(V+'.page').first.screenshot(path='/tmp/t14_screen.png')
        # print copy (locked file -> made from page pictures, then the validation marks are drawn in)
        b64 = await pg.evaluate("""async () => { const dv = window.__app.views.get(window.__app.active).dv; const d = await import('/js/doc.js'); const m = await import('/js/signatures.js');
            const raw = await d.rasterizeToPdf(dv.doc.pdf, { scale: 3, quality: 0.9, withText: false }); const out = await m.stampForPrint(dv, raw);
            let s = ''; const CH = 0x8000; for (let i = 0; i < out.length; i += CH) s += String.fromCharCode.apply(null, out.subarray(i, i + CH)); return btoa(s); }""")
        open('/tmp/t14_print.pdf','wb').write(base64.b64decode(b64)); subprocess.run(['pdftoppm','-r','110','-png','/tmp/t14_print.pdf','/tmp/t14_print'])
        print('print copy built:', len(b64)//1000, 'KB'); print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
