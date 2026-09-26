import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
let count = 0;
page.on('console', (m) => { if (m.text().includes('Mismatch')) count++; });
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log('baseline mismatches', count);
const variant = process.argv[2];
await page.evaluate((v) => {
  const g = window.__siege.game;
  const R = g.renderer;
  if (v === 'noshadow') { R.renderer.shadowMap.enabled = false; R.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  if (v === 'noworld') R.world.group.visible = false;
  if (v === 'nowater') R.water.mesh.visible = false;
  if (v === 'nodecor') R.decor.group.visible = false;
  if (v === 'noparticles') { R.particles.mesh.visible = false; R.particles.glowMesh.visible = false; }
}, variant);
await page.waitForTimeout(500);
count = 0;
await page.waitForTimeout(1500);
console.log(variant, 'mismatches after', count);
await page.screenshot({ path: `screenshots/dbg-${variant}.png` });
await browser.close();
