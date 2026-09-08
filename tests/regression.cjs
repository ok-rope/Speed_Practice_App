const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup() {
  const timers = new Map(); let next = 0;
  const elements = new Map();
  function element(id) {
    return { id, disabled: false, dataset: {}, style: {},
      hasAttribute(name) { return name === 'data-playback-disabled' && 'playbackDisabled' in this.dataset; } };
  }
  const document = { addEventListener() {},
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    querySelectorAll() { return [...elements.values()]; } };
  const utterances = [];
  const c = { assert, console, document, timers, elements, utterances,
    window: { speechSynthesis: { speak(u) { utterances.push(u); }, cancel() {} } },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    setTimeout(fn) { timers.set(++next, fn); return next; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { timers.set(++next, fn); return next; },
    clearInterval(id) { timers.delete(id); },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  vm.createContext(c);
  for (const f of ['metronome.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), c);
  vm.runInContext(`
    renderCanvas = () => {};
    _unlockIOSAudioSession = () => {};
    const beeps = []; scheduleBeep = (ctx, time) => beeps.push(time); scheduleClick = () => {};
    function state(jumps = 40) { return { totalSec: 1, segments: [{startSec:0,endSec:1,jumps,mode:'step'}], toggles:{beepEnd:true}, countdownSec:0 }; }
    function engine() { const e = new MetronomeEngine(); e.audioCtx = {currentTime:0,destination:{}}; e._ensureCtx = () => Promise.resolve(e.audioCtx); return e; }
  `, c);
  return code => vm.runInContext(code, c);
}
test('end beep is exactly at the deadline across tempos, once only', async () => {
  await setup()(`(async () => {
    for (const tempo of [30,40,80,200]) {
      beeps.length = 0; const e=engine(); await e.start(state(tempo),()=>{});
      for(let i=0;i<70;i++){ e.audioCtx.currentTime=i*0.025; e._scheduleLoop(); }
      assert.equal(beeps.length,1); assert.equal(beeps[0],1.1); e.stop();
    }
  })()`);
});
test('stop cancels sources and old completion cannot affect a new run', async () => {
  await setup()(`(async () => {
    const e=engine(); let finishes=0; await e.start(state(),()=>finishes++);
    let stopped=0, disconnected=0;
    trackSource(e.audioCtx,{stop(){stopped++},disconnect(){disconnected++}});
    e.audioCtx.currentTime=1.025; e._scheduleLoop();
    const oldFinish=timers.get(e._finishTimer); e.stop();
    assert.equal(stopped,1); assert.equal(disconnected,1);
    await e.start(state(),()=>finishes++); oldFinish();
    assert.equal(finishes,0); assert.equal(e._stopped,false); e.stop();
  })()`);
});
test('pending audio startup cannot create duplicate schedulers after restart', async () => {
  await setup()(`(async () => {
    const e=engine(); const pending=[];
    e._ensureCtx=()=>new Promise(resolve=>pending.push(resolve));
    const first=e.start(state(),()=>{}); e.stop(); const second=e.start(state(),()=>{});
    pending[0](); await first; assert.equal(e.schedulerTimer,null);
    pending[1](); await second; assert.notEqual(e.schedulerTimer,null); e.stop();
  })()`);
});
test('playback settings are isolated from editing state', async () => {
  await setup()(`(async () => {
    const s=state(); const e=engine(); await e.start(s,()=>{});
    s.segments.length=0; assert.equal(e._intervalAt(0),0.75); e.stop();
  })()`);
});
test('edit lock survives repeated rendering and restores disabled controls', () => {
  setup()(`
    const input=document.getElementById('totalSec');
    const remove=document.getElementById('remove'); remove.disabled=true;
    appState.playState='playing'; syncEditingLock(); syncEditingLock();
    const fresh=document.getElementById('newSegment'); syncEditingLock();
    assert.equal(input.disabled,true); assert.equal(fresh.disabled,true);
    appState.playState='stopped'; syncEditingLock();
    assert.equal(input.disabled,false); assert.equal(fresh.disabled,false); assert.equal(remove.disabled,true);
  `);
});
test('old intro timer and speech callbacks cannot start the next playback', () => {
  setup()(`
    metronome._ensureCtx=()=>Promise.resolve(); let starts=0;
    metronome.start=()=>{starts++;return Promise.resolve()};
    onPlay(); const oldTimer=timers.get(_introTimer); const oldIntro=utterances.at(-1);
    onStop(); onPlay(); const newTimer=_introTimer;
    oldTimer(); oldIntro.onend();
    assert.equal(starts,0); assert.equal(_introTimer,newTimer);
    onStop(); assert.equal(timers.has(newTimer),false);
  `);
});
test('future time announcements survive save/load unchanged', () => {
  setup()(`
    appState.timeAnnouncements=[{timeSec:60},{timeSec:1200}]; appState.totalSec=30;
    const result=_sanitizeSettings(JSON.parse(JSON.stringify(_cloneSettings())));
    assert.equal(result.timeAnnouncements[0].timeSec,60);
    assert.equal(result.timeAnnouncements[1].timeSec,1200);
  `);
});
test('gradient display and beat interval use the same interpolated tempo', () => {
  setup()(`
    appState.segments=[{startSec:0,endSec:10,jumps:80,mode:'gradient'},{startSec:10,endSec:20,jumps:60,mode:'step'}];
    const e=engine();e.state=appState;
    assert.equal(jumpsAt(appState.segments,5),70); assert.equal(e._intervalAt(5),60/140);
    t=(key,vars)=>JSON.stringify(vars); _updatePlayInfo(5);
    const info=JSON.parse(document.getElementById('infoJumps').innerHTML);
    assert.equal(info.j,'70'); assert.equal(info.b,'140');
    assert.equal(jumpsAt(appState.segments,15),60);
  `);
});
test('MP3 UI and runtime dependency have been removed', () => {
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.doesNotMatch(html,/exportBtn|exportStatus|export\.js|lamejs|MP3/);
  assert.equal(fs.existsSync(path.join(root,'export.js')),false);
});
