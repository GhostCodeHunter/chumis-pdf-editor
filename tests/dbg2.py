import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width':1300,'height':800})).new_page()
        pg.on('console', lambda m: print('[console]', m.type, m.text)); pg.on('pageerror', lambda e: print('[pageerror]', e))
        await pg.goto('http://127.0.0.1:8765/app.html'); await pg.wait_for_timeout(300)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files('/home/claude/chumis-pdf-editor/tests/fixtures/gst-signed.pdf'); await pg.wait_for_timeout(3000)
        print(await pg.evaluate("""(async()=>{const d=window.__app.activeDoc; const page=await d.pdf.getPage(1); const an=await page.getAnnotations();
          const lib = await PDFLib.PDFDocument.load(d.originalBytes,{updateMetadata:false}); const fields = lib.getForm().getFields().map(f=>[f.getName(), f instanceof PDFLib.PDFSignature]);
          return JSON.stringify({annots:an.map(a=>({st:a.subtype,ft:a.fieldType,name:a.fieldName,rect:a.rect})), fields, sig0: d.sigs[0].widget, br: d.sigs[0].byteRange})})()"""))
        await b.close()
asyncio.run(main())
