async function exportMP3(state) {
  const SR    = 44100;
  const { toggles, countdownSec = 3 } = state;
  // Countdown is silence in MP3 (speech synthesis can't be embedded)
  const cdSec = (toggles.countdown && countdownSec > 0)
                ? Math.max(0, Math.round(countdownSec)) : 0;
  const totalSamples = Math.ceil((cdSec + state.totalSec + 0.5) * SR);
  const offCtx = new OfflineAudioContext(1, totalSamples, SR);

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

function _renderBeatsOffline(ctx, state, cdSec) {
  const { segments, totalSec, clickSound, toggles } = state;
  const maxT = ctx.length / ctx.sampleRate;

  // Beats start at cdSec in the offline context
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
  const jumps = state.segments.map(s => s.jumps);
  return `metronome_${state.totalSec}sec_${Math.min(...jumps)}-${Math.max(...jumps)}.mp3`;
}
