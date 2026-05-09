function _scheduleCountdownTone(ctx, time, freq) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.65, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  osc.start(time);
  osc.stop(time + 0.20);
}

// ── Real-time recording via tab audio capture (Chrome 107+) ──────────────────
// Captures everything: metronome, beeps, and all TTS voice announcements.
async function _exportRealtime(state) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    preferCurrentTab: true,
    audio: true,
    video: { width: 1, height: 1 },  // required by most browsers; stopped immediately
  });
  stream.getVideoTracks().forEach(t => t.stop());

  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(t => t.stop());
    const e = new Error('タブの音声が取得できませんでした');
    e.name = 'NoAudio';
    throw e;
  }

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks   = [];
  recorder.ondataavailable = e => e.data?.size > 0 && chunks.push(e.data);

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const ext  = mimeType.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = _filename(state).replace('.mp3', `.${ext}`);
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    };
    recorder.onerror = e => reject(e.error || new Error('録音エラー'));

    recorder.start(200);

    // Wait for MediaRecorder to be fully started, then begin playback
    setTimeout(() => {
      window.__exportDoneHook = () => {
        window.__exportDoneHook = null;
        // Extra time to capture the end beep before stopping
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 700);
      };
      onPlay();
    }, 300);
  });
}

// ── Offline MP3 rendering (no TTS voice; fallback for non-Chrome) ─────────────
async function _exportOffline(state) {
  const SR    = 44100;
  const { toggles, countdownSec = 3 } = state;
  const cdSec = (toggles.countdown && countdownSec > 0)
                ? Math.max(0, Math.round(countdownSec)) : 0;
  const totalSamples = Math.ceil((cdSec + state.totalSec + 0.5) * SR);
  const offCtx = new OfflineAudioContext(1, totalSamples, SR);

  // Countdown tones substitute for TTS in the offline path
  if (cdSec > 0 && toggles.countdown) {
    const count = Math.round(countdownSec);
    for (let i = count; i >= 1; i--) {
      const t = cdSec - i;
      if (t >= 0) _scheduleCountdownTone(offCtx, t, i === 1 ? 880 : 660);
    }
  }

  _renderBeatsOffline(offCtx, state, cdSec);

  const buffer      = await offCtx.startRendering();
  const channelData = buffer.getChannelData(0);

  const pcm = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    pcm[i]  = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const encoder  = new lamejs.Mp3Encoder(1, SR, 128);
  const BLOCK    = 1152;
  const mp3Parts = [];
  for (let i = 0; i < pcm.length; i += BLOCK) {
    const chunk   = pcm.subarray(i, i + BLOCK);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) mp3Parts.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) mp3Parts.push(new Uint8Array(tail));

  const blob = new Blob(mp3Parts, { type: 'audio/mpeg' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = _filename(state);
  a.click();
  URL.revokeObjectURL(url);
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function exportMP3(state) {
  // Prefer real-time capture (includes TTS); fall back to offline MP3
  if (navigator.mediaDevices?.getDisplayMedia) {
    try {
      return await _exportRealtime(state);
    } catch (err) {
      // User cancelled → propagate so onExport can show a friendly message
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') throw err;
      // NoAudio or unsupported config → fall through to offline
    }
  }
  return _exportOffline(state);
}

// ── Offline beat scheduler ────────────────────────────────────────────────────
function _renderBeatsOffline(ctx, state, cdSec) {
  const { segments, totalSec, clickSound, toggles } = state;
  const maxT = ctx.length / ctx.sampleRate;

  let t         = cdSec;
  let segIdx    = 0;
  let beatCount = 0;

  while (true) {
    const metElapsed = t - cdSec;

    if (metElapsed >= totalSec) {
      if (toggles.beepEnd) {
        const endT = cdSec + totalSec;
        if (endT < maxT) scheduleBeep(ctx, endT);
      }
      break;
    }

    const prevIdx = segIdx;
    while (
      segIdx < segments.length - 1 &&
      metElapsed >= segments[segIdx + 1].startSec
    ) {
      segIdx++;
    }

    const isFirst      = beatCount === 0;
    const isTransition = !isFirst && segIdx !== prevIdx;

    if (t < maxT) {
      if (isFirst) {
        toggles.beepStart
          ? scheduleBeep(ctx, t)
          : scheduleClick(ctx, t, clickSound);
      } else if (isTransition) {
        toggles.beepTransition
          ? scheduleBeep(ctx, t)
          : scheduleClick(ctx, t, clickSound);
      } else {
        scheduleClick(ctx, t, clickSound);
      }
    }

    beatCount++;

    const seg = segments[segIdx];
    if (seg.mode === 'gradient' && segIdx < segments.length - 1) {
      const nextSeg  = segments[segIdx + 1];
      const sBPM     = seg.jumps * 2;
      const eBPM     = nextSeg.jumps * 2;
      const segDur   = seg.endSec - seg.startSec;
      const progress = segDur > 0 ? Math.min((metElapsed - seg.startSec) / segDur, 1) : 0;
      const bpm      = sBPM + (eBPM - sBPM) * progress;
      t += 60 / Math.max(bpm, 1);
    } else {
      t += 60 / (seg.jumps * 2);
    }
  }
}

function _filename(state) {
  const jumps  = state.segments.map(s => s.jumps);
  const raw    = (state.announcementText || '').trim();
  const title  = raw
    .replace(/[^\w\s぀-ヿ一-鿿]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 24);
  const prefix = title ? title + '_' : '';
  return `${prefix}${state.totalSec}sec_${Math.min(...jumps)}-${Math.max(...jumps)}.mp3`;
}
