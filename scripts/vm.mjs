import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(() => localStorage.setItem('siegeprac.settings.v2', JSON.stringify({ quality: process.env?.Q || 'medium' })));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.evaluate(() => { window.__siege.start('duel'); window.__siege.forceInput(true); });
await page.waitForTimeout(4500);
await page.screenshot({ path: 'screenshots/vm-rest.png' });
for (const [k, name] of [[0.2, 'vm-swing1'], [0.45, 'vm-swing2'], [0.75, 'vm-swing3']]) {
  await page.evaluate((k) => { const vm = window.__siege.game.renderer.viewModel; vm.debugSwing = k; }, k);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/${name}.png` });
}
await page.evaluate(() => { const vm = window.__siege.game.renderer.viewModel; vm.swingT = 1; vm.swingDur = 0.24; window.__siege.player.blocking = true; });
await browser.close();
