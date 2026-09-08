// ── State ─────────────────────────────────────────────────────────────────────
const appState = {
  totalSec:           30,
  segments:           [
    { startSec: 0,  endSec: 10, jumps: 80, mode: 'step' },
    { startSec: 10, endSec: 20, jumps: 70, mode: 'step' },
    { startSec: 20, endSec: 30, jumps: 60, mode: 'step' },
  ],
  beepGain:           2.5,
  clickSound:         'electronic',
  playState:          'stopped',
  countdownSec:       3,
  announcementText:   'Single Rope',
  timeAnnouncements:  [{ timeSec: 10 }, { timeSec: 20 }],
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

const MAX_TOTAL_SEC = 1200;
const MIN_JUMPS = 30;
const MAX_JUMPS = 200;
const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_STORAGE_KEY = 'jumpRopeMetronome.settings.v1';
const SETTINGS_CODE_PREFIX = 'JRMS1.';

// ── Number → English words ─────────────────────────────────────────────────────
const _ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
               'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
               'seventeen', 'eighteen', 'nineteen'];
const _TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty',
               'sixty', 'seventy', 'eighty', 'ninety'];

function integerToWords(n) {
  if (n === 0) return 'zero';
  if (n < 20)  return _ONES[n];
  if (n < 100) return _TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + _ONES[n % 10] : '');
  const h = Math.floor(n / 100);
  const r = n % 100;
  return _ONES[h] + ' hundred' + (r ? ' ' + integerToWords(r) : '');
}

function numToWords(n) {
  n = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(n)) return '';
  const whole = Math.trunc(n);
  const frac  = Math.round((n - whole) * 10);
  return frac ? `${integerToWords(whole)} point ${integerToWords(frac)}` : integerToWords(whole);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function formatNumber(n) {
  const rounded = round1(Number(n));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function normalizeJumps(v) {
  const parsed = parseFloat(v);
  const fallback = Number.isFinite(parsed) ? parsed : 80;
  return round1(Math.max(MIN_JUMPS, Math.min(MAX_JUMPS, fallback)));
}

// ── Settings persistence ─────────────────────────────────────────────────────
function _cloneSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appVersion: '0.17',
    totalSec: appState.totalSec,
    segments: appState.segments.map(seg => ({
      startSec: round1(seg.startSec),
      endSec: round1(seg.endSec),
      jumps: normalizeJumps(seg.jumps),
      mode: seg.mode === 'gradient' ? 'gradient' : 'step',
    })),
    beepGain: appState.beepGain,
    clickSound: appState.clickSound,
    countdownSec: appState.countdownSec,
    announcementText: appState.announcementText,
    timeAnnouncements: appState.timeAnnouncements.map(ann => ({
      timeSec: Math.max(1, Math.min(MAX_TOTAL_SEC, Math.round(parseFloat(ann.timeSec) || 1))),
    })),
    toggles: { ...appState.toggles },
  };
}

function _encodeSettings(settings) {
  const json = JSON.stringify(settings);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return SETTINGS_CODE_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _decodeSettingsCode(code) {
  const trimmed = (code || '').trim();
  const payload = trimmed.startsWith(SETTINGS_CODE_PREFIX)
    ? trimmed.slice(SETTINGS_CODE_PREFIX.length)
    : trimmed;
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function _sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid settings');
  const totalSec = Math.max(1, Math.min(MAX_TOTAL_SEC, Math.round(parseFloat(raw.totalSec) || appState.totalSec)));
  const rawSegments = Array.isArray(raw.segments) && raw.segments.length ? raw.segments : appState.segments;
  const segments = rawSegments.map((seg, i) => {
    const startSec = i === 0 ? 0 : round1(Math.max(0, Math.min(totalSec, parseFloat(seg.startSec) || 0)));
    const endSec = round1(Math.max(startSec + 0.1, Math.min(totalSec, parseFloat(seg.endSec) || totalSec)));
    return {
      startSec,
      endSec,
      jumps: normalizeJumps(seg.jumps),
      mode: seg.mode === 'gradient' ? 'gradient' : 'step',
    };
  }).filter(seg => seg.startSec < totalSec);

  if (!segments.length) {
    segments.push({ startSec: 0, endSec: totalSec, jumps: 80, mode: 'step' });
  }
  segments[0].startSec = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].endSec = Math.min(segments[i].endSec, segments[i + 1].startSec);
    if (segments[i].endSec <= segments[i].startSec) segments[i].endSec = round1(segments[i].startSec + 0.1);
    segments[i + 1].startSec = segments[i].endSec;
  }
  segments[segments.length - 1].endSec = totalSec;

  const toggles = { ...appState.toggles, ...(raw.toggles || {}) };
  Object.keys(toggles).forEach(key => { toggles[key] = !!toggles[key]; });

  return {
    totalSec,
    segments,
    beepGain: Math.max(0.5, Math.min(5.0, parseFloat(raw.beepGain) || appState.beepGain)),
    clickSound: ['electronic', 'marimba', 'simple', 'wood', 'hihat'].includes(raw.clickSound)
      ? raw.clickSound
      : appState.clickSound,
    countdownSec: Math.max(0, Math.min(10, Math.round(parseFloat(raw.countdownSec) || 0))),
    announcementText: typeof raw.announcementText === 'string' ? raw.announcementText : appState.announcementText,
    timeAnnouncements: Array.isArray(raw.timeAnnouncements)
      ? raw.timeAnnouncements.map(ann => ({
          timeSec: Math.max(1, Math.min(MAX_TOTAL_SEC, Math.round(parseFloat(ann.timeSec) || 1))),
        }))
      : appState.timeAnnouncements,
    toggles,
  };
}

function applySettings(settings) {
  const clean = _sanitizeSettings(settings);
  Object.assign(appState, clean);
  syncControls();
  render();
  saveSettings();
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(_cloneSettings()));
  } catch (e) {
    console.warn('Could not save settings.', e);
  }
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const clean = _sanitizeSettings(JSON.parse(raw));
    Object.assign(appState, clean);
  } catch (e) {
    console.warn('Could not load saved settings.', e);
  }
}

function getSettingsCode() {
  return _encodeSettings(_cloneSettings());
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
  if (!window.speechSynthesis) return Promise.resolve();
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0.01;
  u.rate   = 10;
  const done = new Promise(resolve => {
    u.onend = resolve;
    u.onerror = resolve;
    setTimeout(resolve, 250);
  });
  window.speechSynthesis.speak(u);
  return done;
}

// ── Speech events ──────────────────────────────────────────────────────────────
// Priority 0 = countdown (fires before beat for TTS latency compensation)
// Priority 1 = voiceCount (fires after BEEP)
// Priority 2 = voiceTime  (fires after voiceCount)
const SPEECH_LEAD = 0.20; // seconds: countdown fires this early to compensate TTS latency
const AFTER_BEEP  = 0.35; // seconds: voiceCount fires after BEEP ends (~0.25 s) + gap
const STAGGER     = 0.50; // seconds: voiceTime fires this long after voiceCount

let _speechEvents = [];
let _speechTimers = [];

function buildSpeechEvents() {
  _speechEvents = [];
  const { segments, toggles, timeAnnouncements, totalSec, countdownSec } = appState;

  if (toggles.countdown && countdownSec > 0) {
    const count = Math.round(countdownSec);
    for (let i = count; i >= 1; i--) {
      _speechEvents.push({ timeAt: -i, text: numToWords(i), priority: 0 });
    }
  }

  if (toggles.voiceCount) {
    segments.forEach(seg => {
      _speechEvents.push({ timeAt: seg.startSec, text: numToWords(seg.jumps), priority: 1 });
    });
  }

  if (toggles.voiceTime) {
    timeAnnouncements.forEach(ann => {
      if (ann.timeSec > 0 && ann.timeSec <= totalSec) {
        _speechEvents.push({ timeAt: ann.timeSec, text: numToWords(ann.timeSec), priority: 2 });
      }
    });
  }

  // Sort by timeAt first, then by priority so countdown < voiceCount < voiceTime
  _speechEvents.sort((a, b) => a.timeAt !== b.timeAt ? a.timeAt - b.timeAt : a.priority - b.priority);
}

// Schedule all speech events upfront via setTimeout — more reliable than RAF
// on iOS/Android where speechSynthesis.speak() from a timer loop may be blocked.
// Ordering guarantee: BEEP (Web Audio, always on time) → voiceCount → voiceTime
function _scheduleSpeechWithTimers() {
  _clearSpeechTimers();
  const now     = metronome.audioCtx.currentTime;
  const startAt = metronome.startAudioTime;

  let prevTimeAt  = null;
  let sameTimeIdx = 0;

  _speechEvents.forEach(ev => {
    // Track position within events that share the same timeAt
    if (ev.timeAt !== prevTimeAt) {
      prevTimeAt  = ev.timeAt;
      sameTimeIdx = 0;
    } else {
      sameTimeIdx++;
    }

    let fireAt;
    if (ev.priority === 0) {
      // Countdown: fire slightly before the beat so TTS latency lines up
      fireAt = startAt + ev.timeAt - SPEECH_LEAD;
    } else {
      // voiceCount (idx=0): fires AFTER_BEEP after the beat
      // voiceTime  (idx=1): fires AFTER_BEEP + STAGGER after the beat
      fireAt = startAt + ev.timeAt + AFTER_BEEP + sameTimeIdx * STAGGER;
    }

    const delayMs = Math.max(0, (fireAt - now) * 1000);
    const t = setTimeout(() => {
      if (appState.playState === 'playing') speak(ev.text);
    }, delayMs);
    _speechTimers.push(t);
  });
}

function _clearSpeechTimers() {
  _speechTimers.forEach(t => clearTimeout(t));
  _speechTimers = [];
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
  _scheduleSpeechWithTimers();

  function tick() {
    if (appState.playState !== 'playing') return;
    const elapsed = metronome.getElapsed();

    _updatePlayhead(elapsed);
    _updatePlayInfo(elapsed);

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopRAF() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  _clearSpeechTimers();
}

function _updatePlayhead(elapsed) {
  const playhead = document.getElementById('playhead');
  if (elapsed < 0) { playhead.style.left = '0%'; return; }
  playhead.style.left = Math.min(elapsed / appState.totalSec * 100, 100) + '%';
}

function _updatePlayInfo(elapsed) {
  if (elapsed < 0) {
    document.getElementById('infoJumps').innerHTML  = t('counting-down');
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

  document.getElementById('infoJumps').innerHTML  = t('jumps-info', {
    j: formatNumber(jumpsAt(segs, elapsed)),
    b: formatNumber(jumpsAt(segs, elapsed) * 2),
  });
  document.getElementById('infoRemain').innerHTML = t('remain-info', {n: remain});
  document.getElementById('infoSeg').innerHTML    = t('seg-info',   {a: idx + 1,  b: segs.length});
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
  saveSettings();
}

function removeSegment(i) {
  const segs = appState.segments;
  if (segs.length <= 1) return;
  if (i === 0) { segs.splice(0, 1); segs[0].startSec = 0; }
  else         { segs[i - 1].endSec = segs[i].endSec; segs.splice(i, 1); }
  render();
  saveSettings();
}

function updateSegEnd(i, val) {
  const segs = appState.segments;
  if (i >= segs.length - 1) return;
  const clamped = Math.min(segs[i + 1].endSec - 0.1, Math.max(segs[i].startSec + 0.1, val));
  segs[i].endSec       = Math.round(clamped * 10) / 10;
  segs[i + 1].startSec = segs[i].endSec;
  render();
  saveSettings();
}

function updateTotalSec(v) {
  v = Math.max(1, Math.min(MAX_TOTAL_SEC, Math.round(v)));
  appState.totalSec = v;
  const segs = appState.segments;
  while (segs.length > 1 && segs[segs.length - 1].startSec >= v) segs.pop();
  segs[segs.length - 1].endSec = v;
  render();
  syncControls();
  saveSettings();
}

// ── Time announcements CRUD ────────────────────────────────────────────────────
function addTimeAnn() {
  const existing = appState.timeAnnouncements.map(a => a.timeSec);
  let t = 10;
  while (existing.includes(t) && t <= appState.totalSec) t += 10;
  appState.timeAnnouncements.push({ timeSec: Math.min(t, appState.totalSec) });
  renderTimeAnnouncements();
  saveSettings();
}

function renderTimeAnnouncements() {
  const list = document.getElementById('timeAnnList');
  list.innerHTML = '';

  appState.timeAnnouncements.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = 'time-ann-item';
    item.innerHTML = `
      <input type="number" class="input-number ann-time" data-idx="${i}"
             value="${ann.timeSec}" min="1" max="${MAX_TOTAL_SEC}" step="1" inputmode="numeric">
      <span class="unit">${t('unit-sec')}</span>
      <button class="btn-remove ann-del" data-idx="${i}">${t('btn-delete-ann')}</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.ann-time').forEach(inp =>
    inp.addEventListener('change', () => {
      const v = Math.max(1, Math.min(MAX_TOTAL_SEC, Math.round(parseFloat(inp.value) || 1)));
      appState.timeAnnouncements[+inp.dataset.idx].timeSec = v;
      inp.value = v;
      saveSettings();
    })
  );

  list.querySelectorAll('.ann-del').forEach(btn =>
    btn.addEventListener('click', () => {
      appState.timeAnnouncements.splice(+btn.dataset.idx, 1);
      renderTimeAnnouncements();
      saveSettings();
    })
  );
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
  renderSegments();
  renderTimeline();
  renderTimeAnnouncements();
  renderCanvas();
  syncEditingLock();
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
        <span class="segment-index">${t('seg-label', {n: i + 1})}</span>
        <button class="btn-remove" data-idx="${i}" ${segs.length <= 1 ? 'disabled' : ''}>${t('btn-delete')}</button>
      </div>
      <div class="segment-time-row">
        <div class="segment-field">
          <label>${t('seg-start')}</label>
          <input type="number" class="input-number" value="${seg.startSec}" readonly inputmode="decimal">
        </div>
        <span class="time-arrow">→</span>
        <div class="segment-field">
          <label>${t('seg-end')}</label>
          <input type="number" class="input-number seg-end" data-idx="${i}"
                 value="${seg.endSec}" step="0.1" min="0.1" max="${MAX_TOTAL_SEC}"
                 ${isLast ? 'readonly' : ''} inputmode="decimal">
        </div>
      </div>
      <div class="segment-jumps-row">
        <div class="segment-field">
          <label>${t('seg-jumps')}</label>
          <input type="number" class="input-number seg-jumps" data-idx="${i}"
                 value="${formatNumber(seg.jumps)}" min="${MIN_JUMPS}" max="${MAX_JUMPS}"
                 step="0.1" inputmode="decimal">
        </div>
        <span class="bpm-badge">= BPM <strong>${formatNumber(seg.jumps * 2)}</strong></span>
      </div>
      <div class="segment-mode-row">
        <span class="mode-label">${t('seg-mode')}</span>
        <div class="mode-toggle">
          <button class="mode-btn ${seg.mode === 'step' ? 'active' : ''}"
                  data-idx="${i}" data-mode="step">${t('btn-step')}</button>
          <button class="mode-btn ${seg.mode === 'gradient' ? 'active' : ''}"
                  data-idx="${i}" data-mode="gradient">${t('btn-gradient')}</button>
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
      const v   = normalizeJumps(inp.value);
      appState.segments[idx].jumps = v;
      renderSegments();
      renderTimeline();
      renderCanvas();
      saveSettings();
    })
  );
  container.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      appState.segments[+btn.dataset.idx].mode = btn.dataset.mode;
      renderSegments();
      renderTimeline();
      renderCanvas();
      saveSettings();
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
    div.textContent  = dur > 0 ? `${formatNumber(seg.jumps)}回` : '';
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
let _awaitingStart  = false;
let _playRunId = 0;
let _introTimer = null;

function syncEditingLock() {
  const locked = appState.playState === 'playing';
  document.querySelectorAll('main input, main textarea, main button').forEach(el => {
    if (el.id === 'playBtn' || el.id === 'stopBtn') return;
    if (locked) {
      if (!el.hasAttribute('data-playback-disabled')) {
        el.dataset.playbackDisabled = String(el.disabled);
      }
      el.disabled = true;
    } else if (el.hasAttribute('data-playback-disabled')) {
      el.disabled = el.dataset.playbackDisabled === 'true';
      delete el.dataset.playbackDisabled;
    }
  });
}
let _iosUnlocked    = false;

// Plays a silent <audio> element so iOS sets AudioSession to 'playback' category,
// which makes Web Audio bypass the hardware silent/ringer switch.
function _unlockIOSAudioSession() {
  if (_iosUnlocked) return Promise.resolve();
  try {
    // Minimal valid WAV: 1 silent sample at 22050 Hz mono 16-bit
    const b = new Uint8Array([
      0x52,0x49,0x46,0x46,0x26,0x00,0x00,0x00,0x57,0x41,0x56,0x45,
      0x66,0x6D,0x74,0x20,0x10,0x00,0x00,0x00,0x01,0x00,0x01,0x00,
      0x22,0x56,0x00,0x00,0x44,0xAC,0x00,0x00,0x02,0x00,0x10,0x00,
      0x64,0x61,0x74,0x61,0x02,0x00,0x00,0x00,0x00,0x00,
    ]);
    const url = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    const a   = new Audio(url);
    a.muted = false;
    a.volume = 0.01;
    return a.play()
      .then(() => { _iosUnlocked = true; })
      .catch(() => {})
      .finally(() => URL.revokeObjectURL(url));
  } catch (_) {
    return Promise.resolve();
  }
}

function onPlay() {
  if (appState.playState === 'playing') return;
  // Both of these must run synchronously within the user gesture:
  // 1) <audio> playback → changes iOS AudioSession to 'playback' (bypasses silent switch)
  // 2) AudioContext creation/resume → unlocks Web Audio on iOS/Android
  _unlockIOSAudioSession();
  metronome._ensureCtx();
  warmupSpeech();
  appState.playState = 'playing';
  const runId = ++_playRunId;
  _awaitingStart = true;
  syncEditingLock();

  const playhead = document.getElementById('playhead');
  playhead.style.left = '0%';
  playhead.hidden     = false;

  document.getElementById('playInfo').hidden  = false;
  document.getElementById('playBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;

  function beginMetronome() {
    if (!_awaitingStart || runId !== _playRunId) return;
    clearTimeout(_introTimer);
    _introTimer = null;
    _awaitingStart = false;
    metronome.start(appState, onPlayEnd).then(() => {
      if (runId === _playRunId && appState.playState === 'playing') startRAF();
    }).catch(error => {
      if (runId !== _playRunId) return;
      console.error('Playback failed.', error);
      onStop();
    });
  }

  const text = (appState.announcementText || '').trim();
  if (text && appState.toggles.announcement && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = 'en-US';
    u.rate  = 0.95;
    const fallbackMs = Math.min(6000, Math.max(1200, text.length * 90));
    _introTimer = setTimeout(beginMetronome, fallbackMs);
    const finishIntro = () => {
      if (runId !== _playRunId) return;
      clearTimeout(_introTimer);
      beginMetronome();
    };
    u.onend = finishIntro;
    u.onerror = finishIntro;
    window.speechSynthesis.speak(u);
  } else {
    beginMetronome();
  }
}

function onStop() {
  if (appState.playState === 'stopped') return;
  _awaitingStart = false;
  _clearSpeechTimers();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  metronome.stop();
  onPlayEnd();
}

function onPlayEnd() {
  if (appState.playState === 'stopped') return;
  appState.playState = 'stopped';
  _playRunId++;
  _awaitingStart = false;
  clearTimeout(_introTimer);
  _introTimer = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  syncEditingLock();
  stopRAF();
  renderCanvas();

  document.getElementById('playhead').hidden  = true;
  document.getElementById('playInfo').hidden  = true;
  document.getElementById('playBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;

}

function syncControls() {
  const totalSecEl = document.getElementById('totalSec');
  if (!totalSecEl) return;
  totalSecEl.value = appState.totalSec;
  document.getElementById('announcementText').value = appState.announcementText;
  document.getElementById('countdownSec').value = appState.countdownSec;
  document.getElementById('togAnnouncement').checked = appState.toggles.announcement;
  document.getElementById('togCountdown').checked = appState.toggles.countdown;
  document.getElementById('togBeepStart').checked = appState.toggles.beepStart;
  document.getElementById('togBeepTransition').checked = appState.toggles.beepTransition;
  document.getElementById('togBeepEnd').checked = appState.toggles.beepEnd;
  document.getElementById('togVoiceCount').checked = appState.toggles.voiceCount;
  document.getElementById('togVoiceTime').checked = appState.toggles.voiceTime;

  document.querySelectorAll('input[name="clickSound"]').forEach(r => {
    r.checked = r.value === appState.clickSound;
  });

  const beepSlider = document.getElementById('beepGainSlider');
  const beepValEl  = document.getElementById('beepGainVal');
  beepSlider.value = appState.beepGain;
  beepValEl.textContent = '×' + appState.beepGain.toFixed(1);
}

function showSettingsStatus(message, isError = false) {
  const status = document.getElementById('settingsStatus');
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
  clearTimeout(showSettingsStatus._timer);
  showSettingsStatus._timer = setTimeout(() => { status.hidden = true; }, 3500);
}

async function onCopySettings() {
  const code = getSettingsCode();
  const out = document.getElementById('settingsCode');
  out.value = code;
  out.select();

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      document.execCommand('copy');
    }
    showSettingsStatus(t('settings-copy-ok'));
  } catch (e) {
    showSettingsStatus(t('settings-copy-manual'));
  }
}

function onImportSettings() {
  const code = document.getElementById('settingsCode').value;
  try {
    applySettings(_decodeSettingsCode(code));
    showSettingsStatus(t('settings-import-ok'));
  } catch (e) {
    console.warn(e);
    showSettingsStatus(t('settings-import-error'), true);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  render();
  syncControls();

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
    saveSettings();
  });

  // Countdown duration (integer seconds)
  document.getElementById('countdownSec').addEventListener('change', e => {
    const v = Math.max(0, Math.min(10, Math.round(parseFloat(e.target.value) || 0)));
    appState.countdownSec = v;
    e.target.value = v;
    saveSettings();
  });

  // Time announcement add
  document.getElementById('addTimeAnnBtn').addEventListener('click', addTimeAnn);

  // Toggles
  document.getElementById('togAnnouncement').addEventListener('change', e => {
    appState.toggles.announcement = e.target.checked;
    saveSettings();
  });
  document.getElementById('togCountdown').addEventListener('change', e => {
    appState.toggles.countdown = e.target.checked;
    saveSettings();
  });
  document.getElementById('togBeepStart').addEventListener('change', e => {
    appState.toggles.beepStart = e.target.checked;
    saveSettings();
  });
  document.getElementById('togBeepTransition').addEventListener('change', e => {
    appState.toggles.beepTransition = e.target.checked;
    saveSettings();
  });
  document.getElementById('togBeepEnd').addEventListener('change', e => {
    appState.toggles.beepEnd = e.target.checked;
    saveSettings();
  });
  document.getElementById('togVoiceCount').addEventListener('change', e => {
    appState.toggles.voiceCount = e.target.checked;
    saveSettings();
  });
  document.getElementById('togVoiceTime').addEventListener('change', e => {
    appState.toggles.voiceTime = e.target.checked;
    saveSettings();
  });

  // Click sound
  document.querySelectorAll('input[name="clickSound"]').forEach(r =>
    r.addEventListener('change', () => {
      appState.clickSound = r.value;
      saveSettings();
    })
  );

  // Language toggle
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // BEEP gain slider
  const beepSlider = document.getElementById('beepGainSlider');
  const beepValEl  = document.getElementById('beepGainVal');
  beepSlider.addEventListener('input', () => {
    const v = parseFloat(beepSlider.value);
    appState.beepGain = v;
    beepValEl.textContent = '×' + v.toFixed(1);
    saveSettings();
  });

  document.getElementById('copySettingsBtn').addEventListener('click', onCopySettings);
  document.getElementById('importSettingsBtn').addEventListener('click', onImportSettings);

  // Playback
  document.getElementById('playBtn').addEventListener('click', onPlay);
  document.getElementById('stopBtn').addEventListener('click', onStop);

  // Redraw canvas on window resize
  window.addEventListener('resize', () => renderCanvas());

  // Resume AudioContext when app returns from background (required on iOS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && metronome.audioCtx) {
      metronome.audioCtx.resume();
    }
  });
});
