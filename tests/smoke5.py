import asyncio, json, subprocess, os
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
MOCK = json.load(open('/tmp/ocr_mock.json'))
SHIM = """
window.Tesseract = { createWorker: async (langs, oem, opts) => {
  window.__ocrLangs = langs;
  return { recognize: async (canvas) => { window.__ocrCanvas = [canvas.width, canvas.height];
      if (opts && opts.logger) { opts.logger({status:'recognizing text', progress:0.5}); }
      return { data: %s }; }, terminate: async () => {} };
} };
""" % json.dumps(MOCK)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':860}, accept_downloads=True); pg = await ctx.new_page()
        await pg.route('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=SHIM))
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'scanned.pdf'); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(900)
        await pg.click(V+'.rail-btn[data-id=ocr]'); await pg.wait_for_selector('.lang-box')
        await pg.click('.dv-right .btn-primary:has-text("Start OCR")')
        await pg.wait_for_selector(V+'.ocr-results textarea', timeout=20000); await pg.wait_for_timeout(800)
        info = await pg.evaluate("({canvas: window.__ocrCanvas, langs: window.__ocrLangs, words: window.__app.activeDoc.pages[0].ocr.words.length, first: window.__app.activeDoc.pages[0].ocr.lines[0], spans: document.querySelectorAll('.view-doc:not([hidden]) .page:first-child .textLayer span').length})")
        print('OCR result:', json.dumps(info)[:400])
        # edit text on an OCR line
        await pg.select_option(V+'.zoom-select','100'); await pg.wait_for_timeout(800)
        await pg.click(V+'[data-id=edittext]'); await pg.wait_for_timeout(900)
        n = await pg.locator(V+'.page').first.locator('.hit').count(); print('hit boxes from OCR lines:', n)
        await pg.locator(V+'.page').first.locator('.hit').nth(3).click(); await pg.wait_for_timeout(200)
        await pg.keyboard.type('Corrected line from OCR editing'); await pg.keyboard.press('Control+Enter'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/ocr_edit.png')
        async with pg.expect_download() as d: await pg.click('#btn-download')
        dd = await d.value; path='/tmp/dl/ocr_'+dd.suggested_filename; await dd.save_as(path)
        txt = subprocess.run(['pdftotext','-f','1','-l','1',path,'-'],capture_output=True,text=True).stdout
        print('searchable text present:', 'Quarterly Report' in txt and 'quick brown fox' in txt, '| first chars:', txt[:80].replace('\n',' / '))
        print('\n'.join(logs) or 'no console issues')
        await b.close()
asyncio.run(main())
