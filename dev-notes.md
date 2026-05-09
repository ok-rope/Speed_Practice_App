# 開発ノート - なわとびメトロノーム

開発上の工夫・問題と解決策・将来の開発で注意すべき点をまとめる。

---

## 1. Web Audio API ルックアヘッドスケジューラー

### 概要
ブラウザのメインスレッドは `setTimeout` / `setInterval` の精度が低い（数ms〜数十msのズレ）。
これをそのままメトロノームのタイミング制御に使うと、ビートが不規則になる。

### 解決策：ルックアヘッドスケジューリング
`AudioContext.currentTime` は高精度クロック（サンプル単位）。
音を「今鳴らす」のではなく、「100ms先の音を今のうちに予約する」方式にする。

```js
// metronome.js
const LOOKAHEAD = 0.1; // 100ms先まで予約
// 25ms間隔でスケジューラーを呼び出し
this.schedulerTimer = setInterval(() => this._scheduleLoop(), 25);

// _scheduleLoop の中で：
while (this.nextBeatTime < this.audioCtx.currentTime + LOOKAHEAD) {
  scheduleClick(this.audioCtx, this.nextBeatTime, clickSound);
  this.nextBeatTime += interval;
}
```

**仕組み：**
- `setInterval` は25msに一度呼ばれるが、多少遅れても問題ない
- Web Audio APIに「この時刻に鳴らせ」と予約するので、呼び出しタイミングのズレはキャンセルされる
- ビートの精度は `AudioContext.currentTime` の精度（サンプル単位）に依存する

### 注意点
- `scheduleBeep` / `scheduleClick` に渡す `time` は必ず **未来の時刻** でなければならない
- 過去の時刻を渡してもエラーにはならないが、音が鳴らない（→ 後述のBEEP音バグ参照）

---

## 2. グラデーションモードの実装

### 概要
セグメントをまたぐBPMの線形補間を「ビートごとに間隔を再計算」する方式で実現。

### 実装
```js
// metronome.js _intervalAt()
if (seg.mode === 'gradient' && segIdx < segments.length - 1) {
  const startBPM   = seg.jumps * 2;
  const endBPM     = segments[segIdx + 1].jumps * 2;
  const segDur     = seg.endSec - seg.startSec;
  const segElapsed = elapsed - seg.startSec;
  const progress   = segDur > 0 ? Math.min(segElapsed / segDur, 1) : 0;
  const bpm        = startBPM + (endBPM - startBPM) * progress;
  return 60 / Math.max(bpm, 1);
}
```

**ポイント：**
- 間隔を固定するのではなく、毎ビート計算し直すことで滑らかに変化
- `progress` を `Math.min(..., 1)` でクランプ → セグメント境界を超えても破綻しない
- `Math.max(bpm, 1)` → BPMがゼロや負になって `60/bpm` が無限大になるのを防ぐ

---

## 3. iOS Safari での AudioContext 停止問題

### 問題
iOSはユーザー操作（タップ）なしに音声を再生させない。
`new AudioContext()` しただけでは `state === 'suspended'` のままになることがある。

### 解決策
再生ボタンのタップイベント内（ユーザー操作の文脈）で `warmupSpeech()` を呼び出す。
Web Speech APIのダミー発話がAudioContextのresumeをトリガーする。

```js
// app.js
function warmupSpeech() {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0.01;
  u.rate   = 10;
  window.speechSynthesis.speak(u);
}

// onPlay() の冒頭で必ず呼ぶ
function onPlay() {
  warmupSpeech(); // ← ユーザー操作の文脈でiOSのAudioContextをwake up
  ...
}
```

`MetronomeEngine._ensureCtx()` でも `audioCtx.state === 'suspended'` なら `resume()` を呼んでいるが、
ユーザー操作の文脈外では効かないため warmupSpeech が必要。

---

## 4. TTS（Web Speech API）とメトロノームの連携

### 問題
開始アナウンス（自由記述テキスト）を読み上げてから、カウントダウン→メトロノームへ移行したい。
しかし `speechSynthesis.speak()` は非同期で、読み終わるまでの時間が可変。

### 解決策：`onend` コールバックでチェーン
```js
// app.js onPlay()
let _awaitingStart = false;

function beginMetronome() {
  if (!_awaitingStart) return; // 二重呼び出し防止
  _awaitingStart = false;
  metronome.start(appState, onPlayEnd);
  startRAF();
}

const u = new SpeechSynthesisUtterance(text);
u.lang  = 'en-US';
u.rate  = 0.95;
u.onend  = beginMetronome;
u.onerror = () => { if (_awaitingStart) beginMetronome(); }; // エラー時も続行
window.speechSynthesis.speak(u);
```

- `_awaitingStart` フラグで「アナウンス中だが停止ボタンが押されたケース」を処理
- `onStop()` で `_awaitingStart = false` にすることで、`beginMetronome` が呼ばれても無視される

### 停止時のTTSキャンセル
```js
// onStop()
if (window.speechSynthesis) window.speechSynthesis.cancel();
```

これを忘れると、停止後もTTSが読み上げ続ける。

---

## 5. TTS発話の前倒し（SPEECH_LEAD）

### 問題
`speechSynthesis.speak()` を呼んでから実際に音が出るまで100〜300ms程度のレイテンシがある（ブラウザ・環境依存）。
カウントダウン「Three, Two, One」がズレて聞こえる。

### 解決策
発話タイミングを `200ms` 前倒しにする。

```js
// app.js
const SPEECH_LEAD = 0.20; // 200ms

function checkSpeechEvents(elapsed) {
  for (const ev of _speechEvents) {
    if (!ev.fired && elapsed >= ev.timeAt - SPEECH_LEAD) {
      ev.fired = true;
      speak(ev.text);
    }
  }
}
```

- カウントダウン「three」は `timeAt = -3`、`elapsed >= -3.2` になった瞬間に発話
- SPEECH_LEAD の値は環境によって最適値が異なるため、主観的な聞こえ方で調整する

---

## 6. カウントダウン中の elapsed（負の値）

### 概要
`MetronomeEngine.getElapsed()` は `audioCtx.currentTime - startAudioTime` を返す。
`startAudioTime = audioCtx.currentTime + 0.1 + cdSec` に設定するため、カウントダウン中は elapsed が負になる。

```
cdSec = 3 の場合:
elapsed = -3.1  → カウントダウン開始直後
elapsed = -2.0  → "two" を発話するタイミング
elapsed =  0.0  → ビート開始（BEEP）
```

### 利用方法
`buildSpeechEvents()` でカウントダウン発話のイベントを `timeAt: -3, -2, -1` として登録し、
同じ `checkSpeechEvents` ループで処理する（正負両対応）。

```js
for (let i = count; i >= 1; i--) {
  _speechEvents.push({ timeAt: -i, text: numToWords(i), fired: false });
}
```

---

## 7. 終了BEEPが鳴らないバグ（解決済み）

### 症状
`togBeepEnd` をONにしていても終了時にBEEP音が鳴らない。

### 原因：過去タイムスタンプへのスケジューリング

ルックアヘッドスケジューラーの動作を詳しく追うと：

1. while ループは `nextBeatTime < currentTime + 0.1` の間ビートを処理する
2. `elapsed = nextBeatTime - startAudioTime >= totalSec` となったとき「終了」と判断
3. このとき `nextBeatTime` はすでに `totalSec` を越えている（= endT より後）
4. つまり `endT = startAudioTime + totalSec` は**過去**になっている可能性がある

**具体例（80jumps = BPM160 = 0.375秒間隔）：**
```
totalSec = 10, 最後のビート = 9.75秒, 次のビート = 10.125秒
end 検出時の currentTime ≈ 10.025秒
endT = 10.000秒 → currentTime より 25ms 過去
→ scheduleBeep(ctx, 10.000) → 音が鳴らない
```

### 解決策
`endT` を `currentTime + 20ms` 以上になるようクランプする。

```js
// metronome.js
const beepT = Math.max(
  this.startAudioTime + totalSec,
  this.audioCtx.currentTime + 0.02  // 最低でも20ms先に設定
);
if (toggles.beepEnd) scheduleBeep(this.audioCtx, beepT);
const delayMs = Math.max(0, (beepT - this.audioCtx.currentTime + 0.35) * 1000);
```

`delayMs` も同じ `beepT` を基準にすることで、UI更新（停止表示）のタイミングがBEEP音と合う。

### 教訓
- `scheduleBeep` / `scheduleClick` に過去の時刻を渡してもエラーにはならず、音だけ鳴らない（サイレントドロップ）
- スケジューラーの「終了」検出はビートが `totalSec` を超えた後なので、`startAudioTime + totalSec` はその時点でほぼ必ず過去
- 境界時刻に正確に音を鳴らすときは必ず `Math.max(..., currentTime + 小さな余白)` でクランプする

---

## 8. Canvas のHiDPI（Retina）対応

### 問題
Canvas はピクセル単位で描画するため、デバイスピクセル比（DPR）が2以上の画面（Retina等）では
ぼやけて表示される。

### 解決策
```js
const dpr = window.devicePixelRatio || 1;
canvas.width  = Math.round(displayW * dpr);
canvas.height = Math.round(displayH * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 以降の描画座標はCSS px単位で書ける
```

- `canvas.width/height` を物理ピクセルサイズにする
- `setTransform` でスケールをかけることで、描画コードは論理px（CSSピクセル）のまま書ける
- `canvas.style.width/height` はCSSで `100% / position:absolute` で管理し、JSでは触らない

---

## 9. タイムラインの統合アプローチ

### 以前の構造（2要素）
- Canvas（BPMグラフ）: タイムラインバーの上に独立して配置
- タイムラインバー（色付きセグメント）: Canvas の下

### 現在の構造（1要素にオーバーレイ）
```html
<div id="timelineBar">           <!-- 基盤：相対配置のコンテナ -->
  <div id="timelineSegs"></div>  <!-- 色付きセグメント（z-index 1） -->
  <canvas id="timelineCanvas" class="timeline-canvas-overlay"></canvas>
                                 <!-- 白ライン・ドット（z-index 5, absolute inset:0） -->
  <div id="playhead"></div>      <!-- 再生位置インジケーター（z-index 10） -->
</div>
```

**Canvas で描画するもの（シンプルに絞る）：**
- 白い折れ線（ステップ：水平、グラデーション：斜め）
- 白いドット（セグメント境界点）
- グリッド線・Y軸ラベルなし（色付きバーの文字で十分）

**省略できる理由：**
- 各セグメントに「80回」「76回」と文字が入っているので、数値ラベルは冗長
- バーの色自体がBPMを直感的に表現している
- ラインとドットでステップかグラデーションかの違いが分かれば十分

---

## 10. MP3エクスポートでのカウントダウン扱い

### 制約
TTS（Web Speech API）で読み上げる音声はブラウザの合成音であり、
PCMバッファとして取得する方法がない。よってMP3に埋め込むことは不可。

### 対処
```js
// export.js
const cdSec = (toggles.countdown && countdownSec > 0)
              ? Math.max(0, Math.round(countdownSec)) : 0;
const totalSamples = Math.ceil((cdSec + state.totalSec + 0.5) * SR);
```

- カウントダウン区間分のバッファを確保（無音）
- ビートは `cdSec` 秒後（= index `cdSec * SR`）からスケジューリング
- ダウンロードされたMP3は「無音 → ビート開始」になる。用途上問題なし

---

*作成日: 2026-05-09*
