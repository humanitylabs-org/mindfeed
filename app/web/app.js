(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const API = location.pathname.replace(/\/[^/]*$/, '/') + 'api/';
  const framed = window.parent !== window;
  const LABEL = { 4: 'On point', 3: 'Resonant', 2: 'Not so much', 1: 'Not for me' };
  let F = null, reopen = null, busy = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(path, body) {
    const r = await fetch(API + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); }

  // Light Markdown: paragraphs, > quotes, **bold**, *italic*. Headings become the title; "*From: [[X]]*" becomes a source line.
  function render(c) {
    let title = c.title || '', from = '';
    const lines = String(c.text || '').split('\n').filter(l => {
      const h = l.match(/^#{1,3}\s+(.*)/); if (h) { if (!title) title = h[1]; return false; }
      const f = l.match(/^\*From:\s*\[\[(.*?)\]\]\*\s*$/); if (f) { from = f[1]; return false; }
      return true;
    });
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/\[\[(.+?)\]\]/g, '$1');
    const blocks = lines.join('\n').trim().split(/\n\s*\n/).map(b => {
      if (/^>\s?/.test(b)) return `<blockquote>${b.split('\n').map(l => inline(l.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
      return `<p>${b.split('\n').map(inline).join('<br>')}</p>`;
    }).join('');
    return { title, from, html: blocks };
  }

  function cardHTML(c) {
    const r = render(c);
    const attr = [c.attribution, r.from && r.from !== c.attribution ? r.from : ''].filter(Boolean).join(' · ');
    const long = (c.text || '').length > 700;
    return `<article class="card${long ? ' long' : ''}${c.kind === 'quote' ? ' quote' : ''}" data-id="${esc(c.id)}">
      <div class="meta"><span class="src s-${esc(c.source)}">${esc(c.source_label || c.source)}</span>${c.seen ? `<span class="seen">seen ${c.seen}× · last “${esc(LABEL[c.last] || '')}”</span>` : '<span class="seen new">new</span>'}</div>
      ${r.title ? `<h1>${esc(r.title)}</h1>` : ''}
      <div class="body">${r.html}</div>
      ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
      ${attr ? (c.href ? `<a class="attr" href="${esc(c.href)}" target="_top">${esc(attr)} ›</a>` : `<p class="attr">${esc(attr)}</p>`) : ''}
    </article>`;
  }

  function current() {
    if (reopen) return F.cards.find(c => c.id === reopen) || null;
    return F.cards.find(c => !c.rating) || null;
  }

  function paint() {
    const goal = F.goal, n = F.rated >= goal && !current() ? 0 : Math.min(Math.max(goal, F.cards.length), goal + 4);
    $('#prog').innerHTML = `<span class="dots">${Array.from({ length: n }, (_, i) => `<i class="${F.cards[i]?.rating ? 'on' : ''}${F.cards[i] && F.cards[i].id === current()?.id ? ' cur' : ''}${i >= goal ? ' extra' : ''}"></i>`).join('')}</span><span class="cnt">${F.rated < goal ? `${F.rated} of ${goal}` : `${F.rated} today`}</span>`;
    const c = current();
    $('#done').hidden = !!c; $('#stage').hidden = !c; $('#scale').hidden = !c;
    if (c) {
      $('#stage').innerHTML = cardHTML(c);
      $('#stage').scrollTop = 0;
      document.querySelectorAll('#scale [data-rate]').forEach(b => b.classList.toggle('on', +b.dataset.rate === c.rating));
    } else {
      $('#doneH').textContent = F.rated >= goal ? (F.rated === goal ? 'Three for today' : `${F.rated} for today`) : 'That’s everything for now';
      $('#doneP').textContent = F.rated >= goal ? 'Done. Keep going if you feel like it.' : 'Save more lines in Wisdom or with Philosopher and they’ll show up here.';
      $('#recap').innerHTML = F.cards.filter(c => c.rating).map(c => { const r = render(c); const t = r.title || (c.text || '').replace(/[#>*\[\]]/g, '').trim().slice(0, 90); return `<li><button type="button" data-reopen="${esc(c.id)}"><span class="t">${esc(t)}${t.length >= 90 ? '…' : ''}</span><span class="r r${c.rating}">${esc(LABEL[c.rating])}</span></button></li>`; }).join('');
      $('#more').hidden = !(F.more_available > 0);
      const src = Object.entries(F.pool.by_source || {}).map(([k, v]) => `${v} ${k}`).join(' · ');
      $('#pool').textContent = `${F.pool.total} cards in your feed${src ? ` (${src})` : ''}${F.pool.retired ? ` · ${F.pool.retired} retired` : ''}`;
    }
  }

  function tell() {
    const status = { day: F.day, rated: F.rated, goal: F.goal, done: F.done };
    try { if (framed) parent.postMessage({ type: 'wizard:mindfeed', status }, location.origin); } catch (e) {}
  }

  async function load() {
    try { F = await api('today'); paint(); tell(); }
    catch (e) { $('#stage').innerHTML = '<p class="err">Can’t reach MindFeed right now.</p>'; $('#scale').hidden = true; }
  }

  document.addEventListener('click', async e => {
    const rb = e.target.closest('[data-rate]');
    if (rb && !busy) {
      const c = current(); if (!c) return;
      busy = true; rb.classList.add('on');
      const card = $('#stage .card'); card?.classList.add('out', 'r' + rb.dataset.rate);
      const wasDone = F.done;
      try {
        const [d] = await Promise.all([api('rate', { id: c.id, r: +rb.dataset.rate }), new Promise(r => setTimeout(r, 260))]);
        F = d; if (reopen) leaveReopen();
        paint(); tell();
        if (!wasDone && F.done) toast('Three done ✓');
      } catch (err) { card?.classList.remove('out'); toast('Not saved · try again'); }
      finally { busy = false; rb.classList.remove('on'); }
      return;
    }
    const ro = e.target.closest('[data-reopen]');
    if (ro) { enterReopen(ro.dataset.reopen); return; }
    if (e.target.closest('#more')) {
      try { F = await api('more', {}); paint(); } catch (err) { toast('Couldn’t fetch another'); }
    }
  });

  // Back: re-rating an earlier card is the only nested view. Back returns to the summary; at the root it stays put.
  let lastRootBack = 0;
  function enterReopen(id) { reopen = id; if (!framed) history.pushState({ v: 'reopen' }, ''); paint(); }
  function leaveReopen() { if (!reopen) return; reopen = null; if (!framed && history.state?.v === 'reopen') history.back(); }
  if (framed) {
    const s = document.createElement('script'); s.src = '/wizard-os-home/core/app-client.js';
    s.onload = () => { try { WizardApp.ready({ name: 'MindFeed' }); WizardApp.back.register({ canGoBack: () => !!reopen, back: () => { if (!reopen) return false; reopen = null; paint(); return true; } }); } catch (e) {} };
    document.head.appendChild(s);
  } else {
    history.replaceState({ v: 'guard' }, ''); history.pushState({ v: 'root' }, '');
    addEventListener('popstate', e => {
      const v = e.state?.v;
      if (v === 'root') { if (reopen) { reopen = null; paint(); } return; }
      if (v === 'guard' || !v) {
        if (Date.now() - lastRootBack < 2000) { history.back(); return; }
        lastRootBack = Date.now(); history.pushState({ v: 'root' }, ''); toast('Press back again to exit');
      }
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && F && F.day) api('status').then(s => { if (s.day !== F.day) load(); }).catch(() => {}); });
  load();
})();
