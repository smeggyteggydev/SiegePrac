import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__siege, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const R = window.__siege.game.renderer;
  const gl = R.renderer.getContext();
  const res = [];
  const seen = new Set();
  const check = (root, label) => root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue; seen.add(m);
      const props = R.renderer.properties.get(m);
      const prog = props.currentProgram?.program;
      if (!prog) { res.push(label + ' ' + m.type + ' NOPROG'); continue; }
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      const s = [];
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        if ([gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE].includes(info.type)) {
          const loc = gl.getUniformLocation(prog, info.name);
          s.push(info.name + ':' + ({[gl.SAMPLER_2D]:'2D',[gl.SAMPLER_2D_ARRAY]:'ARR',[gl.SAMPLER_2D_SHADOW]:'SHADOW',[gl.SAMPLER_CUBE]:'CUBE'})[info.type] + '@' + gl.getUniform(prog, loc));
        }
      }
      res.push(label + ' ' + m.type + ' ' + (m.name||'') + ' ' + s.join(' '));
    }
  });
  check(R.scene, 'scene');
  check(R.viewModel.scene, 'vm');
  return res;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
