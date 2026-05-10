const TRANSLATIONS = {
  ja: {
    // Header
    'mobile-notice':       'スマートフォンの場合はマナーモードを解除してください。',

    // Store credit
    'store-credit':        'by なわとび専門店 OK ROPE',

    // Sections
    'section-total-time':  '全体時間',
    'section-segments':    'セグメント設定',
    'section-timeline':    'タイムライン',
    'unit-sec':            '秒',

    // Controls
    'btn-add-seg':         '＋ セグメント追加',
    'btn-play':            '▶ 再生',
    'btn-stop':            '⏹ 停止',
    'btn-export':          '⬇ MP3ダウンロード',

    // Options
    'options-label':       'オプション',
    'opt-announce-title':  'アナウンス設定',
    'opt-announce-label':  '開始アナウンス',
    'opt-announce-hint':   '再生前に読み上げるテキスト',
    'opt-announce-ph':     '例: Single Rope Speed Sprint 30 seconds',
    'opt-countdown-label': 'カウントダウン',
    'opt-countdown-hint':  '例：3秒 → Three, Two, One, BEEP',
    'opt-timeann-label':   '時間アナウンス',
    'btn-add-timeann':     '＋ 追加',

    // Feature toggles
    'opt-features-title':  '機能 ON / OFF',
    'tog-ann-name':        '開始アナウンス読み上げ',
    'tog-ann-desc':        'カウントダウン前にテキストを読み上げ',
    'tog-cd-name':         'カウントダウン音声',
    'tog-cd-desc':         'Three, Two, One の読み上げ',
    'tog-bs-name':         'スタート BEEP',
    'tog-bs-desc':         '最初のビートの合図音',
    'tog-bt-name':         '切替 BEEP',
    'tog-bt-desc':         'セグメント切り替わりの合図音',
    'tog-be-name':         '終了 BEEP',
    'tog-be-desc':         'メトロノーム終了の合図音',
    'tog-vc-name':         '回数アナウンス',
    'tog-vc-desc':         'スタート・切替時に回数を英語で読上げ',
    'tog-vt-name':         '時間アナウンス',
    'tog-vt-desc':         '指定した時間を英語で読上げ',

    // Click sound
    'opt-click-title':     'クリック音',
    'click-electronic':    '電子音',
    'click-marimba':       '木琴風',
    'click-simple':        'シンプル',
    'opt-beep-gain':       'BEEP 音量',

    // Segment card (JS-rendered)
    'seg-label':           'セグメント {n}',
    'btn-delete':          '削除',
    'seg-start':           '開始（秒）',
    'seg-end':             '終了（秒）',
    'seg-jumps':           '回数（回/分）',
    'seg-mode':            'モード',
    'btn-step':            'ステップ',
    'btn-gradient':        'グラデーション',
    'btn-delete-ann':      '削除',

    // Play info (JS-rendered)
    'counting-down':       'カウントダウン中...',
    'jumps-info':          '<strong>{j}</strong> 回/分 (BPM {b})',
    'remain-info':         '残り <strong>{n}</strong> 秒',
    'seg-info':            'セグメント <strong>{a} / {b}</strong>',

    // Export WIP notice
    'exp-wip':             '⚠ MP3ダウンロード機能は現在未完成です',

    // Export status
    'exp-playing':         '再生中はエクスポートできません。停止してから実行してください。',
    'exp-capturing':       'ブラウザの共有ダイアログで「このタブ」を選択してください...',
    'exp-generating':      '音声を生成中...',
    'exp-started':         'ダウンロードを開始しました。',
    'exp-cancelled':       '録音がキャンセルされました。',
    'exp-no-audio':        'タブ音声が取得できませんでした。「このタブ」と音声共有を選択してください。',
    'exp-error':           'エラー: ',
  },

  en: {
    // Header
    'mobile-notice':       'Please turn off silent / mute mode on your smartphone.',

    // Store credit
    'store-credit':        'by Jump Rope Store OK ROPE',

    // Sections
    'section-total-time':  'Total Time',
    'section-segments':    'Segment Settings',
    'section-timeline':    'Timeline',
    'unit-sec':            'sec',

    // Controls
    'btn-add-seg':         '＋ Add Segment',
    'btn-play':            '▶ Play',
    'btn-stop':            '⏹ Stop',
    'btn-export':          '⬇ Download MP3',

    // Options
    'options-label':       'Options',
    'opt-announce-title':  'Announcement',
    'opt-announce-label':  'Intro Text',
    'opt-announce-hint':   'Text read aloud before playback',
    'opt-announce-ph':     'e.g. Single Rope Speed Sprint 30 seconds',
    'opt-countdown-label': 'Countdown',
    'opt-countdown-hint':  'e.g. 3 sec → Three, Two, One, BEEP',
    'opt-timeann-label':   'Time Calls',
    'btn-add-timeann':     '＋ Add',

    // Feature toggles
    'opt-features-title':  'Features ON / OFF',
    'tog-ann-name':        'Intro Announcement',
    'tog-ann-desc':        'Read intro text before countdown',
    'tog-cd-name':         'Countdown Voice',
    'tog-cd-desc':         'Speak Three, Two, One',
    'tog-bs-name':         'Start BEEP',
    'tog-bs-desc':         'Signal sound on first beat',
    'tog-bt-name':         'Transition BEEP',
    'tog-bt-desc':         'Signal sound on segment change',
    'tog-be-name':         'End BEEP',
    'tog-be-desc':         'Signal sound at finish',
    'tog-vc-name':         'Jump Count Voice',
    'tog-vc-desc':         'Announce jump count at start / change',
    'tog-vt-name':         'Time Call Voice',
    'tog-vt-desc':         'Announce elapsed time in English',

    // Click sound
    'opt-click-title':     'Click Sound',
    'click-electronic':    'Electronic',
    'click-marimba':       'Marimba',
    'click-simple':        'Simple',
    'opt-beep-gain':       'BEEP Volume',

    // Segment card (JS-rendered)
    'seg-label':           'Segment {n}',
    'btn-delete':          'Del',
    'seg-start':           'Start (sec)',
    'seg-end':             'End (sec)',
    'seg-jumps':           'Jumps (/min)',
    'seg-mode':            'Mode',
    'btn-step':            'Step',
    'btn-gradient':        'Gradient',
    'btn-delete-ann':      'Del',

    // Play info (JS-rendered)
    'counting-down':       'Counting down...',
    'jumps-info':          '<strong>{j}</strong> jumps/min (BPM {b})',
    'remain-info':         '<strong>{n}</strong> sec left',
    'seg-info':            'Segment <strong>{a} / {b}</strong>',

    // Export WIP notice
    'exp-wip':             '⚠ MP3 download is not yet complete',

    // Export status
    'exp-playing':         'Cannot export while playing. Please stop first.',
    'exp-capturing':       'Select "This Tab" in the browser share dialog...',
    'exp-generating':      'Generating audio...',
    'exp-started':         'Download started.',
    'exp-cancelled':       'Recording cancelled.',
    'exp-no-audio':        'Could not capture tab audio. Select "This Tab" with audio sharing.',
    'exp-error':           'Error: ',
  },
};

// ── Public API ────────────────────────────────────────────────────────────────
let _lang = 'ja';

function t(key, vars) {
  const dict = TRANSLATIONS[_lang] || TRANSLATIONS.ja;
  let str = (key in dict) ? dict[key] : (TRANSLATIONS.ja[key] ?? key);
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace('{' + k + '}', v);
    });
  }
  return str;
}

function setLang(lang) {
  if (!TRANSLATIONS[lang]) return;
  _lang = lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'ja';

  // Update all static elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // Update placeholders
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  // Sync toggle button active state
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Slide the pill indicator
  const langSwitch = document.querySelector('.lang-switch');
  if (langSwitch) langSwitch.classList.toggle('en', lang === 'en');

  // Switch store link URL
  const storeLink = document.getElementById('storeLink');
  if (storeLink) storeLink.href = lang === 'en' ? 'https://ok-rope.com/en' : 'https://ok-rope.com/';

  // Re-render JS-generated content
  if (typeof render === 'function') render();
}

function getLang() { return _lang; }
