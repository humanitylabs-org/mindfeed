'use strict';
// Real shell + actual app controller; synthetic API only. Run via the Forum light queue.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const SHELL = path.resolve(process.env.QA_SHELL_ROOT), WEB = path.resolve(process.env.MINDFEED_WEB_ROOT || path.join(__dirname, '../app/web'));
const OUT = path.resolve(process.env.QA_OUT || 'browser-results'); fs.mkdirSync(OUT, { recursive: true });
const receipt = { source: process.env.QA_SHA, synthetic: true, trace: [], checks: [], assetHashes: {}, errors: [], blockedExternal: [], refusedShellWrites: [], screenshots: [] };
let M;
function reset(total = 9, day = '2026-11-03') { M = { day, cards: Array.from({ length: total }, (_, i) => ({ id: `qa-${i + 1}`, title: `Synthetic idea ${i + 1}`, text: 'This is a synthetic MindFeed card.\n\nMake room for a thought to meet your experience.', source: 'own', source_label: 'QA fixture', attribution: 'Synthetic data — no personal progress' })), count: Math.min(3, total) }; }
function view() { const cards = M.cards.slice(0, M.count), rated = cards.filter(c => c.rating).length; return { day: M.day, cards, rated, goal: 3, done: rated >= 3, more_available: M.cards.length - M.count, pool: { total: M.cards.length, by_source: { 'QA fixture': M.cards.length } } }; }
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://fixture'), p = u.pathname;
  const send = (body, ct = 'application/json', status = 200) => { res.writeHead(status, { 'content-type': ct, 'cache-control': 'no-store' }); res.end(body); };
  const json = b => send(JSON.stringify(b));
  if (p.startsWith('/mindfeed/api/')) {
    let data = ''; for await (const b of req) data += b;
    if (p.endsWith('/rate')) { const b = JSON.parse(data); assert.ok([1,2,3,4].includes(b.r)); const c = M.cards.slice(0, M.count).find(c => c.id === b.id); assert.ok(c); c.rating = b.r; }
    else if (p.endsWith('/more')) M.count = Math.min(M.count + 1, M.cards.length);
    else assert.ok(p.endsWith('/today') || p.endsWith('/status'));
    receipt.trace.push({ request: p, method: req.method, rated: view().rated, allocated: M.count }); return json(view());
  }
  if (p.startsWith('/wizard/')) {
    if (!['GET','HEAD'].includes(req.method)) { receipt.refusedShellWrites.push({ method: req.method, path: p }); return send('{}', 'application/json', 403); }
    if (p === '/wizard/v1/apps') return json({ apps: [{ id: 'mindfeed', name: 'MindFeed', url: '/mindfeed/', colors: ['#b69cff', '#b69cff'] }] });
    if (p === '/wizard/v1/bootstrap') return json({ bootstrap: 1, endpoints: { apps: '/wizard/v1/apps' }, settings: { owner: { name: 'Synthetic QA' }, agent: { name: 'Wizard' } }, capabilities: {} });
    if (p === '/wizard/v1/setup') return json({ first_run: false, items: [] });
    if (p === '/wizard/hermes/api/sessions') return json({ data: [], has_more: false });
    if (p.endsWith('/thread-seen')) return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (p.endsWith('/thread-dispositions')) return json({ state: {} });
    return json({});
  }
  if (p.endsWith('/sw.js')) return send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));", 'application/javascript');
  let root, rel;
  if (p.startsWith('/mindfeed/')) { root = WEB; rel = p.slice('/mindfeed/'.length) || 'index.html'; }
  else if (p.startsWith('/wizard-os-home/')) { root = path.join(SHELL, 'web'); rel = p.slice('/wizard-os-home/'.length) || 'index.html'; }
  else return send('', 'text/plain', 404);
  const file = path.resolve(root, rel); if (!file.startsWith(root + path.sep)) return send('', 'text/plain', 403);
  if (['data.js','summaries.js'].includes(rel) && root !== WEB) return send('', 'application/javascript');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send('', 'text/plain', 404);
  const body = fs.readFileSync(file); receipt.assetHashes[p] = crypto.createHash('sha256').update(body).digest('hex');
  return send(body, types[path.extname(file)] || 'application/octet-stream');
});
function check(name, value) { receipt.checks.push({ name, pass: !!value }); assert.ok(value, name); console.log('PASS', name); }
async function shown(fr, id, label) { await fr.waitForFunction(id => !document.querySelector('#stage').hidden && document.querySelector('#stage .card')?.dataset.id === id, id); receipt.trace.push({ action: label, visible: id }); check(label, true); }
async function summary(fr, label) { await fr.waitForFunction(() => !document.querySelector('#done').hidden); receipt.trace.push({ action: label, visible: 'checkpoint', rated: view().rated }); check(label, true); }
async function shot(p, name) { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f, animations: 'disabled' }); receipt.screenshots.push(f); }
let origin;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch({ headless: true });
  try {
    for (const mobile of [true, false]) {
      reset(); const mode = mobile ? 'phone' : 'desktop';
      const ctx = await b.newContext({ viewport: mobile ? { width: 412, height: 892 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
      await ctx.route('**/*', r => { if (new URL(r.request().url()).origin !== origin) { receipt.blockedExternal.push(r.request().url()); return r.abort(); } return r.continue(); });
      await ctx.addInitScript(() => { if (window !== parent) return; localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.skin', 'nebula'); });
      const p = await ctx.newPage(); p.on('pageerror', e => receipt.errors.push({ mode, message: e.message })); p.setDefaultTimeout(20000);
      await p.goto(origin + '/wizard-os-home/' + (mobile ? '?shell=phone' : 'desktop.html?shell=desktop'));
      await p.waitForFunction(m => m ? !!window.__wos : !!window.__wux, mobile);
      await p.evaluate(() => WizCore.appsLoaded());
      await p.evaluate(m => { const a = WizCore.apps(m ? 'mobile' : 'desktop').APP.mindfeed; (m ? __wos : __wux).openApp(a); }, mobile);
      await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.includes('/mindfeed/') && f.getBoundingClientRect().height > 0));
      const fr = p.frames().find(f => f.url().includes('/mindfeed/')); assert.ok(fr);
      await fr.waitForFunction(() => window.WizardApp?.hosted);
      const identity = await fr.evaluate(() => { window.qaDocumentIdentity = 'retained'; return location.href; });
      for (let i = 1; i <= 3; i++) { await shown(fr, `qa-${i}`, `${mode} card ${i} without extra tap`); await fr.locator(`[data-rate="${i === 2 ? 1 : 3}"]`).click(); }
      await summary(fr, `${mode} checkpoint exactly after third`);
      await shot(p, mode + '-nebula-third-checkpoint');
      await fr.locator('#more').click(); await shown(fr, 'qa-4', `${mode} Keep going opens fourth directly`);
      await p.evaluate(() => WosSkin.preview(WosSkin.index('signal')));
      await fr.waitForFunction(() => document.documentElement.dataset.skin === 'signal');
      check(`${mode} live skin change retains document/card`, await fr.evaluate(() => qaDocumentIdentity === 'retained' && document.querySelector('.card').dataset.id === 'qa-4'));
      check(`${mode} Signal token transport`, await fr.evaluate(() => !!document.documentElement.style.getPropertyValue('--wz-text') && WizardApp.theme.get().skin === 'signal'));
      await shot(p, mode + '-signal-fourth-continuing');
      for (let i = 4; i <= 7; i++) { await fr.locator(`[data-rate="${i % 4 + 1}"]`).click(); await shown(fr, `qa-${i + 1}`, `${mode} finishing ${i} auto-opens ${i + 1}, no checkpoint`); }
      await shot(p, mode + '-signal-eighth-uninterrupted');
      await fr.evaluate(() => location.reload()); await shown(fr, 'qa-8', `${mode} reload resumes eighth`); await fr.locator('[data-rate="3"]').click(); await shown(fr, 'qa-9', `${mode} reload preserves uninterrupted choice`);
      await fr.locator('#stop').click(); await summary(fr, `${mode} Stop returns to recap`);
      await fr.evaluate(() => location.reload()); await summary(fr, `${mode} stopped reload stays stopped`);
      await fr.locator('#more').click(); await shown(fr, 'qa-9', `${mode} resume keeps queued card`);
      const back = await p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find(f => f.src.includes('/mindfeed/')); return WizAppServices.back(f); });
      check(`${mode} shared Back handled`, back === 'handled'); await summary(fr, `${mode} shared Back stops optional run`);
      await fr.locator('#more').click(); await fr.locator('[data-rate="4"]').click(); await summary(fr, `${mode} real exhaustion`);
      check(`${mode} exhausted Keep going hidden`, await fr.locator('#more').isHidden());
      await fr.locator('[data-reopen]').first().click(); check(`${mode} recap reopens earlier card`, await fr.locator('#stage').isVisible());
      await fr.locator('[data-rate="2"]').click(); await summary(fr, `${mode} rerating returns to recap`);
      reset(9, '2026-11-04'); await fr.evaluate(() => location.reload());
      for (let i = 1; i <= 3; i++) { await shown(fr, `qa-${i}`, `${mode} fresh morning card ${i}`); await fr.locator('[data-rate="3"]').click(); }
      await summary(fr, `${mode} fresh morning gets checkpoint again`);
      check(`${mode} same app remains open`, fr.url() === identity);
      await ctx.close();
    }
    reset(2); const ctx = await b.newContext({ viewport: { width: 412, height: 892 } }); const p = await ctx.newPage(); await p.goto(origin + '/mindfeed/');
    await shown(p, 'qa-1', 'standalone begins with dark fallback');
    check('standalone dark fallback and no host bridge', await p.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 10, 20)' && !window.WizardApp));
    await shot(p, 'standalone-dark-fallback');
    await p.locator('[data-rate="3"]').click(); await shown(p, 'qa-2', 'short pool second card automatic'); await p.locator('[data-rate="1"]').click(); await summary(p, 'short pool genuine exhaustion before goal');
    check('short pool no Keep going', await p.locator('#more').isHidden()); await ctx.close();
    check('no page errors', receipt.errors.length === 0);
    receipt.pass = true;
  } catch (e) { receipt.pass = false; receipt.failure = e.stack; throw e; }
  finally { fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2)); await b.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
