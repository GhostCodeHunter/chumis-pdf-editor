# Offline like Acrobat: load once online, go offline, reload, open a signed file (real CCA-issued sample) -> validated with the built-in trust, edit + save, print copy.
import asyncio, os, sys
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; V='.view-doc:not([hidden]) '
REAL = '/tmp/real_sig.pdf' if os.path.exists('/tmp/real_sig.pdf') else '/home/claude/chumis-pdf-editor/tests/fixtures/sig-adobe-appearance.pdf'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1366,'height':900}, accept_downloads=True); pg = await ctx.new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller", timeout=20000); await pg.wait_for_timeout(2500)
        print('cached files:', await pg.evaluate("async () => { const k = (await caches.keys()).find(x => x.startsWith('chumis-pdf-editor-')); return k ? (await (await caches.open(k)).keys()).length : 0; }"))
        await ctx.set_offline(True); logs.clear()
        await pg.reload(); await pg.wait_for_selector('#btn-open', timeout=15000); await pg.wait_for_timeout(800)
        print('reloaded offline; offline badge visible:', await pg.locator('.off-badge').is_visible(), '| online flag:', await pg.evaluate('navigator.onLine'))
        async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
        await (await fc.value).set_files(REAL); await pg.wait_for_selector(V+'.page canvas', timeout=20000); await pg.wait_for_timeout(2500)
        print('OFFLINE validation banner:', (await pg.inner_text(V+'.dv-sigbar')).split('\n')[0])
        await pg.locator(V+'.sig-badge').first.click(); await pg.wait_for_selector('.modal .sg-status'); print('OFFLINE dialog:', (await pg.inner_text('.modal .sg-lines')).replace('\n',' | ')[:420]); await pg.click('.modal button:has-text("Close")')
        await pg.click('.off-ctl button'); await pg.wait_for_selector('.off-list'); await pg.wait_for_timeout(600); print('OFFLINE panel:', (await pg.inner_text('.modal .off-list')).replace('\n',' | ')[:380]); await pg.click('.modal button:has-text("Close")')
        async with pg.expect_download() as dl: await pg.click('#btn-download')
        await (await dl.value).save_as('/tmp/t17_out.pdf'); print('saved offline:', os.path.getsize('/tmp/t17_out.pdf'), 'bytes')
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
