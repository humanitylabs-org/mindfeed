'use strict';
// Real shell + actual app controller; synthetic API only. Run via the Forum light queue.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {chromium} = require(process.env.QA_PLAYWRIGHT || 'playwright');
const {waitShell} = require('./morning-shell-ready.cjs');
// Phone acceptance uses actual trusted touch; desktop keeps mouse controls.
const press = async locator => (await locator.evaluate(() => matchMedia('(pointer: coarse)').matches)) ? locator.tap() : locator.click();
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
    if (p === '/wizard/v1/bootstrap') return json({ bootstrap: 1, endpoints: { apps: '/wizard/v1/apps' }, settings: { owner: { name: 'Synthetic QA' }, agent: { name: 'Synthetic QA' } }, capabilities: {} });
    // Established synthetic owner: {} means no authenticated provider to the
    // real Welcome.aiConnected predicate, which opens an unrelated AI setup.
    if (p === '/wizard/hermes/api/model/options') return json({ provider: 'openai-codex', providers: [{ slug: 'openai-codex', authenticated: true, auth_type: 'oauth' }] });
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
const frameSelector = 'iframe.appframe[src*="/mindfeed/"]';
async function settled(p) { if (p.url().includes('/wizard-os-home/')) receipt.trace.push({ action: 'shell settled', sample: await waitShell(p, frameSelector) }); }
async function shot(p, name) { await settled(p); const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f }); receipt.screenshots.push(f); await settled(p); }
let origin, activePage;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch({ headless: true });
  try {
    const appearanceCases = [];
    for (const mobile of [true, false]) {
      reset(); const mode = mobile ? 'phone' : 'desktop';
      const ctx = await b.newContext({ viewport: mobile ? { width: 412, height: 892 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
      await ctx.route('**/*', r => { if (new URL(r.request().url()).origin !== origin) { receipt.blockedExternal.push(r.request().url()); return r.abort(); } return r.continue(); });
      await ctx.addInitScript(() => { if (window !== parent) return; localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.skin', 'nebula'); localStorage.setItem('wos.welcome.v1', 'done'); });
      const p = await ctx.newPage(); p.on('pageerror', e => receipt.errors.push({ mode, message: e.message })); p.setDefaultTimeout(20000);
      activePage = p;
      await p.goto(origin + '/wizard-os-home/' + (mobile ? '?shell=phone' : 'desktop.html?shell=desktop'));
      await p.waitForFunction(m => m ? !!window.__wos : !!window.__wux, mobile);
      await p.evaluate(() => WizCore.appsLoaded());
      await p.waitForFunction(() => WosWelcome.log.some(x => x.startsWith('boot:')) && !WosWelcome.active);
      check(`${mode} actual shell and established-owner Welcome settled`, await p.evaluate(m => document.documentElement.dataset.shell === (m ? 'phone' : 'desktop') && !WosWelcome.active, mobile));
      await p.evaluate(m => { const a = WizCore.apps(m ? 'mobile' : 'desktop').APP.mindfeed; (m ? __wos : __wux).openApp(a); }, mobile);
      await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.includes('/mindfeed/') && f.getBoundingClientRect().height > 0));
      const fr = p.frames().find(f => f.url().includes('/mindfeed/')); assert.ok(fr);
      await fr.waitForFunction(() => window.WizardApp?.hosted);
      await settled(p);
      await fr.evaluate(() => { window.qaInputEvents = []; for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type, e => qaInputEvents.push({ type, target: e.target.closest('button')?.outerHTML, trusted: e.isTrusted, pointer: e.pointerType }), true); });
      await shot(p, mode + '-nebula-first-ready');
      const identity = await fr.evaluate(() => { window.qaDocumentIdentity = 'retained'; return location.href; });
      for (let i = 1; i <= 3; i++) { await shown(fr, `qa-${i}`, `${mode} card ${i} without extra tap`); await press(fr.locator(`[data-rate="${i === 2 ? 1 : 3}"]`)); }
      await summary(fr, `${mode} checkpoint exactly after third`);
      await shot(p, mode + '-nebula-third-checkpoint');
      await press(fr.locator('#more')); await shown(fr, 'qa-4', `${mode} Keep going opens fourth directly`);
      for (let i = 4; i <= 7; i++) { await press(fr.locator(`[data-rate="${i % 4 + 1}"]`)); await shown(fr, `qa-${i + 1}`, `${mode} finishing ${i} auto-opens ${i + 1}, no checkpoint`); }
      await shot(p, mode + '-nebula-eighth-uninterrupted');
      await fr.evaluate(() => location.reload()); await shown(fr, 'qa-8', `${mode} reload resumes eighth`); await press(fr.locator('[data-rate="3"]')); await shown(fr, 'qa-9', `${mode} reload preserves uninterrupted choice`);
      await press(fr.locator('#stop')); await summary(fr, `${mode} Stop returns to recap`);
      await fr.evaluate(() => location.reload()); await summary(fr, `${mode} stopped reload stays stopped`);
      await press(fr.locator('#more')); await shown(fr, 'qa-9', `${mode} resume keeps queued card`);
      const back = await p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find(f => f.src.includes('/mindfeed/')); return WizAppServices.back(f); });
      check(`${mode} shared Back handled`, back === 'handled'); await summary(fr, `${mode} shared Back stops optional run`);
      await press(fr.locator('#more')); await press(fr.locator('[data-rate="4"]')); await summary(fr, `${mode} real exhaustion`);
      check(`${mode} exhausted Keep going hidden`, await fr.locator('#more').isHidden());
      await press(fr.locator('[data-reopen]').first()); check(`${mode} recap reopens earlier card`, await fr.locator('#stage').isVisible());
      await press(fr.locator('[data-rate="2"]')); await summary(fr, `${mode} rerating returns to recap`);
      reset(9, '2026-11-04'); await fr.evaluate(() => location.reload());
      for (let i = 1; i <= 3; i++) { await shown(fr, `qa-${i}`, `${mode} fresh morning card ${i}`); await press(fr.locator('[data-rate="3"]')); }
      await summary(fr, `${mode} fresh morning gets checkpoint again`);
      check(`${mode} same app remains open`, fr.url() === identity);
      receipt.trace.push({ phase: `${mode} progression complete` });
      appearanceCases.push({ ctx, p, fr, mode, model: M });
    }
    reset(2); const ctx = await b.newContext({ viewport: { width: 412, height: 892 } }); const p = await ctx.newPage(); activePage = p; await p.goto(origin + '/mindfeed/');
    await shown(p, 'qa-1', 'standalone begins with dark fallback');
    check('standalone dark fallback and no host bridge', await p.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 10, 20)' && !window.WizardApp));
    await shot(p, 'standalone-dark-fallback');
    await press(p.locator('[data-rate="3"]')); await shown(p, 'qa-2', 'short pool second card automatic'); await press(p.locator('[data-rate="1"]')); await summary(p, 'short pool genuine exhaustion before goal');
    check('short pool no Keep going', await p.locator('#more').isHidden()); await ctx.close();
    receipt.trace.push({ phase: 'standalone progression complete' });
    // All card cases in every viewport finish before optional Settings navigation.
    for (const { ctx, p, fr, mode, model } of appearanceCases) {
      M = model; activePage = p;
      check(`${mode} appearance follows full progression matrix`, ['phone progression complete', 'desktop progression complete', 'standalone progression complete'].every(phase => receipt.trace.some(x => x.phase === phase)));
      receipt.trace.push({ phase: `${mode} appearance start` });
      await press(fr.locator('#more')); await shown(fr, 'qa-4', `${mode} appearance retains continuing fourth`);
      const before = await fr.evaluate(() => { window.qaDocumentIdentity = 'appearance-retained'; return { origin: performance.timeOrigin, text: getComputedStyle(document.documentElement).getPropertyValue('--wz-text').trim() }; });
      for (const skin of ['signal', 'nebula']) {
        // Appearance is a category, NOT a deep-link feature in this pinned shell.
        check(`${mode} Settings deep link accepted`, await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=settings')));
        const settings = p.locator('#settingsBody:visible');
        await press(settings.locator('[data-st-page="appearance"]:visible'));
        await settings.locator('[data-settings-feature="look"]:visible').waitFor();
        check(`${mode} real Appearance category mounted`, await settings.getAttribute('data-settings-page') === 'appearance');
        const family = await p.evaluate(skin => WosSkin.familyOf(skin), skin);
        await press(settings.locator(`[data-skinfamily="${family}"]:visible`));
        await p.waitForFunction(family => !!document.querySelector(`#settingsBody[data-settings-page="appearance"] [data-skinfamily="${family}"][aria-pressed="true"]:not(:disabled)`) && !document.querySelector('#settingsBody [aria-busy="true"]') && !window.WosExperience?.state.busy, family);
        await press(settings.locator(`[data-skinpick="${skin}"]:visible`));
        await p.waitForFunction(skin => document.documentElement.dataset.skin === skin && !!document.querySelector(`#settingsBody [data-skinpick="${skin}"][aria-pressed="true"]:not(:disabled)`) && !document.querySelector('#settingsBody [aria-busy="true"]') && !window.WosExperience?.state.busy, skin);
        await press(p.getByRole('button', { name: 'Close settings', exact: true }));
        await settings.waitFor({ state: 'hidden' }); await settled(p);
        await fr.waitForFunction(skin => document.documentElement.dataset.skin === skin && WizardApp.theme.get().skin === skin, skin);
        const after = await fr.evaluate(() => ({ retained: qaDocumentIdentity === 'appearance-retained', origin: performance.timeOrigin, card: document.querySelector('.card').dataset.id, text: getComputedStyle(document.documentElement).getPropertyValue('--wz-text').trim() }));
        check(`${mode} ${skin} live switch retains document/card`, after.retained && after.origin === before.origin && after.card === 'qa-4' && await fr.locator('#stage').isVisible());
        check(`${mode} ${skin} token transport`, !!after.text && (skin === 'signal' ? after.text !== before.text : after.text === before.text));
        await shot(p, `${mode}-${skin}-fourth-continuing`);
      }
      await ctx.close();
    }
    assert.deepEqual(receipt.trace.filter(x => x.phase).map(x => x.phase), ['phone progression complete', 'desktop progression complete', 'standalone progression complete', 'phone appearance start', 'desktop appearance start']);
    check('no page errors', receipt.errors.length === 0);
    receipt.pass = true;
  } catch (e) {
    receipt.pass = false; receipt.failure = e.stack;
    if (activePage && !activePage.isClosed()) {
      try {
        receipt.failureState = await activePage.evaluate(() => ({ welcome: window.WosWelcome?.log, welcomeActive: window.WosWelcome?.active, frames: [...document.querySelectorAll('iframe')].map(f => ({ src: f.src, rect: f.getBoundingClientRect().toJSON(), hidden: f.contentDocument?.hidden, events: f.contentWindow?.qaInputEvents, stage: f.contentDocument?.querySelector('#stage')?.outerHTML })) }));
        const f = path.join(OUT, 'REJECTED-failure.png'); await activePage.screenshot({ path: f, timeout: 5000 }); receipt.screenshots.push(f);
      } catch (diagnostic) { receipt.diagnosticError = diagnostic.message; }
    }
    throw e;
  }
  finally { fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2)); await b.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
