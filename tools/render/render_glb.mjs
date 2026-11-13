#!/usr/bin/env node
// Render a GLB into one contact-sheet PNG with headless Chrome + <model-viewer>.
//
//   node tools/render/render_glb.mjs model.glb out.png [--views front,q,side,back,head] [--label text]
//   node tools/render/render_glb.mjs rigged.glb out.png --anim list            # print animation names
//   node tools/render/render_glb.mjs rigged.glb out.png --anim walk --times 0.1,0.35,0.6,0.85 --views q,side
//
// Views: front (0°), q (35° three-quarter), side (90°), back (180°), qback (145°), head (close-up of the head).
// With --anim, every view is rendered at every time (fraction of the clip duration), one row per time.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MV = path.join(HERE, 'node_modules/@google/model-viewer/dist/model-viewer.min.js');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const [glb, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!glb || !out) {
  console.error('usage: render_glb.mjs model.glb out.png [--views front,q,side,back,head] [--anim name|list] [--times 0.25,0.5] [--label text] [--cell 360x540] [--bg #3b3b3b]');
  process.exit(2);
}
const views = opt('views', 'front,q,side,back,head').split(',');
const anim = opt('anim', '');
const times = anim && anim !== 'list' ? opt('times', '0.25,0.5,0.75').split(',').map(Number) : [null];
const [cw, ch] = opt('cell', '360x540').split('x').map(Number);
const bg = opt('bg', '#3b3b3b');
const label = opt('label', path.basename(glb));
const yawOpt = opt('yaw', 'auto');  // degrees added to every view; auto: Tripo models face +X when depth > width

const VIEW = {
  front: { theta: 0, phi: 88 },
  q: { theta: 35, phi: 82 },
  side: { theta: 90, phi: 88 },
  qback: { theta: 145, phi: 82 },
  back: { theta: 180, phi: 88 },
  head: { theta: 20, phi: 85, head: true },
};

const cells = [];
for (const t of times) for (const v of views) cells.push({ v, t });
const cols = views.length;

const html = `<!doctype html><html><head><meta charset="utf-8">
<script type="module" src="/mv.js"></script>
<style>
  body{margin:0;background:${bg};font:13px/1.3 -apple-system,Helvetica,sans-serif;color:#ddd}
  h1{font-size:14px;font-weight:600;margin:8px 10px}
  .grid{display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:4px;padding:0 6px 6px}
  .cell{position:relative;width:${cw}px;height:${ch}px;background:${bg}}
  .cell span{position:absolute;left:6px;top:4px;color:#bbb;font-size:12px;z-index:2}
  model-viewer{width:${cw}px;height:${ch}px;--poster-color:transparent;background:${bg}}
</style></head><body>
<h1 id="title">${label.replace(/</g, '&lt;')}</h1>
<div class="grid">${cells.map((c, i) => `<div class="cell"><span>${c.v}${c.t === null ? '' : ' @' + c.t}</span>
<model-viewer id="mv${i}" src="/model.glb" environment-image="neutral" tone-mapping="neutral" exposure="1.05"
 shadow-intensity="0" interaction-prompt="none" field-of-view="28deg" min-field-of-view="10deg" max-field-of-view="45deg"></model-viewer></div>`).join('')}
</div>
<script type="module">
const cells = ${JSON.stringify(cells)}, VIEW = ${JSON.stringify(VIEW)}, ANIM = ${JSON.stringify(anim)}, YAW = ${JSON.stringify(yawOpt)};
await customElements.whenDefined('model-viewer');
const mvs = cells.map((_, i) => document.getElementById('mv' + i));
await Promise.all(mvs.map(mv => mv.loaded ? 0 : new Promise((ok, bad) => {
  mv.addEventListener('load', ok, { once: true });
  mv.addEventListener('error', e => bad(new Error('load error: ' + JSON.stringify(e.detail))), { once: true });
})));
const d0 = mvs[0].getDimensions();
const yaw = YAW === 'auto' ? (d0.z > d0.x * 1.15 ? 90 : 0) : Number(YAW);
const info = { animations: mvs[0].availableAnimations, dims: d0, center: mvs[0].getBoundingBoxCenter(), yaw };
window.__info = JSON.parse(JSON.stringify(info));
if (ANIM === 'list') { window.__ready = true; } else {
  for (let i = 0; i < mvs.length; i++) {
    const mv = mvs[i], c = cells[i], v = VIEW[c.v];
    if (ANIM) {
      const name = mv.availableAnimations.find(n => n === ANIM) || mv.availableAnimations.find(n => n.toLowerCase().includes(ANIM.toLowerCase()));
      if (!name) throw new Error('animation not found: ' + ANIM + ' in ' + mv.availableAnimations.join(', '));
      mv.animationName = name;
      await mv.updateComplete;
      mv.play(); mv.pause();
      mv.currentTime = c.t * (mv.duration || 1);
    }
    const d = mv.getDimensions(), ctr = mv.getBoundingBoxCenter();
    const fov = 28 * Math.PI / 180, aspect = ${cw} / ${ch};
    let target, radius;
    if (v.head) {
      const top = ctr.y + d.y / 2, hh = d.y * 0.16;
      target = { x: ctr.x, y: top - hh * 0.55, z: ctr.z };
      radius = (hh / 2) / Math.tan(fov / 2) * 1.25;
    } else {
      const fitH = (d.y / 2) / Math.tan(fov / 2);
      const fitW = (Math.max(d.x, d.z) / 2) / (Math.tan(fov / 2) * aspect);  // widest horizontal extent, any view
      target = ctr; radius = Math.max(fitH, fitW) * 1.08 + Math.max(d.x, d.z) / 2;
    }
    mv.cameraTarget = target.x + 'm ' + target.y + 'm ' + target.z + 'm';
    mv.cameraOrbit = (v.theta + yaw) + 'deg ' + v.phi + 'deg ' + radius + 'm';
    mv.jumpCameraToGoal();
  }
  await Promise.all(mvs.map(mv => mv.updateComplete));
  await new Promise(r => setTimeout(r, 600));
  window.__ready = true;
}
</script></body></html>`;

const glbPath = path.resolve(glb);
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  if (url === '/mv.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return fs.createReadStream(MV).pipe(res); }
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/model.glb') { res.writeHead(200, { 'content-type': 'model/gltf-binary' }); return fs.createReadStream(glbPath).pipe(res); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=metal', '--hide-scrollbars'],
});
let code = 0;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 12 + cols * (cw + 4), height: 40 + Math.ceil(cells.length / cols) * (ch + 4), deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__ready === true', { timeout: 240000, polling: 250 });
  } catch (e) {
    throw new Error('render timed out' + (errors.length ? ': ' + errors.join(' | ') : ''));
  }
  const info = await page.evaluate('window.__info');
  const d = info.dims;
  console.log(JSON.stringify({ glb: path.basename(glb), animations: info.animations, size: [d.x, d.y, d.z].map(n => +n.toFixed(3)), yaw: info.yaw }));
  if (anim !== 'list') {
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved ' + out);
  }
  if (errors.length) console.error('page errors: ' + errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error('ERROR: ' + e.message);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
