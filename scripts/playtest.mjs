// Automated playtest: launches the built game in headless Chromium, drives it,
// and captures screenshots + console errors + perf.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;

const url = process.env.URL || 'http://localhost:4173/';
const out = process.env.OUT || 'screenshots';
const steps = (process.env.STEPS || 'menu,duel').split(',');

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };

if (steps.includes('menu')) {
  await shot('01-menu');
  await page.click('.main-nav >> text=PLAY');
  await page.waitForTimeout(1200);
  await shot('02-modes');
  await page.click('.screen-head .back');
  await page.click('.main-nav >> text=LOADOUT');
  await page.waitForTimeout(1200);
  await shot('03-loadout');
  await page.click('.loadout-screen .back');
  await page.click('.main-nav >> text=SETTINGS');
  await page.waitForTimeout(1200);
  await shot('04-settings');
  await page.click('.settings-screen .back');
}
if (steps.includes('duel')) {
  await page.evaluate(() => { window.__siege.start('duel'); window.__siege.forceInput(true); });
  await page.waitForTimeout(3500);
  await shot('05-duel-start');
  // walk forward and fight: hold W, click periodically, aim at the bot.
  await page.evaluate(() => {
    const s = window.__siege;
    window.__aim = setInterval(() => {
      const p = s.player, b = s.bot;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z, dy = (b.pos.y + 1.1) - (p.pos.y + 1.62);
      s.game.input.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    }, 16);
  });
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 40; i++) {
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(90);
    if (i === 20) await shot('06-duel-fight');
  }
  await page.keyboard.up('KeyW');
  await shot('07-duel-after');
  const st = await page.evaluate(() => ({ ...window.__siege.state(), p: window.__siege.player.stats, b: window.__siege.bot.stats, ph: window.__siege.player.health, bh: window.__siege.bot.health }));
  console.log(JSON.stringify(st));
  await page.evaluate(() => clearInterval(window.__aim));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
  await shot('08-inventory');
  await page.keyboard.press('KeyE');
  await page.evaluate(() => { const g = window.__siege.game; g.camRig.thirdPerson = true; const p = g.player, b = g.bot; b.pos.set(p.pos.x + 1.5, p.pos.y, p.pos.z - 3); b.prevPos.copy(b.pos); });
  await page.waitForTimeout(1500);
  await shot('09-third-person');
}
console.log('ERRORS:\n' + errors.slice(0, 30).join('\n'));
await browser.close();
