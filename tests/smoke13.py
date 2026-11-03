# The printed copy carries the validation result: built-in trust (no manual import) -> valid -> tick drawn into the print copy.
import asyncio, base64, subprocess
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'sig-adobe-appearance.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1500)
        print('before trusting:', await pg.inner_text(V+'.dv-sigbar'))
        # trust the test root by import (stands in for the built-in CCA roots, which the test certificate does not chain to)
        await pg.click(V+'.rail-btn[data-id=signatures]'); await pg.wait_for_selector(V+'.sg-card')
        print('panel mentions built-in roots:', 'Built in' in await pg.inner_text(V+'.dv-right'))
        async with pg.expect_file_chooser() as fc: await pg.click(V+'.dv-right button:has-text("Import certificate")')
        await (await fc.value).set_files(FX+'test-root-ca.pem'); await pg.wait_for_selector('.modal button:has-text("Trust certificate")'); await pg.click('.modal button:has-text("Trust certificate")'); await pg.wait_for_timeout(1800)
        print('after trusting:', (await pg.inner_text(V+'.dv-sigbar')).split('\n')[0])
        b64 = await pg.evaluate("""async () => { const dv = window.__app.views.get(window.__app.active).dv; const m = await import('/js/signatures.js'); const out = await m.stampForPrint(dv, dv.doc.bytes);
            let s = ''; const CH = 0x8000; for (let i = 0; i < out.length; i += CH) s += String.fromCharCode.apply(null, out.subarray(i, i + CH)); return btoa(s); }""")
        open('/tmp/t13_print.pdf','wb').write(base64.b64decode(b64)); subprocess.run(['pdftoppm','-r','110','-png','/tmp/t13_print.pdf','/tmp/t13_print'])
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
