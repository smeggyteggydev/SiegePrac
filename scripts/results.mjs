import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('siegeprac.settings.v1', JSON.stringify({ quality: 'low', firstTo: 3 })));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.evaluate(() => { window.__siege.start('duel'); window.__siege.forceInput(true); });
for (let r = 0; r < 3; r++) {
  await page.waitForFunction(() => window.__siege.state().phase === 'fight', null, { timeout: 90000 });
  await page.evaluate(() => { const s = window.__siege; s.player.stats.hits += 4; s.sim.kill(s.bot, s.player, 'combat'); });
  if (r === 0) { await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/r-kill.png' }); }
}
await page.waitForFunction(() => window.__siege.state().phase === 'results', null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/r-results.png' });
console.log(JSON.stringify(await page.evaluate(() => window.__siege.state())), errs);
await page.keyboard.press('KeyR');
await page.waitForTimeout(1000);
console.log(JSON.stringify(await page.evaluate(() => window.__siege.state())));
await browser.close();
