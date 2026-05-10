// ── BEEP signal ───────────────────────────────────────────────────────────────
function scheduleBeep(ctx, time, dest, beepGain) {
  dest     = dest     || ctx.destination;
  beepGain = beepGain != null ? beepGain : 1.8;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(dest);
  osc.type = 'square';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(beepGain, time);
  gain.gain.setValueAtTime(beepGain, time + 0.10);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
  osc.start(time);
  osc.stop(time + 0.25);
}

// ── Regular click sounds ──────────────────────────────────────────────────────
function scheduleClick(ctx, time, type, dest) {
  dest = dest || ctx.destination;
  switch (type) {
    case 'marimba':  _clickMarimba(ctx, time, dest);  break;
    case 'simple':   _clickSimple(ctx, time, dest);   break;
    default:         _clickElectronic(ctx, time, dest);
  }
}

function _clickElectronic(ctx, time, dest) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(dest);
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.8, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.start(time);
  osc.stop(time + 0.06);
}

function _clickMarimba(ctx, time, dest) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(dest);
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.7, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
  osc.start(time);
  osc.stop(time + 0.30);
}

function _clickSimple(ctx, time, dest) {
  const dur  = 0.018;
  const sz   = Math.ceil(ctx.sampleRate * dur);
  const buf  = ctx.createBuffer(1, sz, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < sz; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / sz);
  const src  = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buf;
  src.connect(gain);
  gain.connect(dest);
  gain.gain.setValueAtTime(0.6, time);
  src.start(time);
}

// ── Metronome engine ──────────────────────────────────────────────────────────
class MetronomeEngine {
  constructor() {
    this.audioCtx        = null;
    this.schedulerTimer  = null;
    this.nextBeatTime    = 0;
    this.startAudioTime  = 0;
    this.state           = null;
    this.onFinish        = null;
    this._segIdx         = 0;
    this._segStartTime   = 0;
    this._stopped        = true;
    this._beatCount      = 0;
    this._endScheduled   = false;
    this._compressor     = null;
    this._masterOut      = null;
  }

  // All sounds connect here; routes through compressor → masterOut → hardware
  get destination() {
    return this._compressor || (this.audioCtx && this.audioCtx.destination);
  }

  _setupCompressor() {
    const ctx            = this.audioCtx;
    this._compressor     = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -20;
    this._compressor.knee.value      = 4;
    this._compressor.ratio.value     = 8;
    this._compressor.attack.value    = 0.003;
    this._compressor.release.value   = 0.15;
    this._masterOut      = ctx.createGain();
    this._masterOut.gain.value = 6.0; // makeup gain after compression
    this._compressor.connect(this._masterOut);
    this._masterOut.connect(ctx.destination);
  }

  _ensureCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._setupCompressor();
    }
    this._playSilentBuffer();

    const resumePromise = this.audioCtx.state === 'suspended'
      ? this.audioCtx.resume().catch(() => {})
      : Promise.resolve();
    const timeout = new Promise(resolve => setTimeout(resolve, 150));

    return Promise.race([resumePromise, timeout]).then(() => {
      this._playSilentBuffer();
      return this.audioCtx;
    });
  }

  // Play a silent 1-sample buffer to unlock audio hardware on iOS/Android.
  // This should be triggered from the user's tap/click path.
  _playSilentBuffer() {
    if (!this.audioCtx) return;
    try {
      const buf = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate);
      const src = this.audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.audioCtx.destination);
      src.start(0);
    } catch (_) {}
  }

  start(state, onFinish) {
    this.state         = state;
    this.onFinish      = onFinish;
    this._stopped      = false;
    this.startAudioTime = 0;
    this._segIdx       = 0;
    this._beatCount    = 0;
    this._endScheduled = false;

    const doSchedule = () => {
      const { toggles, countdownSec = 3 } = state;
      const cdSec = (toggles.countdown && countdownSec > 0)
                    ? Math.max(0, Math.round(countdownSec)) : 0;

      this.startAudioTime = this.audioCtx.currentTime + 0.1 + cdSec;
      this._segStartTime  = this.startAudioTime;
      this.nextBeatTime   = this.startAudioTime;

      this._scheduleLoop();
      this.schedulerTimer = setInterval(() => this._scheduleLoop(), 25);
    };

    return this._ensureCtx().then(() => {
      if (!this._stopped) doSchedule();
    });
  }

  stop() {
    this._stopped = true;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  // Negative during countdown, 0+ during playback
  getElapsed() {
    if (!this.audioCtx || !this.startAudioTime) return 0;
    return this.audioCtx.currentTime - this.startAudioTime;
  }

  _scheduleLoop() {
    if (this._stopped) return;

    const LOOKAHEAD = 0.1;
    const { segments, totalSec, clickSound, toggles, beepGain } = this.state;
    const dest = this.destination;
    const gain = beepGain != null ? beepGain : 1.8;

    while (this.nextBeatTime < this.audioCtx.currentTime + LOOKAHEAD) {
      const elapsed = this.nextBeatTime - this.startAudioTime;

      // ── End ──
      if (elapsed >= totalSec) {
        if (!this._endScheduled) {
          this._endScheduled = true;
          const beepT = Math.max(this.startAudioTime + totalSec, this.audioCtx.currentTime + 0.02);
          if (toggles.beepEnd) scheduleBeep(this.audioCtx, beepT, dest, gain);
          const delayMs = Math.max(0, (beepT - this.audioCtx.currentTime + 0.35) * 1000);
          this.stop();
          if (this.onFinish) setTimeout(this.onFinish, delayMs);
        }
        return;
      }

      // ── Advance segment ──
      const prevIdx = this._segIdx;
      while (
        this._segIdx < segments.length - 1 &&
        elapsed >= segments[this._segIdx + 1].startSec
      ) {
        this._segIdx++;
        this._segStartTime = this.startAudioTime + segments[this._segIdx].startSec;
      }

      const isFirstBeat  = this._beatCount === 0;
      const isTransition = !isFirstBeat && this._segIdx !== prevIdx;

      if (isFirstBeat) {
        toggles.beepStart
          ? scheduleBeep(this.audioCtx, this.nextBeatTime, dest, gain)
          : scheduleClick(this.audioCtx, this.nextBeatTime, clickSound, dest);
      } else if (isTransition) {
        toggles.beepTransition
          ? scheduleBeep(this.audioCtx, this.nextBeatTime, dest, gain)
          : scheduleClick(this.audioCtx, this.nextBeatTime, clickSound, dest);
      } else {
        scheduleClick(this.audioCtx, this.nextBeatTime, clickSound, dest);
      }

      this._beatCount++;
      this.nextBeatTime += this._intervalAt(elapsed);
    }
  }

  _intervalAt(elapsed) {
    const { segments } = this.state;
    const seg = segments[this._segIdx];
    if (seg.mode === 'gradient' && this._segIdx < segments.length - 1) {
      const nextSeg    = segments[this._segIdx + 1];
      const startBPM   = seg.jumps * 2;
      const endBPM     = nextSeg.jumps * 2;
      const segDur     = seg.endSec - seg.startSec;
      const segElapsed = elapsed - seg.startSec;
      const progress   = segDur > 0 ? Math.min(segElapsed / segDur, 1) : 0;
      const bpm        = startBPM + (endBPM - startBPM) * progress;
      return 60 / Math.max(bpm, 1);
    }
    return 60 / (seg.jumps * 2);
  }
}

const metronome = new MetronomeEngine();
