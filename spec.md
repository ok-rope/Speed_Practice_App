# なわとびスピード練習メトロノーム - 仕様書

**バージョン：** 2.0  
**作成日：** 2026-05-09  
**更新日：** 2026-05-09（アナウンス機能・BEEP3分割・タイムライン統合・カウントダウン再設計）

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
  segments:          [{ startSec: 0, endSec: 30, jumps: 80, mode: "step" }],
  clickSound:        "electronic",  // "electronic" | "marimba" | "simple"
  playState:         "stopped",     // "stopped" | "playing"
  countdownSec:      3,             // 整数 0〜10
  announcementText:  "",            // 開始前に読み上げる自由テキスト
  timeAnnouncements: [],            // [{ timeSec: 10 }, ...]
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
再生ボタン  → [アナウンスTTS] → [カウントダウン] → メトロノームエンジン起動
停止ボタン  → speechSynthesis.cancel() → メトロノームエンジン停止
DLボタン   → OfflineAudioContext → lamejs MP3エンコード → ダウンロード
```

---

## 5. 音声仕様

### 5.1 クリック音の種類
| 種類 | 生成方法 |
|---|---|
| 電子音（electronic） | OscillatorNode 1000Hz、50ms指数減衰 |
| 木琴風（marimba） | OscillatorNode 880Hz 正弦波、280ms指数減衰 |
| シンプル（simple） | ホワイトノイズバッファ、18ms線形減衰 |

### 5.2 BEEP音
| パラメータ | 値 |
|---|---|
| 波形 | サイン波 |
| 周波数 | 880 Hz |
| アタック | 12ms |
| 持続 | 100ms |
| リリース | 240ms |
| ゲイン | 0.9 |

### 5.3 スケジューリング方式（ルックアヘッド）
- `AudioContext.currentTime` を基準
- スケジュールアヘッド：100ms
- スケジューラー間隔：25ms（`setInterval`）
- グラデーション時：ビートごとに次ビートまでの間隔を計算

### 5.4 iOS Safari対応
- 再生ボタンタップ時に `warmupSpeech()` でダミー発話 → AudioContext を `resume()` させる

---

## 6. アナウンス・TTS仕様

### 6.1 再生シーケンス
```
[再生ボタン押下]
  ↓ warmupSpeech()（iOS AudioContext 解除）
  ↓ （toggle:announcement ON かつ テキストあり）
  ↓   speechSynthesis で announcementText を読み上げ（en-US, rate=0.95）
  ↓ beginMetronome() 呼び出し
  ↓   metronome.start() → audioCtx.currentTime + 0.1 + cdSec 後にビート開始
  ↓ RAF（requestAnimationFrame）ループ開始
  ↓   elapsed が負の間：カウントダウン読み上げ（"three", "two", "one"）
  ↓   elapsed ≥ 0：回数アナウンス・時間アナウンス発火
```

### 6.2 カウントダウン
- `countdownSec` 秒の整数カウントダウン
- `elapsed = -countdownSec` から `0` まで
- `elapsed = -i` のタイミングで `numToWords(i)` を発話（SPEECH_LEAD 200ms 前倒し）
- 例：countdownSec=3 → "three"(-3), "two"(-2), "one"(-1), スタートBEEP(0)

### 6.3 スピーチイベント（buildSpeechEvents）
再生開始時に以下の配列を構築し、RAFループ内で `elapsed >= timeAt - SPEECH_LEAD` になったら発火。

| イベント種別 | timeAt | text |
|---|---|---|
| カウントダウン（countdown ON） | -3, -2, -1, ... | "three", "two", "one", ... |
| 回数アナウンス（voiceCount ON） | seg.startSec | "eighty", "seventy six", ... |
| 時間アナウンス（voiceTime ON） | ann.timeSec | "ten", "twenty", ... |

### 6.4 SPEECH_LEAD
```js
const SPEECH_LEAD = 0.20; // 200ms 前倒しで発話（TTS起動レイテンシ補正）
```

### 6.5 停止時の処理
```js
window.speechSynthesis.cancel(); // 読み上げ中のTTSも即座にキャンセル
```

### 6.6 数値→英語変換（numToWords）
- 0〜999 の整数を英語単語に変換
- 例：80 → "eighty"、76 → "seventy six"、300 → "three hundred"

---

## 7. タイムラインUI仕様

### 7.1 統合タイムラインバー
セグメントカラーバーとBPM形状ラインを1つの要素に統合。

```
┌─────────────────────────────────────┐ ← #timelineBar（position: relative）
│  [色付きセグメントバー]              │ ← #timelineSegs（z-index 1）
│  [Canvasオーバーレイ（白ライン）]    │ ← #timelineCanvas（z-index 5, position: absolute, inset: 0）
│  [再生位置インジケーター]            │ ← #playhead（z-index 10, position: absolute）
└─────────────────────────────────────┘
```

### 7.2 タイムラインバーのカラーマッピング
```js
hue = (1 - (clamp(jumps, 40, 120) - 40) / 80) × 210
color = hsl(hue, 65%, 42%)
// 高回数（120）→ hue=0（赤）、低回数（40）→ hue=210（青）
```
グラデーションモードのセグメントは `linear-gradient(to right, ...)` で次セグメントの色へ変化。

### 7.3 Canvas オーバーレイ（BPM形状ライン）
- 背景：透明（バーの色が透けて見える）
- グリッド線・Y軸ラベル：なし
- 白いライン（`rgba(255,255,255,0.85)`、太さ2px）：
  - ステップモード → 水平線（y一定）
  - グラデーションモード → 斜め線（開始y → 終了y）
  - セグメント境界で垂直線（前のセグメントの y から次の y へ）
- 白いドット（`rgba(255,255,255,0.95)`、半径4px）：各セグメントの開始点 + 末尾点
- Y軸マッピング：全セグメント中の最小〜最大 jumps の範囲で正規化
  - 単一値（全セグメント同一回数）のときは中央に描画

### 7.4 タイムラインラベル
- バーの下に時間ラベルを表示（`#timelineLabels`）
- 各セグメント境界（0, seg1.endSec, ..., totalSec）に `Xs` 形式で表示

### 7.5 再生位置インジケーター（#playhead）
- `position: absolute; top: 0; height: 100%; width: 3px`
- `left = elapsed / totalSec × 100%` をRAFループで更新
- カウントダウン中は `left: 0%` に固定

### 7.6 再生情報（#playInfo）
再生中のみ表示：
```
現在の回数：80 回/分 (BPM 160)   残り 14.3 秒   セグメント 1 / 3
```

---

## 8. セグメント編集UI仕様

### 8.1 各セグメントの入力項目
| 項目 | 型 | 範囲 | 備考 |
|---|---|---|---|
| 開始（秒） | 数値（読み取り専用） | 自動算出 | 前セグメントの終了と連動 |
| 終了（秒） | 数値 | 0.1〜300、step=0.1 | 最終セグメントは読み取り専用 |
| 回数（回/分） | 数値 | 30〜200 | 整数 |
| モード | ボタントグル | step / gradient | |

### 8.2 セグメント追加
- 末尾セグメントを中点で分割して追加

### 8.3 セグメント削除
- 1セグメントのみの場合は削除不可（ボタン非活性）
- 先頭削除：次セグメントの startSec を 0 に
- 中間・末尾削除：前セグメントの endSec を削除セグメントの endSec に拡張

---

## 9. MP3エクスポート仕様

### 9.1 処理フロー
1. `OfflineAudioContext` を生成（モノラル 44100Hz）
2. サイズ = `(cdSec + totalSec + 0.5) × 44100` サンプル
3. 全ビートをオフラインスケジューリング（`_renderBeatsOffline`）
4. `startRendering()` で高速レンダリング
5. Float32 → Int16 変換 → lamejs でMP3エンコード（128kbps、ブロックサイズ1152）
6. Blob URL → `<a download>` クリックでダウンロード

### 9.2 カウントダウン区間の扱い
- MP3内では無音（TTS音声はブラウザ依存で埋め込み不可）
- ビートは `cdSec` 秒後からスケジューリング

### 9.3 出力ファイル仕様
| 項目 | 値 |
|---|---|
| フォーマット | MP3 |
| サンプルレート | 44100 Hz |
| ビットレート | 128 kbps |
| チャンネル | モノラル（1ch） |
| ファイル名 | `metronome_{totalSec}sec_{min}-{max}.mp3` |

---

## 10. レスポンシブレイアウト仕様

| ブレークポイント | レイアウト変化 |
|---|---|
| 〜600px（スマホ） | カード padding 16px、タイムラインバー 64px高 |
| 600px〜（デスクトップ） | カード padding 20px、タイムラインバー 68px高 |

- 最小タップターゲット：52px（主要ボタン）
- 数値入力に `inputmode="numeric"` または `inputmode="decimal"` を付与（テンキー表示）
- `viewport maximum-scale=1.0` でピンチズーム防止

---

## 11. ファイル構成と責務

```
Speed_Practice_App/
├── index.html      # HTMLマークアップ・CDN読み込み
├── style.css       # 全スタイル・レスポンシブ対応
├── app.js          # State管理・UI描画・TTS・RAFループ
├── metronome.js    # Web Audio APIエンジン（再生・BEEP・グラデーション）
└── export.js       # OfflineAudioContext + lamejs によるMP3書き出し
```

### 各ファイルの責務

**index.html**：DOM構造、lamejs CDN読み込み

**style.css**：レスポンシブレイアウト、タイムラインバー、トグルスイッチ、カード

**app.js**：
- State保持と更新
- セグメントCRUD・バリデーション
- UIコンポーネント描画（セグメントリスト・タイムライン・キャンバス）
- TTS制御（Web Speech API）
- RAFループ（再生位置・スピーチイベント・再生情報表示）
- metronome.js・export.js の呼び出し

**metronome.js**：
- AudioContext管理・iOS resume対応
- クリック音3種類の生成（scheduleClick / scheduleBeep）
- ルックアヘッドスケジューラー（setInterval 25ms）
- ステップ・グラデーション両モードのビートスケジューリング
- 終了BEEPのタイミング補正（past-timestamp問題）

**export.js**：
- OfflineAudioContextでのオーディオレンダリング
- lamejsを使ったMP3エンコード
- ダウンロード処理

---

## 12. 外部依存

| ライブラリ | バージョン | 用途 | 読み込み方法 |
|---|---|---|---|
| lamejs | 1.2.1 | MP3エンコード | CDN（jsDelivr） |

その他の外部ライブラリは使用しない（バニラJS）。Web Speech APIはブラウザ標準機能を利用。

---

*仕様書バージョン: 2.0*  
*更新日: 2026-05-09*
