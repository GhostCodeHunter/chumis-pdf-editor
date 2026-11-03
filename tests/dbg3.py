import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width':1300,'height':800})).new_page()
        pg.on('console', lambda m: print('[console]', m.type, m.text)); pg.on('pageerror', lambda e: print('[pageerror]', e))
        await pg.goto('http://127.0.0.1:8765/app.html'); await pg.wait_for_timeout(300)
        print(await pg.evaluate("[PDFLib.PDFTextField.name, PDFLib.PDFSignature.name, PDFLib.PDFCheckBox.name]"))
        await b.close()
asyncio.run(main())
