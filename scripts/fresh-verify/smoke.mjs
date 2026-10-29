// Fresh-shell production smoke test: real Chromium over dist/.
// Run: npm run build first, then `node scripts/fresh-verify/smoke.mjs`
// (requires puppeteer-core available to node and a Chrome/Chromium
// binary — set SMOKE_CHROME to its path if the default is absent).
// Desktop Chromium cannot validate the iOS audio unlock itself;
// everything around it (render, flow, controls, locks) is checked.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const CHROME = process.env.SMOKE_CHROME ?? '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const data = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('consoleerror', e => pageErrors.push('console: ' + e.text()));
// Grant geolocation (San Diego) so the landing can locate.
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(`http://127.0.0.1:${port}`, ['geolocation']);
await page.setGeolocation({ latitude: 32.853, longitude: -117.18 });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2', timeout: 30_000 });
await new Promise(r => setTimeout(r, 1500));
const landingText = await page.evaluate(() => document.body.innerText);
check('landing renders with product title', /^Miles$/m.test(landingText) || /Miles/.test(landingText));
check('landing shows the companion', /Miles/.test(landingText));
const startFound = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => /start tour/i.test(x.textContent ?? ''));
  if (b) { b.click(); return true; }
  return false;
});
check('START TOUR button present and clicked', startFound);
await new Promise(r => setTimeout(r, 2500));
const tourText = await page.evaluate(() => document.body.innerText);
check('tour view entered after START', /End tour|Pause|Skip/i.test(tourText), tourText.slice(0, 120).replace(/\n/g, ' '));
const skipAria = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /skip/i.test(b.getAttribute('aria-label') ?? '')));
check('transport controls present', /Pause/i.test(tourText) && skipAria);
// Q&A: type a question and send; the input must lock while a cycle runs.
const qa = await page.evaluate(() => {
  const input = document.querySelector('input[type="text"], input:not([type])');
  if (!input) return { found: false };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'What is this place?');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const form = input.closest('form');
  if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { found: true };
});
check('Q&A text input present and submittable', qa.found);
await new Promise(r => setTimeout(r, 1200));
const locked = await page.evaluate(() => {
  const input = document.querySelector('input[type="text"], input:not([type])');
  return input ? input.disabled : null;
});
check('Q&A input locks while the answer cycle runs', locked === true, `disabled=${locked}`);
// Diagnostics: expand the panel; build id + variant must read fresh.
await page.evaluate(() => { [...document.querySelectorAll('button')].find(x => /diagnostics/i.test(x.textContent ?? ''))?.click(); });
await new Promise(r => setTimeout(r, 600));
const diagText = await page.evaluate(() => document.body.innerText);
check('diagnostics show fresh build id', /fresh-/.test(diagText));
check('diagnostics show variant fresh', /variant:\s*fresh/.test(diagText));
// End tour round-trips to the landing.
const ended = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /end tour/i.test(x.textContent ?? ''));
  if (b) { b.click(); return true; }
  return false;
});
check('End tour button works', ended);
await new Promise(r => setTimeout(r, 1500));
const backText = await page.evaluate(() => document.body.innerText);
check('returns to landing after End tour', /Miles/.test(backText) && /start tour/i.test(backText));
check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\nSMOKE: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
