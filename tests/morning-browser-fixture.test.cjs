'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {sampleShell, compatible, waitShell} = require('./morning-shell-ready.cjs');
const harness = fs.readFileSync(path.join(__dirname,'morning-keep-going.browser.cjs'),'utf8');
test('established-owner model fixture passes the pinned real Welcome predicate; old {} fails', () => {
  const file = path.join(process.env.QA_SHELL_ROOT,'web/core/welcome.js');
  const sandbox = {window:{}}; vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
  const payload = harness.match(/if \(p === '\/wizard\/hermes\/api\/model\/options'\) return json\(([^\n]+)\);/)[1];
  assert.equal(sandbox.window.WosWelcome.aiConnected({}),false);
  assert.equal(sandbox.window.WosWelcome.aiConnected(vm.runInNewContext('('+payload+')')),true);
  assert.ok(harness.includes("localStorage.setItem('wos.welcome.v1', 'done')"));
  assert.ok(harness.includes("WosWelcome.log.some(x => x.startsWith('boot:')) && !WosWelcome.active"));
});
test('pinned Settings route opens registered features, not the Appearance category id', () => {
  const sandbox = { window: { addEventListener() {} }, document: { baseURI: 'http://fixture/wizard-os-home/' }, location: new URL('http://fixture/wizard-os-home/'), URL };
  vm.runInNewContext(fs.readFileSync(path.join(process.env.QA_SHELL_ROOT, 'web/core/settings.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(process.env.QA_SHELL_ROOT, 'web/core/deeplink.js'), 'utf8'), sandbox);
  const calls = [], open = (...args) => calls.push(args), route = sandbox.window.WosSettings.route;
  const deeplink = sandbox.window.WizCore.deeplink;
  deeplink.handle({ view: id => route(id, open) });
  assert.equal(deeplink.route('/wizard-os-home/?view=appearance'), false); assert.deepEqual(calls, []);
  assert.equal(deeplink.route('/wizard-os-home/?view=settings'), true); assert.deepEqual(calls.pop(), []);
  assert.equal(route('appearance', open), false); assert.deepEqual(calls, []);
  assert.equal(route('settings', open), true); assert.deepEqual(calls.pop(), []);
  for (const id of ['look', 'skin']) { assert.equal(route(id, open), true); assert.deepEqual(calls.pop(), ['look']); }
  assert.ok(harness.includes("'?view=settings'"));
  assert.ok(harness.includes('[data-st-page="appearance"]:visible'));
  assert.ok(!harness.includes('?view=appearance'));
  const skins = fs.readFileSync(path.join(process.env.QA_SHELL_ROOT, 'web/core/skins.js'), 'utf8');
  assert.match(skins, /id: 'wizard'[^\n]+palettes: \['nebula', 'grove', 'tide', 'ember', 'signal'\]/);
});
function sample({animation, frameAnimation, x=0, hit=true, loading=false, hidden=false}={}) {
  const f = {tagName:'IFRAME',className:'appframe',parentElement:null,getBoundingClientRect:()=>({x,y:0,left:x,top:0,right:x+400,bottom:800,width:400,height:800}),closest:()=>loading,contentDocument:{visibilityState:hidden?'hidden':'visible'}};
  f.contentDocument.getAnimations = () => frameAnimation ? [{playState:frameAnimation,playbackRate:1,currentTime:30,effect:{target:{className:'card'},getComputedTiming:()=>({endTime:280})}}] : [];
  const sandbox = {document:{querySelector:()=>f,getAnimations:()=>animation?[{playState:animation,playbackRate:1,currentTime:30,effect:{target:f,getComputedTiming:()=>({endTime:380})}}]:[],elementFromPoint:()=>hit?f:null}, getComputedStyle:()=>({opacity:'1',visibility:'visible',transform:'none',filter:'none'}),innerWidth:412,innerHeight:892};
  // Match Playwright's callable serialization: no closure-bound browser helpers.
  return vm.runInNewContext('('+sampleShell.toString()+')("iframe")',sandbox);
}
test('actual serialized sampler accepts fully visible settled frame',()=>assert.equal(sample().ready,true));
test('actual sampler refuses running and frozen finite shell/card motion',()=>{ for(const animation of ['running','paused','pending']){assert.equal(sample({animation}).ready,false);assert.equal(sample({frameAnimation:animation}).ready,false);} });
test('actual sampler refuses offscreen/covered/loading/parked frames',()=>{ for(const opts of [{x:-400},{hit:false},{loading:true},{hidden:true}])assert.equal(sample(opts).ready,false); });
test('matching local controls cannot settle a moving containing shell',()=>{assert.equal(compatible(sample(),sample({animation:'running'})),false);assert.equal(compatible(sample(),sample({x:1})),false);assert.equal(compatible(sample(),sample()),true);});
test('host-polled readiness survives dead page timers and waits for successive legal samples',async()=>{
  const samples=[sample({animation:'running'}),sample({x:1}),sample(),sample()]; let t=0,calls=0;
  await waitShell({evaluate:async fn=>{assert.equal(typeof fn,'function');calls++;return samples.shift();}},'iframe',{now:()=>t,pause:async ms=>{t+=ms;},timeout:1000}); assert.equal(calls,4);
});
test('never-settling shell fails bounded with evidence',async()=>{let t=0;await assert.rejects(waitShell({evaluate:async()=>sample({animation:'paused'})},'iframe',{now:()=>t,pause:async ms=>{t+=ms;},timeout:180}),/Shell frame not settled/);});
