// ── State ─────────────────────────────────────────────────────────────────────
const appState = {
  totalSec:           30,
  segments:           [{ startSec: 0, endSec: 30, jumps: 80, mode: 'step' }],
  clickSound:         'electronic',
  playState:          'stopped',
  countdownSec:       3,
  announcementText:   '',
  timeAnnouncements:  [],           // [{ timeSec: 10 }, ...]
  toggles: {
    announcement:    true,
    countdown:       true,
    beepStart:       true,
    beepTransition:  true,
    beepEnd:         true,
    voiceCount:      true,
    voiceTime:       true,
  },
};

// ── Number → English words ─────────────────────────────────────────────────────
const _ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
               'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
               'seventeen', 'eighteen', 'nineteen'];
const _TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty',
               'sixty', 'seventy', 'eighty', 'ninety'];

function numToWords(n) {
  n = Math.round(n);
  if (n === 0) return 'zero';
  if (n < 20)  return _ONES[n];
  if (n < 100) return _TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + _ONES[n % 10] : '');
  const h = Math.floor(n / 100);
  const r = n % 100;
  return _ONES[h] + ' hundred' + (r ? ' ' + numToWords(r) : '');
}

// ── Speech synthesis ───────────────────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang  = 'en-US';
  u.rate  = 1.2;
  window.speechSynthesis.speak(u);
}

function warmupSpeech() {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0.01;
  u.rate   = 10;
  window.speechSynthesis.speak(u);
}

// ── Speech events ──────────────────────────────────────────────────────────────
const SPEECH_LEAD = 0.20; // fire 200 ms early to compensate TTS latency
let _speechEvents = [];

function buildSpeechEvents() {
  _speechEvents = [];
  const { segments, toggles, timeAnnouncements, totalSec, countdownSec } = appState;

  // Countdown: "three", "two", "one" at negative elapsed times
  if (toggles.countdown && countdownSec > 0) {
    const count = Math.round(countdownSec);
    for (let i = count; i >= 1; i--) {
      _speechEvents.push({ timeAt: -i, text: numToWords(i), fired: false });
    }
  }

  if (toggles.voiceCount) {
    segments.forEach(seg => {
      _speechEvents.push({ timeAt: seg.startSec, text: numToWords(seg.jumps), fired: false });
    });
  }

  if (toggles.voiceTime) {
    timeAnnouncements.forEach(ann => {
      if (ann.timeSec > 0 && ann.timeSec <= totalSec) {
        _speechEvents.push({ timeAt: ann.timeSec, text: numToWords(ann.timeSec), fired: false });
      }
    });
  }

  _speechEvents.sort((a, b) => a.timeAt - b.timeAt);
}

function checkSpeechEvents(elapsed) {
  for (const ev of _speechEvents) {
    if (!ev.fired && elapsed >= ev.timeAt - SPEECH_LEAD) {
      ev.fired = true;
      speak(ev.text);
    }
  }
}

// ── Canvas timeline overlay ────────────────────────────────────────────────────
function renderCanvas() {
  const canvas   = document.getElementById('timelineCanvas');
  const bar      = document.getElementById('timelineBar');
  const dpr      = window.devicePixelRatio || 1;
  const displayW = Math.max(bar.clientWidth || 300, 80);
  const displayH = bar.clientHeight || 64;

  const needW = Math.round(displayW * dpr);
  const needH = Math.round(displayH * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width  = needW;
    canvas.height = needH;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);

  const { segments, totalSec } = appState;
  if (!segments.length || totalSec <= 0) return;

  const allJ  = segments.map(s => s.jumps);
  const minJ  = Math.min(...allJ);
  const maxJ  = Math.max(...allJ);
  const range = maxJ - minJ;

  const PT = 7, PB = 7;
  const dW = displayW;
  const dH = displayH - PT - PB;

  const toX = sec => (sec / totalSec) * dW;
  const toY = j   => range > 0
    ? PT + (1 - (j - minJ) / range) * dH
    : PT + dH / 2;

  // Line connecting all segment points
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();

  segments.forEach((seg, i) => {
    const x1    = toX(seg.startSec);
    const x2    = toX(seg.endSec);
    const y1    = toY(seg.jumps);
    const nextJ = i < segments.length - 1 ? segments[i + 1].jumps : seg.jumps;
    const y2    = toY(nextJ);

    if (i === 0) {
      ctx.moveTo(x1, y1);
    } else {
      ctx.lineTo(x1, y1); // vertical step at transition
    }

    if (seg.mode === 'step') {
      ctx.lineTo(x2, y1); // horizontal flat
    } else {
      ctx.lineTo(x2, y2); // diagonal gradient
    }
  });

  ctx.stroke();

  // Dots at segment boundaries
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  segments.forEach(seg => {
    ctx.beginPath();
    ctx.arc(toX(seg.startSec), toY(seg.jumps), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // End dot
  const lastSeg = segments[segments.length - 1];
  ctx.beginPath();
  ctx.arc(toX(lastSeg.endSec), toY(lastSeg.jumps), 4, 0, Math.PI * 2);
  ctx.fill();
}

// ── RAF loop ───────────────────────────────────────────────────────────────────
let rafId = null;

function startRAF() {
  buildSpeechEvents();

  function tick() {
    if (appState.playState !== 'playing') return;
    const elapsed = metronome.getElapsed();

    _updatePlayhead(elapsed);
    _updatePlayInfo(elapsed);
    checkSpeechEvents(elapsed);

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopRAF() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function _updatePlayhead(elapsed) {
  const playhead = document.getElementById('playhead');
  if (elapsed < 0) { playhead.style.left = '0%'; return; }
  playhead.style.left = Math.min(elapsed / appState.totalSec * 100, 100) + '%';
}

function _updatePlayInfo(elapsed) {
  if (elapsed < 0) {
    document.getElementById('infoJumps').innerHTML  = 'カウントダウン中...';
    document.getElementById('infoRemain').innerHTML = '';
    document.getElementById('infoSeg').innerHTML    = '';
    return;
  }
  const segs   = appState.segments;
  const idx    = Math.max(0, segs.findIndex((s, i) =>
    elapsed >= s.startSec && (i === segs.length - 1 || elapsed < segs[i + 1].startSec)
  ));
  const seg    = segs[idx];
  const remain = Math.max(0, appState.totalSec - elapsed).toFixed(1);

  document.getElementById('infoJumps').innerHTML  =
    `<strong>${seg.jumps}</strong> 回/分 (BPM ${seg.jumps * 2})`;
  document.getElementById('infoRemain').innerHTML =
    `残り <strong>${remain}</strong> 秒`;
  document.getElementById('infoSeg').innerHTML    =
    `セグメント <strong>${idx + 1} / ${segs.length}</strong>`;
}

// ── Color helpers ──────────────────────────────────────────────────────────────
function jumpsToHue(j) {
  const c = Math.min(120, Math.max(40, j));
  return Math.round((1 - (c - 40) / 80) * 210);
}

function segBg(seg, nextJ) {
  const h1 = jumpsToHue(seg.jumps);
  if (seg.mode === 'gradient' && nextJ !== null) {
    return `linear-gradient(to right, hsl(${h1},65%,42%), hsl(${jumpsToHue(nextJ)},65%,42%))`;
  }
  return `hsl(${h1},65%,42%)`;
}

// ── Segment CRUD ───────────────────────────────────────────────────────────────
function addSegment() {
  const segs = appState.segments;
  const last = segs[segs.length - 1];
  if (last.endSec - last.startSec < 0.2) return;
  const mid   = Math.round((last.startSec + last.endSec) / 2 * 10) / 10;
  segs.push({ startSec: mid, endSec: last.endSec, jumps: last.jumps, mode: 'step' });
  last.endSec = mid;
  render();
}

function removeSegment(i) {
  const segs = appState.segments;
  if (segs.length <= 1) return;
  if (i === 0) { segs.splice(0, 1); segs[0].startSec = 0; }
  else         { segs[i - 1].endSec = segs[i].endSec; segs.splice(i, 1); }
  render();
}

function updateSegEnd(i, val) {
  const segs = appState.segments;
  if (i >= segs.length - 1) return;
  const clamped = Math.min(segs[i + 1].endSec - 0.1, Math.max(segs[i].startSec + 0.1, val));
  segs[i].endSec       = Math.round(clamped * 10) / 10;
  segs[i + 1].startSec = segs[i].endSec;
  render();
}

function updateTotalSec(v) {
  v = Math.max(1, Math.min(300, Math.round(v)));
  appState.totalSec = v;
  const segs = appState.segments;
  while (segs.length > 1 && segs[segs.length - 1].startSec >= v) segs.pop();
  segs[segs.length - 1].endSec = v;
  render();
}

// ── Time announcements CRUD ────────────────────────────────────────────────────
function addTimeAnn() {
  const existing = appState.timeAnnouncements.map(a => a.timeSec);
  let t = 10;
  while (existing.includes(t) && t <= appState.totalSec) t += 10;
  appState.timeAnnouncements.push({ timeSec: Math.min(t, appState.totalSec) });
  renderTimeAnnouncements();
}

function renderTimeAnnouncements() {
  const list = document.getElementById('timeAnnList');
  list.innerHTML = '';

  appState.timeAnnouncements.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = 'time-ann-item';
    item.innerHTML = `
      <input type="number" class="input-number ann-time" data-idx="${i}"
             value="${ann.timeSec}" min="1" max="300" step="1" inputmode="numeric">
      <span class="unit">秒</span>
      <button class="btn-remove ann-del" data-idx="${i}">削除</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.ann-time').forEach(inp =>
    inp.addEventListener('change', () => {
      const v = Math.max(1, Math.min(300, Math.round(parseFloat(inp.value) || 1)));
      appState.timeAnnouncements[+inp.dataset.idx].timeSec = v;
      inp.value = v;
    })
  );

  list.querySelectorAll('.ann-del').forEach(btn =>
    btn.addEventListener('click', () => {
      appState.timeAnnouncements.splice(+btn.dataset.idx, 1);
      renderTimeAnnouncements();
    })
  );
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
  renderSegments();
  renderTimeline();
  renderTimeAnnouncements();
  renderCanvas();
}

function renderSegments() {
  const container = document.getElementById('segmentList');
  container.innerHTML = '';
  const segs = appState.segments;

  segs.forEach((seg, i) => {
    const isLast = i === segs.length - 1;
    const card   = document.createElement('div');
    card.className = 'segment-card';
    card.innerHTML = `
      <div class="segment-card-header">
        <span class="segment-index">セグメント ${i + 1}</span>
        <button class="btn-remove" data-idx="${i}" ${segs.length <= 1 ? 'disabled' : ''}>削除</button>
      </div>
      <div class="segment-time-row">
        <div class="segment-field">
          <label>開始（秒）</label>
          <input type="number" class="input-number" value="${seg.startSec}" readonly inputmode="decimal">
        </div>
        <span class="time-arrow">→</span>
        <div class="segment-field">
          <label>終了（秒）</label>
          <input type="number" class="input-number seg-end" data-idx="${i}"
                 value="${seg.endSec}" step="0.1" min="0.1" max="300"
                 ${isLast ? 'readonly' : ''} inputmode="decimal">
        </div>
      </div>
      <div class="segment-jumps-row">
        <div class="segment-field">
          <label>回数（回/分）</label>
          <input type="number" class="input-number seg-jumps" data-idx="${i}"
                 value="${seg.jumps}" min="30" max="200" inputmode="numeric">
        </div>
        <span class="bpm-badge">= BPM <strong>${seg.jumps * 2}</strong></span>
      </div>
      <div class="segment-mode-row">
        <span class="mode-label">モード</span>
        <div class="mode-toggle">
          <button class="mode-btn ${seg.mode === 'step' ? 'active' : ''}"
                  data-idx="${i}" data-mode="step">ステップ</button>
          <button class="mode-btn ${seg.mode === 'gradient' ? 'active' : ''}"
                  data-idx="${i}" data-mode="gradient">グラデーション</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', () => removeSegment(+btn.dataset.idx))
  );
  container.querySelectorAll('.seg-end').forEach(inp =>
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) updateSegEnd(+inp.dataset.idx, v);
    })
  );
  container.querySelectorAll('.seg-jumps').forEach(inp =>
    inp.addEventListener('change', () => {
      const idx = +inp.dataset.idx;
      const v   = Math.round(Math.max(30, Math.min(200, parseInt(inp.value) || 80)));
      appState.segments[idx].jumps = v;
      renderSegments();
      renderTimeline();
      renderCanvas();
    })
  );
  container.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      appState.segments[+btn.dataset.idx].mode = btn.dataset.mode;
      renderSegments();
      renderTimeline();
      renderCanvas();
    })
  );
}

function renderTimeline() {
  const { segments, totalSec } = appState;
  const segsEl   = document.getElementById('timelineSegs');
  const labelsEl = document.getElementById('timelineLabels');
  segsEl.innerHTML   = '';
  labelsEl.innerHTML = '';

  segments.forEach((seg, i) => {
    const dur  = seg.endSec - seg.startSec;
    const div  = document.createElement('div');
    div.className    = 'timeline-seg';
    div.style.width  = (dur / totalSec * 100).toFixed(3) + '%';
    div.style.background = segBg(seg, i < segments.length - 1 ? segments[i + 1].jumps : null);
    div.textContent  = dur > 0 ? `${seg.jumps}回` : '';
    segsEl.appendChild(div);
  });

  [0, ...segments.map(s => s.endSec)].forEach((t, i, arr) => {
    const span      = document.createElement('span');
    span.className  = 'timeline-label';
    span.style.left = (t / totalSec * 100) + '%';
    span.textContent = t + 's';
    if (i === 0)              span.style.transform = 'translateX(0)';
    if (i === arr.length - 1) span.style.transform = 'translateX(-100%)';
    labelsEl.appendChild(span);
  });
}

// ── Playback controls ──────────────────────────────────────────────────────────
let _awaitingStart = false;

function onPlay() {
  if (appState.playState === 'playing') return;
  // Must call _ensureCtx() first, synchronously within the user gesture,
  // so iOS unlocks the audio hardware before any async work starts.
  metronome._ensureCtx();
  warmupSpeech();
  appState.playState = 'playing';
  _awaitingStart = true;

  const playhead = document.getElementById('playhead');
  playhead.style.left = '0%';
  playhead.hidden     = false;

  document.getElementById('playInfo').hidden  = false;
  document.getElementById('playBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;

  function beginMetronome() {
    if (!_awaitingStart) return;
    _awaitingStart = false;
    metronome.start(appState, onPlayEnd);
    startRAF();
  }

  const text = (appState.announcementText || '').trim();
  if (text && appState.toggles.announcement) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = 'en-US';
    u.rate  = 0.95;
    u.onend = beginMetronome;
    u.onerror = () => { if (_awaitingStart) beginMetronome(); };
    window.speechSynthesis.speak(u);
  } else {
    beginMetronome();
  }
}

function onStop() {
  if (appState.playState === 'stopped') return;
  _awaitingStart = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  metronome.stop();
  onPlayEnd();
}

function onPlayEnd() {
  if (appState.playState === 'stopped') return;
  appState.playState = 'stopped';
  stopRAF();
  renderCanvas();

  document.getElementById('playhead').hidden  = true;
  document.getElementById('playInfo').hidden  = true;
  document.getElementById('playBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
}

// ── Export ─────────────────────────────────────────────────────────────────────
async function onExport() {
  const btn    = document.getElementById('exportBtn');
  const status = document.getElementById('exportStatus');
  btn.disabled   = true;
  status.hidden  = false;
  status.textContent = '音声を生成中...';

  try {
    await exportMP3(appState);
    status.textContent = 'ダウンロードを開始しました。';
  } catch (e) {
    console.error(e);
    status.textContent = 'エラー: ' + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.hidden = true; }, 4000);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  render();

  // Total time
  document.getElementById('totalSec').addEventListener('change', e => {
    const v = parseInt(e.target.value);
    if (!isNaN(v)) updateTotalSec(v);
    else e.target.value = appState.totalSec;
  });

  // Segment add
  document.getElementById('addSegBtn').addEventListener('click', addSegment);

  // Announcement text
  document.getElementById('announcementText').addEventListener('input', e => {
    appState.announcementText = e.target.value;
  });

  // Countdown duration (integer seconds)
  document.getElementById('countdownSec').addEventListener('change', e => {
    const v = Math.max(0, Math.min(10, Math.round(parseFloat(e.target.value) || 0)));
    appState.countdownSec = v;
    e.target.value = v;
  });

  // Time announcement add
  document.getElementById('addTimeAnnBtn').addEventListener('click', addTimeAnn);

  // Toggles
  document.getElementById('togAnnouncement').addEventListener('change', e => {
    appState.toggles.announcement = e.target.checked;
  });
  document.getElementById('togCountdown').addEventListener('change', e => {
    appState.toggles.countdown = e.target.checked;
  });
  document.getElementById('togBeepStart').addEventListener('change', e => {
    appState.toggles.beepStart = e.target.checked;
  });
  document.getElementById('togBeepTransition').addEventListener('change', e => {
    appState.toggles.beepTransition = e.target.checked;
  });
  document.getElementById('togBeepEnd').addEventListener('change', e => {
    appState.toggles.beepEnd = e.target.checked;
  });
  document.getElementById('togVoiceCount').addEventListener('change', e => {
    appState.toggles.voiceCount = e.target.checked;
  });
  document.getElementById('togVoiceTime').addEventListener('change', e => {
    appState.toggles.voiceTime = e.target.checked;
  });

  // Click sound
  document.querySelectorAll('input[name="clickSound"]').forEach(r =>
    r.addEventListener('change', () => { appState.clickSound = r.value; })
  );

  // Playback
  document.getElementById('playBtn').addEventListener('click', onPlay);
  document.getElementById('stopBtn').addEventListener('click', onStop);
  document.getElementById('exportBtn').addEventListener('click', onExport);

  // Redraw canvas on window resize
  window.addEventListener('resize', () => renderCanvas());

  // Resume AudioContext when app returns from background (required on iOS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && metronome.audioCtx) {
      metronome.audioCtx.resume();
    }
  });
});
