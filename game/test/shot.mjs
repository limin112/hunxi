#!/usr/bin/env node
// Screenshot a test page:  node test/shot.mjs "<page path with query>" out.png [width] [height]
//   node test/shot.mjs "test/pose_test.html?char=heroine&move=light1&times=0,0.13,0.22,0.3" /tmp/x.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';

const require = (await import('node:module')).createRequire(import.meta.url);
const puppeteer = require('../../tools/render/node_modules/puppeteer-core');
const [page_, out, W = '1600', Hh = '900'] = process.argv.slice(2);
const server = await startServer(0);
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
let code = 0;
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.setViewport({ width: +W, height: +Hh });
  await page.goto(`http://127.0.0.1:${port}/${page_}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || window.__error', { timeout: +(process.env.SHOT_TIMEOUT || 60000), polling: 200 });
  const info = await page.evaluate('window.__info || window.__error || null');
  if (info) console.log(JSON.stringify(info));
  await page.screenshot({ path: out, fullPage: true });
  console.log('saved ' + out);
  if (errors.length) console.log('console: ' + errors.slice(0, 8).join('\n  '));
} catch (e) {
  console.error('ERROR ' + e.message); code = 1;
  if (typeof errors !== 'undefined' && errors.length) console.error('console: ' + errors.slice(0, 12).join('\n  '));
} finally {
  await browser.close(); server.close();
}
process.exit(code);
void path; void fileURLToPath;
