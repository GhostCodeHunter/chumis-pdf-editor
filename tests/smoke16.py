# Revocation from information carried in the file (DSS): good -> VALID with a revocation line; revoked -> INVALID. Certified-document trust.
import asyncio
from playwright.async_api import async_playwright
URL='http://127.0.0.1:8765/app.html'; FX='/home/claude/chumis-pdf-editor/tests/fixtures/'; V='.view-doc:not([hidden]) '
async def run(pg, name):
    async with pg.expect_file_chooser() as fc: await pg.click('#btn-open')
    await (await fc.value).set_files(FX+name); await pg.wait_for_selector(V+'.page canvas'); await pg.wait_for_timeout(1500)
    await pg.click(V+'.rail-btn[data-id=signatures]'); await pg.wait_for_selector(V+'.sg-card')
    if 'Trust' not in (await pg.inner_text(V+'.dv-sigbar')):
        pass
    async with pg.expect_file_chooser() as fc: await pg.click(V+'.dv-right button:has-text("Import certificate")')
    await (await fc.value).set_files(FX+'rev-root.pem'); await pg.wait_for_selector('.modal button:has-text("Trust certificate")'); await pg.click('.modal button:has-text("Trust certificate")'); await pg.wait_for_timeout(2500)
    print(name, '->', (await pg.inner_text(V+'.dv-sigbar')).split('\n')[0])
    await pg.click(V+'.sg-card button:has-text("Validate")'); await pg.wait_for_selector('.modal .sg-status'); print('   ', (await pg.inner_text('.modal .sg-lines')).replace('\n',' | ')[:520]); await pg.click('.modal button:has-text("Close")'); await pg.wait_for_timeout(200)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width':1366,'height':900})).new_page()
        logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None); pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        await run(pg, 'rev-good.pdf'); await run(pg, 'rev-bad.pdf')
        print('\n'.join(logs) or 'no console issues'); await b.close()
asyncio.run(main())
