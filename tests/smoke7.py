import asyncio, json
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:8765/'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1280,'height':800}); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(BASE+'app.html'); await pg.evaluate("navigator.serviceWorker.ready.then(()=>true)"); await pg.wait_for_timeout(2500)
        info = await pg.evaluate("""(async()=>{ const keys = await caches.keys(); const c = await caches.open(keys[0]); const reqs = await c.keys();
            const m = await (await fetch('manifest.webmanifest')).json();
            return {cache: keys, cached: reqs.length, hasPdfjs: reqs.some(r=>r.url.includes('pdf.worker.min.mjs')), manifest: {name:m.name, display:m.display, icons:m.icons.length, fileHandlers: !!m.file_handlers, scope:m.scope, start:m.start_url}} })()""")
        print(json.dumps(info))
        # go offline and reload: app must still load and open a PDF
        await ctx.set_offline(True); await pg.reload(); await pg.wait_for_selector('#btn-open', timeout=15000)
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(FX+'sample.pdf'); await pg.wait_for_selector('.view-doc:not([hidden]) .page canvas', timeout=20000)
        print('OFFLINE: app loaded and rendered a PDF; pages =', await pg.evaluate('window.__app.activeDoc.numPages'))
        # landing offline too
        await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(500); print('OFFLINE: landing title =', await pg.title())
        print('\n'.join(logs) or 'no console errors')
        await b.close()
asyncio.run(main())
