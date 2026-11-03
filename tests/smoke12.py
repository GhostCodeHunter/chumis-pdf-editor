# Editing text that sits on a watermark / tint / table rules: only the text changes, the background stays exactly as it was.
import asyncio, subprocess
from playwright.async_api import async_playwright
from PIL import Image, ImageChops
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and 'ERR_TUNNEL' not in m.text else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'watermarked-table.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1200)
        await pg.select_option('.zoom-select', '150'); await pg.wait_for_timeout(1200)
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1500)
        segs = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0); return t.segments.map(s => s.text); }""")
        print('segments:', segs)
        for want in ('Address of Principal', 'Legal Name'):
            idx = next(i for i, s in enumerate(segs) if s.startswith(want))
            await pg.locator(V+'.page').first.locator('.hit').nth(idx).click(); await pg.wait_for_timeout(1200)
            a = await pg.evaluate("() => window.__app.activeDoc.pages[0].annots.map(a => ({ orig: a.orig, patch: !!a.patch, keep: (a.keep||[]).length }))"); print('ANNOTS', a)
            await pg.keyboard.press('Control+A'); await pg.keyboard.type('EDITED ' + want[:6], delay=4); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/t12_screen.png')
        async with pg.expect_download() as dl: await pg.click('#btn-download')
        await (await dl.value).save_as('/tmp/t12_out.pdf')
        subprocess.run(['pdftoppm','-r','150','-png','/tmp/t12_out.pdf','/tmp/t12_out']); subprocess.run(['pdftoppm','-r','150','-png',FX+'watermarked-table.pdf','/tmp/t12_orig'])
        print(subprocess.run(['pdftotext','-layout','/tmp/t12_out.pdf','-'],capture_output=True,text=True).stdout[:400])
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
