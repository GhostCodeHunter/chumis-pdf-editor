# Editing one cell of a ruled table: the other cells and the borders must survive, and the font must carry over.
import asyncio, subprocess
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/invoice-table.pdf')
        await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1200)
        await pg.select_option('.zoom-select', '150'); await pg.wait_for_timeout(1200)
        info = await pg.evaluate("""async () => { const m = await import('/js/pdfio.js'); const t = await m.getPageText(window.__app.activeDoc.pdf, 0);
            return t.segments.map(s => ({ t: s.text, x: +s.x.toFixed(1), w: +s.w.toFixed(1), fs: +s.fs.toFixed(1), items: s.items.length })); }""")
        for s in info: print('SEG', s)
        await pg.click('[data-id=edittext]'); await pg.wait_for_timeout(1500)
        hits = pg.locator(V+'.page').first.locator('.hit'); n = await hits.count(); print('hit boxes', n, '(expect 21: every cell separate, incl. the two touching columns)')
        # find the hit whose segment is the first-row description
        segs2 = await pg.evaluate("async () => { const v = window.__app.activeDoc ? null : null; return null; }")
        idx = next(i for i, s in enumerate(info) if s['t'].startswith('Rent & Internet'))
        widths = await pg.evaluate("() => [...document.querySelectorAll('.view-doc:not([hidden]) .page .hit')].map(e => parseFloat(e.style.width))")
        print('hit width for description (pt):', widths[idx], 'reported seg width:', info[idx]['w'])
        await hits.nth(idx).click(); await pg.wait_for_timeout(300)
        a = await pg.evaluate("() => { const d = window.__app.activeDoc; return d.pages[0].annots.map(a => ({ type: a.type, font: a.font, bold: a.bold, coverW: a.coverW, keep: (a.keep||[]).map(k => [k.x,k.w,k.h].join('/')) })); }")
        print('ANNOT', a)
        await pg.keyboard.press('Control+A'); await pg.keyboard.type('EDITED description', delay=5); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/t9_screen.png')
        # second edit: the 'Quantity' cell whose last glyph runs into the column rule
        idx2 = next(i for i, s in enumerate(info) if s['t'].startswith('1.00 Month'))
        await hits.nth(idx2 + 1 if False else idx2).click(); await pg.wait_for_timeout(300)
        a2 = await pg.evaluate("() => window.__app.activeDoc.pages[0].annots.filter(a => a.type==='textedit').map(a => ({ text: a.orig, coverW: a.coverW, bold: a.bold, keep: (a.keep||[]).map(k => [k.x,k.w,k.h,k.c].join('/')) }))")
        print('ANNOTS', a2)
        await pg.keyboard.press('Control+A'); await pg.keyboard.type('2.00 Month', delay=5); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/t9_screen2.png')
        async with pg.expect_download() as dl: await pg.click('#btn-download')
        await (await dl.value).save_as('/tmp/t9_out.pdf')
        print(subprocess.run(['pdftotext','-layout','/tmp/t9_out.pdf','-'],capture_output=True,text=True).stdout[:700])
        subprocess.run(['pdftoppm','-r','110','-png','/tmp/t9_out.pdf','/tmp/t9_out'])
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
