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

### 解決策（2段階）
1. `_unlockIOSAudioSession()`：`<audio>` 要素でサイレントWAVを再生しiOSのAudioSessionカテゴリを `ambient` → `playback` に昇格させる（詳細は #13 参照）
2. `metronome._ensureCtx()`：AudioContextを生成し `resume()` を呼ぶ。`warmupSpeech()` でSpeechSynthesisも初期化する

これら**3つをすべてユーザー操作のイベントハンドラ内で同期的に呼ぶ**ことが重要。

```js
// app.js onPlay() の冒頭
_unlockIOSAudioSession();  // <audio> playback → AudioSession昇格
metronome._ensureCtx();    // AudioContext 生成 + resume
warmupSpeech();            // SpeechSynthesis 初期化
```

`MetronomeEngine._ensureCtx()` でも `state === 'suspended'` なら `resume()` を呼んでいるが、
ユーザー操作の文脈外では効かないため、onPlay冒頭での同期呼び出しが必要。

---

## 4. TTS（Web Speech API）とメトロノームの連携

### 問題
開始アナウンス（自由記述テキスト）を読み上げてから、カウントダウン→メトロノームへ移行したい。
しかし `speechSynthesis.speak()` は非同期で、読み終わるまでの時間が可変。

### 解決策：`onend` コールバック + fallbackタイマー でチェーン
```js
// app.js onPlay()
let _awaitingStart = false;

function beginMetronome() {
  if (!_awaitingStart) return; // 二重呼び出し防止
  _awaitingStart = false;
  metronome.start(appState, onPlayEnd).then(() => {
    if (appState.playState === 'playing') startRAF();
  });
}

const u = new SpeechSynthesisUtterance(text);
u.lang  = 'en-US';
u.rate  = 0.95;
const fallbackMs = Math.min(6000, Math.max(1200, text.length * 90));
const startTimer = setTimeout(beginMetronome, fallbackMs); // フォールバック
const finishIntro = () => { clearTimeout(startTimer); beginMetronome(); };
u.onend  = finishIntro;
u.onerror = finishIntro;
window.speechSynthesis.speak(u);
```

- `_awaitingStart` フラグで「アナウンス中だが停止ボタンが押されたケース」を処理
- `onStop()` で `_awaitingStart = false` にすることで、`beginMetronome` が呼ばれても無視される
- フォールバックタイマー：ネットワーク遅延や環境差で `onend` が呼ばれないケースに対応

### 停止時のTTSキャンセル
```js
// onStop()
_clearSpeechTimers();                  // setTimeout音声タイマーを全消去
window.speechSynthesis.cancel();       // 読み上げ中のTTSも即座にキャンセル
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
// カウントダウン発話は startAt + timeAt - SPEECH_LEAD に setTimeout
fireAt = startAt + ev.timeAt - SPEECH_LEAD;
```

- カウントダウン「three」は `timeAt = -3`、実際には `startAt - 3.2` 秒に発話
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
`_scheduleSpeechWithTimers()` でそれぞれを `setTimeout` でスケジュールする。

```js
for (let i = count; i >= 1; i--) {
  _speechEvents.push({ timeAt: -i, text: numToWords(i), priority: 0 });
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

## 11. 音声スケジューリング: RAFループ → setTimeout方式への移行

### 経緯
初期実装では `requestAnimationFrame` ループ内で `elapsed >= ev.timeAt - SPEECH_LEAD` を毎フレーム確認し、
条件が満たされたら `speechSynthesis.speak()` を呼んでいた。

### 問題
- iOSはバックグラウンド・画面オフ時に RAF が止まる → カウントダウンが途中で止まる
- Android でも `speak()` をRAF内から呼ぶと発話がブロックされることがある（ブラウザのセキュリティ上の制約）
- RAFが60fps動作してもsetTimeoutのように正確なタイミングにはならない

### 解決策：全イベントをsetTimeoutで一括スケジュール
```js
// app.js _scheduleSpeechWithTimers()
// startRAF() 呼び出し直後に全 speechEvents を setTimeout で登録
_speechEvents.forEach(ev => {
  const delayMs = Math.max(0, (fireAt - now) * 1000);
  const t = setTimeout(() => {
    if (appState.playState === 'playing') speak(ev.text);
  }, delayMs);
  _speechTimers.push(t);
});
```

- `_speechTimers` 配列にすべての `setTimeout` IDを保存
- 停止時に `_clearSpeechTimers()` で一括キャンセル
- RAFループは再生位置（playhead）と再生情報の表示更新のみに専念

### 注意
`setTimeout` の精度は `setInterval` と同様にズレるが、Web Speech APIは自前で遅延調整するため
±50ms程度のズレは許容範囲。BEEPはルックアヘッドスケジューラーで精確に制御されるため問題なし。

---

## 12. モバイル音量：コンプレッサー構成とゲイン設定

### 問題
スマートフォンでの再生音量がPCと比べて小さい。
モバイルOSは最終出力をハードウェアレベルでクリップ（0dBFS制限）するため、
単純にゲインを上げるだけではPC対比で相対的に小さく聞こえる。

### 試行錯誤
**間違ったアプローチ（ハードリミッター化）：**
```js
// 誤り: threshold=-6dB, ratio=20:1 にするとコンプレッサーが音を縮める方向に働く
// 出力振幅が下がり、masterOut gain=1.0 では音が小さくなった
```

**正しいアプローチ（heavy compression + high makeup gain）：**
```js
// 個別ゲインを高め（2.5〜3.0）に設定してコンプレッサーへ強い信号を送る
// コンプレッサーは波形のダイナミクスを均す
// makeup gainで大幅に持ち上げる
this._compressor.threshold.value = -20; // dB
this._compressor.ratio.value     = 8;   // 8:1 で圧縮
this._masterOut.gain.value       = 6.0; // makeup gain
```

### 結果
- スマートフォンでの音量が向上し、PCと聴感上ほぼ同等になった
- コンプレッサーがダイナミクスを均すため、ビートが「揃って聞こえる」効果もある

### 教訓
- モバイルでの音量問題は「いかに歪みなく最大出力に近づけるか」という問題
- コンプレッサーは「リミッター」ではなく「平均音量を上げる道具」として使う
- 個別ゲイン→コンプレッサー→makeup gainの多段構成が有効

---

## 13. iOSのオーディオセッション解除（_unlockIOSAudioSession）

### 問題
iOSは Web Audio API を「ambient（サイレントスイッチ対象）」カテゴリで実行する。
つまりサイレントモードや端末の音量が低い場合、音が全く聞こえないか非常に小さい。

Web Audio APIの `resume()` を呼んだだけでは AudioSession のカテゴリは変わらない。

また、初回のビート音が小さい問題もあった。これはAudioSessionが確立するまでの遅延が原因。

### 解決策：`<audio>` 要素でサイレントWAVを再生
iOSは `<audio>` 要素が実際に再生を開始すると AudioSession を `playback` カテゴリに設定する。
この状態では Web Audio API もサイレントスイッチを無視して大音量で再生できる。

```js
function _unlockIOSAudioSession() {
  if (_iosUnlocked) return Promise.resolve();
  // 最小有効WAV: 22050Hz モノラル 16bit 1サンプル = 46バイト
  const b = new Uint8Array([
    0x52,0x49,0x46,0x46,0x26,0x00,0x00,0x00,0x57,0x41,0x56,0x45,
    0x66,0x6D,0x74,0x20,0x10,0x00,0x00,0x00,0x01,0x00,0x01,0x00,
    0x22,0x56,0x00,0x00,0x44,0xAC,0x00,0x00,0x02,0x00,0x10,0x00,
    0x64,0x61,0x74,0x61,0x02,0x00,0x00,0x00,0x00,0x00,
  ]);
  const url = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  const a   = new Audio(url);
  a.volume  = 0.01; // 無音ではなく超小音量（0だと再生と見なされない可能性）
  return a.play()
    .then(() => { _iosUnlocked = true; })
    .catch(() => {})
    .finally(() => URL.revokeObjectURL(url));
}
```

**重要：ユーザー操作（タップ）の同期的なイベントハンドラ内で呼ぶこと。**
`await` を使うと非同期になりiOSのユーザー操作制限に引っかかる可能性がある。

### `_playSilentBuffer()` との違い
- `_playSilentBuffer()`: `AudioContext` のバッファソースを使う。AudioContextは解除できるがAudioSessionカテゴリは変えられない
- `_unlockIOSAudioSession()`: `<audio>` 要素を使う。iOSのネイティブAudioSession設定を変えられる

両方を組み合わせることで確実にiOSの音声を解除できる。

---

## 14. _playWarmupTone() の廃止（ピットフォール）

### 経緯
iOSで初回ビートが小さい問題の解決策として `_playWarmupTone()` を追加した。
これは `metronome._ensureCtx()` の `.then()` 内で 880Hz サイン波を20ms間だけ超小音量で再生するものだった。

```js
// 追加・削除したコード（参考のみ）
_playWarmupTone() {
  const ctx  = this.audioCtx;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(this.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.01, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.20);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.20);
}
```

### 問題：2回呼ばれる
`_ensureCtx()` は `onPlay()` から直接1回、`metronome.start()` 内部から1回の**計2回**呼ばれる構造だった。

```
onPlay() → metronome._ensureCtx()  → _playWarmupTone() [1回目: 再生直後]
onPlay() → metronome.start()
            → _ensureCtx()         → _playWarmupTone() [2回目: 約150ms後]
```

2回目のウォームアップトーンが TTS 「Three, Two」の読み上げ中と時間的に重なり、
**カウントダウン中にメトロノーム音のような880Hzの音が聞こえる**という現象が発生した。

### 解決策
`_playWarmupTone()` を完全に削除。
iOS AudioSession の問題は `_unlockIOSAudioSession()` と `_playSilentBuffer()` の組み合わせで対処する。

### 教訓
- ウォームアップ処理を追加するときは、その関数が何回・いつ呼ばれるかを必ず確認する
- Web Audio API の OscillatorNode は `gain=0.01` でも CompressorNode + makeupGain=6.0 の構成では聴こえる音量になりうる
- 問題を再現させるには「カウントダウン3秒ありで再生」するテストが有効

---

## 15. 言語トグルのピルアニメーション：等幅ボタン制約

### 問題
CSS言語切替トグルは「白いピル（`.lang-pill`）がスライドする」デザイン。
```css
.lang-switch.en .lang-pill {
  transform: translateX(100%);
}
```
この `100%` はピル要素の幅（= ボタン1つ分の幅）を表す。

当初 `.lang-btn { flex: 1 }` としていたため、「日本語」ボタン（min-contentが広い）と
「EN」ボタンの幅が異なり、ピルが正しい位置にずれる問題が起きた。

### 解決策
ボタンを等幅に固定する：
```css
.lang-btn {
  flex: none;
  width: 56px;
  padding: 4px 0;
}
```

`width: 56px` で両ボタンの幅を揃えることで、`translateX(100%)` が正確に「EN側」へスライドするようになる。

### 教訓
スライドするピル/インジケーターUIは、対象ボタンが等幅でないと `50%` や `100%` 計算がずれる。
`flex: none; width: XX` で明示的に固定するか、Gridで均等分割する。

---

*作成日: 2026-05-09*  
*更新日: 2026-05-10（#11〜#15追加: setTimeout音声スケジュール・コンプレッサー設計・iOS AudioSession・warmupTone廃止・ピル等幅）*
