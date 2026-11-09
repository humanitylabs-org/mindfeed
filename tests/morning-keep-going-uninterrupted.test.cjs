'use strict';
// James's correction: first three flow automatically; Keep going never asks per card.
// Execute the actual UI controller, with synthetic API data and a minimal DOM seam.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.MINDFEED_APP_JS || require('node:path').join(__dirname, '../app/web/app.js'), 'utf8');
function model(total = 9) {
  const cards = Array.from({ length: total }, (_, i) => ({ id: `qa-${i + 1}`, title: `Synthetic idea ${i + 1}`, text: 'A synthetic thought for testing.', source: 'own' }));
  return { day: '2026-11-03', count: Math.min(3, total), cards, requests: [], failMore: false, failRate: false,
    view() { const picked = cards.slice(0, this.count); const rated = picked.filter(c => c.rating).length; return { day: this.day, cards: structuredClone(picked), rated, goal: 3, done: rated >= 3, more_available: cards.length - this.count, pool: { total: cards.length, by_source: {} } }; } };
}
async function boot(m, saved = new Map(), blockedStorage = false) {
  const els = new Map(), handlers = {}, requests = m.requests;
  const el = s => { if (!els.has(s)) els.set(s, { hidden: false, textContent: '', innerHTML: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }); return els.get(s); };
  const document = { querySelector: el, querySelectorAll: () => [1, 2, 3, 4].map(r => Object.assign(el(`rate${r}`), { dataset: { rate: String(r) } })), addEventListener: (n, f) => handlers[n] = f, createElement: () => ({}), head: { appendChild(s) { s.onload(); } } };
  let back;
  const context = { document, window: { parent: {} }, parent: { postMessage() {} }, WizardApp: { ready() {}, back: { register(b) { back = b; } } }, location: { pathname: '/mindfeed/', origin: 'http://fixture' }, sessionStorage: { getItem(k) { if (blockedStorage) throw Error('blocked'); return saved.get(k) || null; }, setItem(k, v) { if (blockedStorage) throw Error('blocked'); saved.set(k, v); } },
    setTimeout(f, ms) { if (ms === 260) f(); return 0; }, clearTimeout() {}, addEventListener() {},
    async fetch(url, opts) { const path = url.split('/').at(-1); requests.push(path); let status = 200;
      if (path === 'rate') { if (m.failRate) status = 500; else { const b = JSON.parse(opts.body); m.cards.find(c => c.id === b.id).rating = b.r; } }
      if (path === 'more') { if (m.failMore) status = 500; else m.count = Math.min(m.count + 1, m.cards.length); }
      return { ok: status === 200, status, async json() { return status === 200 ? m.view() : { error: 'synthetic failure' }; } }; }
  };
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  await settle();
  const click = async (selector, data = {}) => { const target = Object.assign(el(selector), { dataset: data, closest: s => s === selector ? target : null }); await handlers.click({ target }); await settle(); };
  return { click, el, back: () => back.back(), saved, shown: () => el('#stage').hidden ? null : /data-id="([^"]+)"/.exec(el('#stage').innerHTML)?.[1], done: () => !el('#done').hidden, rate: async (r = 3) => click('[data-rate]', { rate: String(r) }) };
}
async function firstThree(ui) {
  assert.equal(ui.shown(), 'qa-1'); await ui.rate(); assert.equal(ui.shown(), 'qa-2'); assert.equal(ui.done(), false);
  await ui.rate(1); assert.equal(ui.shown(), 'qa-3'); assert.equal(ui.done(), false);
  await ui.rate(); assert.equal(ui.done(), true); assert.equal(ui.shown(), null);
}
test('morning correction: one checkpoint after three, uninterrupted fourth through seventh', async () => {
  const m = model(), ui = await boot(m); await firstThree(ui);
  assert.equal(m.requests.filter(p => p === 'more').length, 0);
  await ui.click('#more'); assert.equal(ui.shown(), 'qa-4');
  for (let i = 4; i <= 7; i++) { await ui.rate(); assert.equal(ui.shown(), `qa-${i + 1}`); assert.equal(ui.done(), false); }
});
test('Keep going choice survives reload, no repeated checkpoint', async () => {
  const m = model(), ui = await boot(m); await firstThree(ui); await ui.click('#more'); await ui.rate();
  const resumed = await boot(m, ui.saved); assert.equal(resumed.shown(), 'qa-5'); await resumed.rate(); assert.equal(resumed.shown(), 'qa-6');
});
test('fresh morning resets the initial checkpoint', async () => {
  const m = model(), ui = await boot(m); await firstThree(ui); await ui.click('#more');
  m.day = '2026-11-04'; m.count = 3; m.cards.forEach(c => delete c.rating);
  await firstThree(await boot(m, ui.saved));
});
test('explicit Stop and Back return to summary, preserve pending card, and can resume', async () => {
  const m = model(), ui = await boot(m); await firstThree(ui); await ui.click('#more');
  await ui.click('#stop'); assert.equal(ui.done(), true); assert.equal(ui.shown(), null);
  const resumed = await boot(m, ui.saved); assert.equal(resumed.done(), true);
  const before = m.requests.filter(p => p === 'more').length;
  await resumed.click('#more'); assert.equal(resumed.shown(), 'qa-4'); assert.equal(m.requests.filter(p => p === 'more').length, before);
  assert.equal(resumed.back(), true); assert.equal(resumed.done(), true); assert.equal(resumed.back(), false);
});
test('real exhaustion ends the run without a misleading Keep going button', async () => {
  const m = model(7), ui = await boot(m); await firstThree(ui); await ui.click('#more');
  for (let i = 4; i <= 7; i++) await ui.rate();
  assert.equal(ui.done(), true); assert.equal(ui.el('#more').hidden, true); assert.equal(m.count, 7);
});
test('rerating an earlier card never fetches an extra card', async () => {
  const m = model(), ui = await boot(m); await firstThree(ui);
  await ui.click('[data-reopen]', { reopen: 'qa-1' }); assert.equal(ui.shown(), 'qa-1'); await ui.rate(4);
  assert.equal(ui.done(), true); assert.equal(m.count, 3);
});
test('failed rating stays on same card; failed continuation retains saved rating and supports retry', async () => {
  const m = model(), ui = await boot(m); m.failRate = true; await ui.rate(); assert.equal(ui.shown(), 'qa-1');
  m.failRate = false; await firstThree(ui); await ui.click('#more'); m.failMore = true; await ui.rate();
  assert.equal(m.view().rated, 4); assert.equal(ui.done(), true); assert.match(ui.el('#toast').textContent, /Saved/);
  m.failMore = false; await ui.click('#more'); assert.equal(ui.shown(), 'qa-5');
});
test('storage refusal does not break continuation', async () => {
  const m = model(), ui = await boot(m, new Map(), true); await firstThree(ui); await ui.click('#more'); await ui.rate(); assert.equal(ui.shown(), 'qa-5');
});
test('an existing queued extra card resumes with no new fetch', async () => {
  const m = model(); m.count = 4; m.cards.slice(0, 3).forEach(c => c.rating = 3);
  const ui = await boot(m); assert.equal(ui.shown(), 'qa-4'); assert.deepEqual(m.requests, ['today']);
});
