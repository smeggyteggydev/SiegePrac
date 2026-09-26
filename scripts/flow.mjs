// Fast flow check at tiny resolution + low quality so software GL keeps up.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) errs.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('siegeprac.settings.v2', JSON.stringify({ quality: 'low' })));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.evaluate(() => { window.__siege.start('duel'); window.__siege.forceInput(true); });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  console.log(JSON.stringify(await page.evaluate(() => ({ ...window.__siege.state(), t: window.__siege.sim.time.toFixed(1) }))));
}
console.log('errors', errs);
await browser.close();
