import asyncio, zipfile, io, os, subprocess, traceback
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; OUT='/tmp/dl/'; os.makedirs(OUT, exist_ok=True)
V='.view-doc:not([hidden]) '
async def open_file(pg, name, password=None):
    async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
    await (await fc.value).set_files(FX+name)
    if password:
        await pg.fill('.modal input[type=password]', password); await pg.click('.modal .btn-primary')
    await pg.wait_for_selector(V+'.page canvas', timeout=20000); await pg.wait_for_timeout(600)
async def npages(pg): return await pg.evaluate("window.__app.activeDoc.numPages")
async def dl(pg, click_sel, name):
    async with pg.expect_download(timeout=60000) as d: await pg.click(click_sel)
    dd = await d.value; path = OUT+name+'__'+dd.suggested_filename; await dd.save_as(path); return path
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(400)
        R=[]
        async def step(name, fn):
            try: res = await fn(); R.append(('PASS', name, res))
            except Exception as e: R.append(('FAIL', name, repr(e)[:300])); traceback.print_exc()
        # --- A. conversions on open
        for f in ['sample.docx','sample.csv','sample.md','photo.png']:
            async def t(f=f): await open_file(pg, f); return f'{f} -> {await npages(pg)} page(s)'
            await step('open/convert '+f, t)
        await pg.screenshot(path='/tmp/t_docx.png')
        # --- B. combine
        async def comb():
            await pg.evaluate("window.__app.activate('combine')"); await pg.wait_for_selector('.view-tool .dropzone')
            async with pg.expect_file_chooser() as fc: await pg.click('.view-tool .dropzone')
            await (await fc.value).set_files([FX+'sample.pdf', FX+'photo.png', FX+'sample.docx'])
            await pg.wait_for_selector('.cb-card', timeout=20000); await pg.wait_for_timeout(500)
            n = await pg.locator('.cb-card').count()
            await pg.screenshot(path='/tmp/t_combine.png')
            await pg.click('.view-tool .btn-primary:has-text("Combine files")'); await pg.wait_for_selector(V+'.page canvas', timeout=20000); await pg.wait_for_timeout(500)
            return f'{n} cards -> merged {await npages(pg)} pages, name={await pg.evaluate("window.__app.activeDoc.name")}'
        await step('combine', comb)
        # --- C. organize on sample.pdf
        async def org():
            await open_file(pg, 'sample.pdf')
            await pg.click(V+'.rail-btn[data-id=organize]'); await pg.wait_for_selector('.og-card', timeout=10000); await pg.wait_for_timeout(800)
            cards = pg.locator('.og-card'); await cards.nth(0).click(); await pg.click('.og-bar button[title="Rotate right"]')
            await cards.nth(2).click(); await pg.click('.og-bar button[title^="Delete selected"]'); await pg.wait_for_timeout(500)
            await pg.screenshot(path='/tmp/t_org.png')
            await pg.click('.og-bar .btn-primary:has-text("Apply changes")'); await pg.wait_for_timeout(1500)
            n = await npages(pg); rot = await pg.evaluate("(async()=>{const p=await window.__app.activeDoc.pdf.getPage(1);return p.rotate})()")
            return f'pages={n} page1 rotate={rot}'
        await step('organize rotate+delete+apply', org)
        async def split():
            await pg.click(V+'.rail-btn[data-id=organize]'); await pg.wait_for_selector('.og-card'); 
            await pg.click('.og-bar button:has-text("Split")'); await pg.click('.modal .btn-primary:has-text("Split")')
            async with pg.expect_download() as d: pass
        # --- D. export formats from a fresh sample.pdf
        await open_file(pg, 'sample.pdf')
        await pg.click(V+'.rail-btn[data-id=export]'); await pg.wait_for_selector('.fmt')
        async def exp(fmtlabel, ext, extra=None):
            await pg.click(f'.fmt:has(strong:text-is("{fmtlabel}"))')
            if extra: await extra()
            path = await dl(pg, V+'.dv-right .btn-primary:has-text("Export")', ext); await pg.wait_for_selector('.progress', state='detached', timeout=30000); return path
        for lab, ext in [('Text','txt'),('Markdown','md'),('HTML','html'),('Word','docx'),('Excel','xlsx'),('PowerPoint','pptx')]:
            async def t(lab=lab, ext=ext):
                path = await exp(lab, ext); sz = os.path.getsize(path)
                if ext in ('docx','xlsx','pptx'): zipfile.ZipFile(path).testzip(); names = zipfile.ZipFile(path).namelist(); return f'{os.path.basename(path)} {sz}B zip ok, {len(names)} parts'
                return f'{os.path.basename(path)} {sz}B :: ' + open(path, errors="ignore").read()[:90].replace('\n',' | ')
            await step('export '+lab, t)
        async def imgs():
            async def extra():
                pass
            path = await exp('Images','zip'); z = zipfile.ZipFile(path); return f'{os.path.basename(path)} entries={z.namelist()}'
        await step('export images', imgs)
        await pg.screenshot(path='/tmp/t_export.png')
        # --- E. encrypted
        async def enc():
            await open_file(pg, 'encrypted.pdf', password='secret')
            banner = await pg.inner_text(V+'.dv-banner'); await pg.click(V+'.dv-banner .btn-primary'); await pg.click('.modal .btn-primary:has-text("Unlock copy")')
            await pg.wait_for_selector(V+'.dv-banner', state='hidden', timeout=30000); return f'banner="{banner[:60]}..." unlocked editable={await pg.evaluate("window.__app.activeDoc.editable")} pages={await npages(pg)}'
        await step('encrypted open+unlock', enc)
        # --- F. page tools + sign + redact on fresh doc
        async def tools():
            await open_file(pg, 'sample.pdf')
            await pg.click(V+'.rail-btn[data-id=tools]'); await pg.wait_for_selector('.acc')
            await pg.click('.acc:has-text("Watermark") summary'); await pg.click('.acc:has-text("Watermark") .btn-primary'); await pg.wait_for_timeout(1500)
            await pg.click('.acc:has-text("Page numbers") summary'); await pg.click('.acc:has-text("Page numbers") .btn-primary'); await pg.wait_for_timeout(1500)
            path = await dl(pg, '#btn-download', 'tools'); 
            txt = subprocess.run(['pdftotext','-f','1','-l','1',path,'-'],capture_output=True,text=True).stdout
            return f'watermark={"CONFIDENTIAL" in txt} pagenum={"Page 1 of 3" in txt}'
        await step('page tools (watermark+numbers)', tools)
        await pg.screenshot(path='/tmp/t_tools.png')
        async def red():
            await open_file(pg, 'sample.pdf'); await pg.select_option(V+'.zoom-select','100'); await pg.wait_for_timeout(700)
            box = await pg.locator(V+'.page').first.bounding_box()
            await pg.click(V+'[data-id=redact]'); await pg.mouse.move(box['x']+70, box['y']+190); await pg.mouse.down(); await pg.mouse.move(box['x']+500, box['y']+220, steps=4); await pg.mouse.up()
            await pg.click(V+'[data-id=whiteout]'); await pg.mouse.move(box['x']+70, box['y']+250); await pg.mouse.down(); await pg.mouse.move(box['x']+300, box['y']+275, steps=4); await pg.mouse.up()
            path = await dl(pg, '#btn-download', 'redact')
            txt = subprocess.run(['pdftotext','-f','1','-l','1',path,'-'],capture_output=True,text=True).stdout
            subprocess.run(['pdftoppm','-r','50','-png','-f','1','-l','1',path,'/tmp/redact'])
            return f'text after redaction contains "Line 1:"={"Line 1:" in txt} (should be False), "Line 5:"={"Line 5:" in txt}'
        await step('redact + whiteout', red)
        async def sig():
            await open_file(pg, 'sample.pdf'); await pg.select_option(V+'.zoom-select','100'); await pg.wait_for_timeout(700); await pg.click(V+'[data-id=sign]'); await pg.wait_for_selector('.sig-list')
            await pg.click('.dv-right .btn-primary:has-text("Create signature")'); await pg.click('.modal .seg button:has-text("Type")')
            await pg.fill('.modal input[type=text]', 'Chumi Test'); await pg.wait_for_timeout(300)
            await pg.click('.modal .btn-primary:has-text("Save & place")'); await pg.wait_for_timeout(300)
            await pg.wait_for_timeout(400); box = await pg.locator(V+'.page').first.bounding_box(); print('sig page box', box); await pg.mouse.click(max(box['x'],0)+200, box['y']+560); await pg.wait_for_timeout(400)
            cnt = await pg.evaluate("window.__app.activeDoc.pages[0].annots.length")
            path = await dl(pg, '#btn-download', 'sign'); return f'annots={cnt} saved {os.path.getsize(path)}B'
        await step('signature place+save', sig)
        await pg.screenshot(path='/tmp/t_sign.png')
        for r in R: print(*r)
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
