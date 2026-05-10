# なわとびスピード練習メトロノーム - 仕様書

**バージョン：** 3.0  
**作成日：** 2026-05-09  
**更新日：** 2026-05-10（Ver0.12: クリック音5種・BEEP音量スライダー・i18n・iOS音声セッション解除・setTimeout音声スケジューリング）

---

## 1. システム概要

### 1.1 目的
なわとびスピード競技（30秒スピードなど）の練習用に、時間帯ごとに回数（BPM）を指定できるメトロノームWebアプリを提供する。

### 1.2 動作環境
| 対象 | 要件 |
|---|---|
| PC ブラウザ | Chrome 90+ / Firefox 88+ / Edge 90+ / Safari 14+ |
| スマートフォン | iOS Safari 14+ / Android Chrome 90+ |
| インターネット | 初回読み込み時のみ必要（lamejs CDN取得） |
| サーバー | 不要（静的ファイルのみ） |

---

## 2. BPM仕様

### 2.1 回数とBPMの関係
```
BPM = 回数（回/分） × 2
```

| 回数（回/分） | BPM |
|---|---|
| 90 | 180 |
| 85 | 170 |
| 80 | 160 |
| 79 | 158 |
| 78 | 156 |
| 76 | 152 |
| 70 | 140 |

### 2.2 入力範囲
| パラメータ | 最小 | 最大 | デフォルト |
|---|---|---|---|
| 回数（回/分） | 30 | 200 | 80 |
| 全体時間（秒） | 1 | 300 | 30 |
| カウントダウン（秒） | 0 | 10 | 3（整数のみ） |

---

## 3. セグメント仕様

### 3.1 データ構造
```js
Segment {
  startSec: number              // 開始時間（秒）
  endSec:   number              // 終了時間（秒）
  jumps:    number              // 回数（回/分）
  mode:     "step" | "gradient" // 再生モード
}
```

### 3.2 セグメントのルール
- セグメントは全体時間を隙間なく覆う（重複不可）
- 最低1セグメント。最初の `startSec` は必ず `0`
- 最後の `endSec` は全体時間と一致
- あるセグメントの `endSec` = 次のセグメントの `startSec`

### 3.3 再生モード

#### step（ステップ）モード
- セグメント内は一定BPMで再生
- セグメント境界で即時にBPMが切り替わる

#### gradient（グラデーション）モード
- セグメント開始BPMから**次セグメントのBPM**へ線形補間
- 最後のセグメントに設定した場合は自セグメントのBPMを維持（変化なし）
- ビート単位で補間（各ビートの間隔を都度計算）

```
progress = (elapsed - seg.startSec) / (seg.endSec - seg.startSec)  // 0.0〜1.0
bpm      = startBPM + (endBPM - startBPM) × progress
interval = 60 / bpm  // 秒
```

---

## 4. 状態管理仕様

### 4.1 アプリの状態（State）
```js
{
  totalSec:          30,
  segments: [
    { startSec: 0,  endSec: 10, jumps: 80, mode: 'step' },
    { startSec: 10, endSec: 20, jumps: 70, mode: 'step' },
    { startSec: 20, endSec: 30, jumps: 60, mode: 'step' },
  ],
  beepGain:          2.5,           // BEEP/クリック音共通ゲイン（0.5〜5.0）
  clickSound:        'electronic',  // "electronic"|"marimba"|"simple"|"wood"|"hihat"
  playState:         'stopped',     // "stopped" | "playing"
  countdownSec:      3,             // 整数 0〜10
  announcementText:  'Single Rope', // 開始前に読み上げる自由テキスト
  timeAnnouncements: [{ timeSec: 10 }, { timeSec: 20 }],
  toggles: {
    announcement:   true,   // 開始アナウンス読み上げ
    countdown:      true,   // カウントダウン音声
    beepStart:      true,   // スタートBEEP
    beepTransition: true,   // 切替BEEP
    beepEnd:        true,   // 終了BEEP
    voiceCount:     true,   // 回数アナウンス
    voiceTime:      true,   // 時間アナウンス
  }
}
```

### 4.2 状態変更のフロー
```
ユーザー操作 → State更新 → UI再描画（セグメント・タイムライン・キャンバス）
再生ボタン  → [iOS解除] → [アナウンスTTS] → [カウントダウン] → メトロノームエンジン起動
停止ボタン  → speechSynthesis.cancel() → 音声タイマークリア → メトロノームエンジン停止
DLボタン   → OfflineAudioContext → lamejs MP3エンコード → ダウンロード
```

---

## 5. 音声仕様

### 5.1 クリック音の種類（5種）
| 種類 | キー | 生成方法 |
|---|---|---|
| 電子音 | `electronic` | OscillatorNode square 1000Hz、gain=2.5、50ms指数減衰 |
| 木琴風 | `marimba` | OscillatorNode sine 880Hz、gain=2.5、280ms指数減衰 |
| シンプル | `simple` | ホワイトノイズバッファ、gain=2.0、18ms線形減衰 |
| ウッド | `wood` | OscillatorNode triangle、周波数sweep 800→400Hz（40ms）、gain=2.5 |
| ハイハット | `hihat` | ホワイトノイズ + BiquadFilter highpass 5000Hz、gain=3.0、25ms |

### 5.2 BEEP音
| パラメータ | 値 |
|---|---|
| 波形 | 矩形波（square） |
| 周波数 | 880 Hz |
| 持続 | 100ms（フラット） + 140ms（指数減衰） = 240ms |
| 停止 | 250ms後 |
| ゲイン | `beepGain`（デフォルト2.5、スライダーで調整） |

### 5.3 オーディオチェーン
```
scheduleClick / scheduleBeep
        ↓
MetronomeEngine.destination（= _compressor）
        ↓
DynamicsCompressorNode
  threshold: -20 dB
  knee:       4 dB
  ratio:      8:1
  attack:     3 ms
  release:   150 ms
        ↓
GainNode（_masterOut） gain = 6.0
        ↓
AudioContext.destination（スピーカー）
```

コンプレッサーはモバイル端末でのダイナミクス制御と音量最大化のために使用。
個別ゲインを高め（2.5〜3.0）に設定して強いシグナルを入力し、コンプレッサー後に6.0倍で出力する。

### 5.4 スケジューリング方式（ルックアヘッド）
- `AudioContext.currentTime` を基準
- スケジュールアヘッド：100ms
- スケジューラー間隔：25ms（`setInterval`）
- グラデーション時：ビートごとに次ビートまでの間隔を計算

---

## 6. アナウンス・TTS仕様

### 6.1 再生シーケンス
```
[再生ボタン押下]
  ↓ _unlockIOSAudioSession()（サイレントWAV再生 → iOSのAudioSessionをplaybackカテゴリへ）
  ↓ metronome._ensureCtx()（AudioContext生成 + resume）
  ↓ warmupSpeech()（ダミー発話でSpeechSynthesisを初期化）
  ↓ （toggle:announcement ON かつ テキストあり）
  ↓   speechSynthesis で announcementText を読み上げ（en-US, rate=0.95）
  ↓ beginMetronome() 呼び出し（onend または fallback タイマーで発火）
  ↓   metronome.start() → audioCtx.currentTime + 0.1 + cdSec 後にビート開始
  ↓ startRAF() → buildSpeechEvents() + _scheduleSpeechWithTimers()
```

### 6.2 カウントダウン
- `countdownSec` 秒の整数カウントダウン
- `elapsed = -countdownSec` から `0` まで
- カウントダウン発話は `startAudioTime - i - SPEECH_LEAD` に setTimeout でスケジュール
- 例：countdownSec=3 → "three"(-3), "two"(-2), "one"(-1), スタートBEEP(0)

### 6.3 スピーチスケジューリング（setTimeout方式）
再生開始時に全スピーチイベントを `setTimeout` で一括スケジュール。
RAFループ内ではなく、`startRAF()` 冒頭の `_scheduleSpeechWithTimers()` で実行。

```js
// 各イベントの発火タイミング計算
if (priority === 0) {           // カウントダウン
  fireAt = startAt + timeAt - SPEECH_LEAD;      // 200ms前倒し
} else if (priority === 1) {    // 回数アナウンス
  fireAt = startAt + timeAt + AFTER_BEEP;       // BEEP終了後（+350ms）
} else if (priority === 2) {    // 時間アナウンス
  fireAt = startAt + timeAt + AFTER_BEEP + STAGGER; // さらに+500ms後
}
```

| 定数 | 値 | 意味 |
|---|---|---|
| `SPEECH_LEAD` | 0.20s | TTSレイテンシ補正（カウントダウンを200ms前倒し） |
| `AFTER_BEEP` | 0.35s | BEEP終了（約250ms）+ 余白。回数読み上げまでの待機 |
| `STAGGER` | 0.50s | 時間アナウンスを回数アナウンスの後にずらす間隔 |

### 6.4 スピーチイベントの優先度
```js
{ timeAt: -3, text: "three",   priority: 0 }  // カウントダウン
{ timeAt:  0, text: "eighty",  priority: 1 }  // 回数アナウンス
{ timeAt: 10, text: "ten",     priority: 2 }  // 時間アナウンス
```

同じ `timeAt` 内では `priority` 順でソートし、`sameTimeIdx` を使って時間的にずらす。

### 6.5 停止時の処理
```js
_clearSpeechTimers();                      // setTimeoutをすべてキャンセル
window.speechSynthesis.cancel();           // 読み上げ中のTTSも即座にキャンセル
```

### 6.6 数値→英語変換（numToWords）
- 0〜999 の整数を英語単語に変換
- 例：80 → "eighty"、76 → "seventy six"、300 → "three hundred"

---

## 7. iOS / モバイル対応

### 7.1 iOS AudioSession 解除（_unlockIOSAudioSession）
iOSはデフォルトで Web Audio が「サイレントスイッチ対象（ambient）」カテゴリになる。
`<audio>` 要素で実際の音声ファイルを再生することで「playback」カテゴリに昇格させる。

```js
// 最小有効WAV（22050Hz モノラル 16bit 1サンプル = 46バイト）をBlobで生成し
// <audio> 要素で再生する。ユーザーのタップイベント内で呼ぶことが必須。
const b = new Uint8Array([...]);
const a = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
a.play().then(() => { _iosUnlocked = true; });
```

`_iosUnlocked` フラグで2回目以降をスキップ。

### 7.2 AudioContext resume
`_ensureCtx()` が AudioContext を生成・resume する。
`state === 'suspended'` のとき `audioCtx.resume()` を呼ぶが、**ユーザー操作の文脈外では効かない**ため、
必ず再生ボタンのクリックハンドラ内で同期的に呼ぶこと。

### 7.3 バックグラウンド復帰
```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && metronome.audioCtx) {
    metronome.audioCtx.resume();
  }
});
```

---

## 8. i18n（国際化）仕様

### 8.1 構成ファイル
`i18n.js` に `TRANSLATIONS` オブジェクト（`ja` / `en`）を定義。

### 8.2 静的要素の翻訳
```html
<span data-i18n="btn-play">▶ 再生</span>
<input data-i18n-ph="opt-announce-ph" placeholder="...">
```
`setLang()` が `querySelectorAll('[data-i18n]')` を走査して `textContent` を更新。
`data-i18n-ph` は `placeholder` を更新。

### 8.3 動的要素の翻訳
JS生成コンテンツ（セグメントカード・タイムライン・再生情報など）は
`setLang()` → `render()` を呼んで再描画することで翻訳を反映する。

### 8.4 変数展開
```js
t('jumps-info', { j: 80, b: 160 })
// → '<strong>80</strong> 回/分 (BPM 160)'
```

### 8.5 言語切替トグル（ピル付きスライダー）
- `.lang-switch` に `.en` クラスをトグルしてCSSアニメーションでピルをスライド
- 言語ボタンは `flex: none; width: 56px` で等幅固定（ずれ防止）
- OK ROPEストアリンクURLも言語切替と同時に更新

---

## 9. タイムラインUI仕様

### 9.1 統合タイムラインバー
セグメントカラーバーとBPM形状ラインを1つの要素に統合。

```
┌─────────────────────────────────────┐ ← #timelineBar（position: relative）
│  [色付きセグメントバー]              │ ← #timelineSegs（z-index 1）
│  [Canvasオーバーレイ（白ライン）]    │ ← #timelineCanvas（z-index 5, position: absolute, inset: 0）
│  [再生位置インジケーター]            │ ← #playhead（z-index 10, position: absolute）
└─────────────────────────────────────┘
```

### 9.2 タイムラインバーのカラーマッピング
```js
hue = (1 - (clamp(jumps, 40, 120) - 40) / 80) × 210
color = hsl(hue, 65%, 42%)
// 高回数（120）→ hue=0（赤）、低回数（40）→ hue=210（青）
```
グラデーションモードのセグメントは `linear-gradient(to right, ...)` で次セグメントの色へ変化。

### 9.3 Canvas オーバーレイ（BPM形状ライン）
- 白いライン（`rgba(255,255,255,0.85)`、太さ2px）：
  - ステップモード → 水平線（y一定）
  - グラデーションモード → 斜め線（開始y → 終了y）
  - セグメント境界で垂直線
- 白いドット（`rgba(255,255,255,0.95)`、半径4px）：各セグメントの開始点 + 末尾点
- Y軸マッピング：全セグメント中の最小〜最大 jumps の範囲で正規化

### 9.4 タイムラインラベル
バーの下に時間ラベルを表示（`#timelineLabels`）。各セグメント境界に `Xs` 形式で表示。

### 9.5 再生位置インジケーター（#playhead）
- `left = elapsed / totalSec × 100%` をRAFループで更新
- カウントダウン中は `left: 0%` に固定

### 9.6 再生情報（#playInfo）
再生中のみ表示：
```
現在の回数：80 回/分 (BPM 160)   残り 14.3 秒   セグメント 1 / 3
```

---

## 10. セグメント編集UI仕様

### 10.1 各セグメントの入力項目
| 項目 | 型 | 範囲 | 備考 |
|---|---|---|---|
| 開始（秒） | 数値（読み取り専用） | 自動算出 | 前セグメントの終了と連動 |
| 終了（秒） | 数値 | 0.1〜300、step=0.1 | 最終セグメントは読み取り専用 |
| 回数（回/分） | 数値 | 30〜200 | 整数 |
| モード | ボタントグル | step / gradient | |

### 10.2 セグメント追加
末尾セグメントを中点で分割して追加。

### 10.3 セグメント削除
- 1セグメントのみの場合は削除不可（ボタン非活性）
- 先頭削除：次セグメントの startSec を 0 に
- 中間・末尾削除：前セグメントの endSec を削除セグメントの endSec に拡張

---

## 11. MP3エクスポート仕様

### 11.1 処理フロー
1. `OfflineAudioContext` を生成（モノラル 44100Hz）
2. サイズ = `(cdSec + totalSec + 0.5) × 44100` サンプル
3. 全ビートをオフラインスケジューリング（`_renderBeatsOffline`）
4. `startRendering()` で高速レンダリング
5. Float32 → Int16 変換 → lamejs でMP3エンコード（128kbps、ブロックサイズ1152）
6. Blob URL → `<a download>` クリックでダウンロード

### 11.2 カウントダウン区間の扱い
- MP3内では無音（TTS音声はブラウザ依存で埋め込み不可）
- ビートは `cdSec` 秒後からスケジューリング

### 11.3 出力ファイル仕様
| 項目 | 値 |
|---|---|
| フォーマット | MP3 |
| サンプルレート | 44100 Hz |
| ビットレート | 128 kbps |
| チャンネル | モノラル（1ch） |
| ファイル名 | `metronome_{totalSec}sec_{min}-{max}.mp3` |

---

## 12. レスポンシブレイアウト仕様

| ブレークポイント | レイアウト変化 |
|---|---|
| 〜600px（スマホ） | カード padding 16px、タイムラインバー 64px高 |
| 600px〜（デスクトップ） | カード padding 20px、タイムラインバー 68px高 |

- 最小タップターゲット：52px（主要ボタン）
- 数値入力に `inputmode="numeric"` または `inputmode="decimal"` を付与（テンキー表示）
- `viewport maximum-scale=1.0` でピンチズーム防止

---

## 13. ファイル構成と責務

```
Speed_Practice_App/
├── index.html      # HTMLマークアップ・CDN読み込み
├── style.css       # 全スタイル・レスポンシブ対応
├── i18n.js         # 翻訳辞書（ja/en）・setLang() / t() / getLang()
├── app.js          # State管理・UI描画・TTS・RAFループ
├── metronome.js    # Web Audio APIエンジン（再生・BEEP・グラデーション）
└── export.js       # OfflineAudioContext + lamejs によるMP3書き出し
```

### 各ファイルの責務

**index.html**：DOM構造、lamejs CDN読み込み、i18n属性付き静的HTML

**style.css**：レスポンシブレイアウト、タイムラインバー、トグルスイッチ、カード、アコーディオン、lang-switch

**i18n.js**：
- `TRANSLATIONS` オブジェクト（ja / en の全翻訳文字列）
- `t(key, vars)` — キーを現在言語で解決し変数展開
- `setLang(lang)` — DOM全体を更新、ピルアニメーション、ストアリンクURL切替、`render()` 呼び出し
- `getLang()` — 現在の言語を返す

**app.js**：
- State保持と更新
- セグメントCRUD・バリデーション
- UIコンポーネント描画（セグメントリスト・タイムライン・キャンバス）
- TTS制御（Web Speech API）・speechEventsの構築
- setTimeout ベースの音声スケジューリング（`_scheduleSpeechWithTimers`）
- RAFループ（再生位置・再生情報表示のみ、音声発火はsetTimeoutに委譲）
- iOS音声セッション解除（`_unlockIOSAudioSession`）
- metronome.js・export.js の呼び出し

**metronome.js**：
- AudioContext管理・iOS resume対応（`_ensureCtx`・`_playSilentBuffer`）
- クリック音5種類の生成（`scheduleClick` / `scheduleBeep`）
- DynamicsCompressor + masterOut 構成（`_setupCompressor`）
- ルックアヘッドスケジューラー（`setInterval` 25ms）
- ステップ・グラデーション両モードのビートスケジューリング
- 終了BEEPのタイミング補正

**export.js**：
- OfflineAudioContextでのオーディオレンダリング
- lamejsを使ったMP3エンコード
- ダウンロード処理

---

## 14. 外部依存

| ライブラリ | バージョン | 用途 | 読み込み方法 |
|---|---|---|---|
| lamejs | 1.2.1 | MP3エンコード | CDN（jsDelivr） |

その他の外部ライブラリは使用しない（バニラJS）。Web Speech APIはブラウザ標準機能を利用。

---

*仕様書バージョン: 3.0*  
*更新日: 2026-05-10*
