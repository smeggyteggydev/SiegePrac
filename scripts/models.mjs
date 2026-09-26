import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(() => localStorage.setItem('siegeprac.settings.v2', JSON.stringify({ quality: 'medium', motionBlur: 0 })));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.evaluate(() => { window.__siege.start('combo'); window.__siege.forceInput(true); });
await page.waitForTimeout(3000);
const place = async (swing, name, extra = '') => {
  await page.evaluate(([swing, extra]) => {
    const s = window.__siege; const p = s.player, b = s.bot;
    b.pos.set(p.pos.x, p.pos.y, p.pos.z + 2.6); b.prevPos.copy(b.pos); b.vel.set(0, 0, 0);
    b.yaw = b.prevYaw = Math.PI; // face the player... (player looks +z)
    s.game.botBrain.behavior = 'idle';
    s.game.input.setLook(Math.PI, -0.15);
    if (swing) { b.swingTime = swing; }
    if (extra === 'block') b.blocking = true;
    if (extra === 'hurt') b.hitstun = 0.3;
  }, [swing, extra]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `screenshots/${name}.png` });
};
await place(0, 'm-idle');
await place(0.1, 'm-swing');
await place(0, 'm-hurt', 'hurt');
await browser.close();
