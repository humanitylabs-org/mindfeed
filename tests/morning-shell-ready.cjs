'use strict';
const assert = require('node:assert/strict');
// Local-frame actionability cannot establish that the shell's containing desk/window
// has landed. Sample the real ancestor chain, not a delay or disabled animations.
function sampleShell(selector) {
  const f = document.querySelector(selector); if (!f) return { ready: false, reason: 'missing frame' };
  const chain = []; for (let n = f; n; n = n.parentElement) chain.push(n);
  const r = f.getBoundingClientRect(), styles = chain.map(n => { const c = getComputedStyle(n); return { tag: n.tagName, cls: n.className, opacity: c.opacity, transform: c.transform, visibility: c.visibility, filter: c.filter }; });
  const animations = document.getAnimations().filter(a => chain.includes(a.effect?.target)).map(a => ({ state: a.playState, rate: a.playbackRate, current: a.currentTime, end: a.effect.getComputedTiming().endTime }));
  const visible = r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) === f;
  const clear = styles.every(s => Number(s.opacity) >= .999 && s.visibility === 'visible' && s.filter === 'none');
  const moving = animations.some(a => Number.isFinite(a.end) && (a.state === 'running' || a.state === 'pending' || a.state === 'paused' && a.current < a.end));
  const ready = visible && hit && clear && !moving && !f.closest('.frame-wrap.loading') && f.contentDocument?.visibilityState === 'visible';
  return { ready, rect: [r.x,r.y,r.width,r.height], styles, animations, visible, hit, clear };
}
function compatible(a, b) {
  return !!(a?.ready && b?.ready && a.rect.every((v,i) => Math.abs(v-b.rect[i]) < .25) && JSON.stringify(a.styles) === JSON.stringify(b.styles));
}
async function waitShell(page, selector, { timeout = 10000, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  const until = now()+timeout, history = []; let previous;
  while(now()<until) {
    const current = await page.evaluate(sampleShell, selector); history.push(current); if(history.length>12) history.shift();
    if(compatible(previous,current)) return current;
    previous=current; await pause(60);
  }
  assert.fail('Shell frame not settled: '+JSON.stringify(history));
}
module.exports = { sampleShell, compatible, waitShell };
