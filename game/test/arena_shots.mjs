#!/usr/bin/env node
// Renders the arena test bench in headless Chrome and saves named shots to test/shots/.
//   node test/arena_shots.mjs [--only entrance,mid] [--notex] [--q high|medium|low] [--bench]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from '../../tools/render/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { startServer } from '../serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const only = opt('only', '') ? opt('only', '').split(',') : null;
const W = 1600, H = 900;

const SHOTS = [
  { name: 'entrance', cam: 'entrance', phase: 0, settle: 3.5 },
  { name: 'mid', cam: 'mid', phase: 1, settle: 3.5 },
  { name: 'altar', cam: 'altar', phase: 1, settle: 3.5 },
  { name: 'phase2', cam: 'entrance', phase: 2, settle: 4.0 },
  { name: 'victory', cam: 'entrance', phase: 3, settle: 4.5 },
  {
    // low over the water near the heroine, where the rose window is mirrored: rings must read
    name: 'ripples', cam: 'ripples', phase: 1, settle: 3.0,
    ripples: [[0.3, 33.6, 1.0, 0.0], [-0.9, 34.6, 0.8, 0.3], [1.1, 35.2, 1.0, 0.6], [-0.2, 36.4, 0.7, 0.95], [0.7, 32.4, 1.2, 1.25], [-1.3, 33.0, 1.0, 1.5]],
  },
  { name: 'gameplay', cam: 'gameplay', phase: 1, settle: 3.5, ripples: [[0.4, -7.5, 1.0, 0.0], [0.6, -7.2, 0.6, 0.45], [0.2, -7.8, 0.8, 0.9]] },
  { name: 'lowangle', cam: 'lowangle', phase: 0, settle: 3.5 },
  { name: 'third', cam: 'third', phase: 1, settle: 3.5, extra: true },
  { name: 'aisle', cam: 'aisle', phase: 1, settle: 3.5, extra: true },
  { name: 'side', cam: 'side', phase: 1, settle: 3.5, extra: true },
];

fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
const port = server.address().port;
const query = ['shots=1', args.includes('--notex') ? 'notex=1' : '', opt('q', '') ? 'q=' + opt('q', '') : '', opt('param', '')].filter(Boolean).join('&');
const OUTNAME = (n) => (opt('suffix', '') ? `${n}_${opt('suffix', '')}` : n);
const url = `http://127.0.0.1:${port}/test/arena_test.html?${query}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-webgl', '--hide-scrollbars', `--window-size=${W},${H}`],
});
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || t === 'warn') logs.push(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || (window.__errors && window.__errors.length > 0)', { timeout: 120000 });
  const errs = await page.evaluate(() => window.__errors);
  if (errs.length) throw new Error('page errors: ' + errs.join('\n'));
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log('GPU:', gpu, ' build ms:', await page.evaluate(() => window.__buildMs.toFixed(0)));

  for (const s of SHOTS) {
    if (only ? !only.includes(s.name) : s.extra) continue;
    const info = await page.evaluate(async (s) => {
      window.__setCam(s.cam);
      window.__setPhase(s.phase);
      window.__step(s.settle);
      if (s.ripples) {
        let t = 0;
        for (const [x, z, k, at] of s.ripples) { window.__step(Math.max(1 / 60, at - t)); t = at; window.__ripple(x, z, k); }
        window.__step(0.55);
      }
      const i = window.__render();
      await new Promise((r) => requestAnimationFrame(() => r()));
      return i;
    }, s);
    const file = path.join(OUT, `${OUTNAME(s.name)}.png`);
    await page.screenshot({ path: file });
    console.log(`${s.name.padEnd(9)} -> ${path.relative(process.cwd(), file)}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  programs ${info.programs}`);
  }

  if (args.includes('--bench')) {
    for (const [w, h] of [[1600, 900], [1920, 1080]]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      const r = await page.evaluate(async (w, h) => {
        window.__resize(w, h);
        window.__setCam('third');
        window.__setPhase(1);
        window.__step(3);
        return window.__bench(150);
      }, w, h);
      console.log(`bench ${w}x${h}: ${r.msPerFrame.toFixed(2)} ms/frame pipelined, ${r.msSynced.toFixed(2)} ms synced  (calls ${r.calls}, tris ${(r.triangles / 1000).toFixed(0)}k)`);
      const r2 = await page.evaluate(async () => { window.__setCam('entrance'); window.__setPhase(2); window.__step(3); return window.__bench(150); });
      console.log(`bench ${w}x${h} entrance/phase2: ${r2.msPerFrame.toFixed(2)} ms/frame pipelined, ${r2.msSynced.toFixed(2)} ms synced`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (logs.length) {
  console.log(`\nconsole (${logs.length}):`);
  for (const l of [...new Set(logs)].slice(0, 40)) console.log('  ' + l);
} else {
  console.log('\nconsole: clean');
}
