import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(() => localStorage.setItem('siegeprac.settings.v2', JSON.stringify({ quality: 'medium', motionBlur: 0.3 })));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.evaluate(() => { window.__siege.start('combo'); window.__siege.forceInput(true); });
await page.waitForFunction(() => window.__siege.state().phase === 'fight', null, { timeout: 60000 });
for (let k = 0; k < 3; k++) {
  await page.evaluate(() => {
    const s = window.__siege; const p = s.player, b = s.bot;
    b.pos.set(p.pos.x, p.pos.y, p.pos.z + 2.4); b.prevPos.copy(b.pos); b.vel.set(0, 0, 0); b.hurtTimer = 0;
    s.game.input.setLook(Math.PI, -0.25);
  });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(120);
  await page.screenshot({ path: `screenshots/fight-${k}.png` });
  await page.waitForTimeout(400);
}
console.log(await page.evaluate(() => JSON.stringify(window.__siege.player.stats)));
await browser.close();
