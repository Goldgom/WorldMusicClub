export const catalogs = Object.freeze({
  'zh-CN': {
    app: 'WorldMusicHub', pageTitle: 'WorldMusicHub · 练习交互原型', prototype: '交互原型', transport: '播放控制', major: '大调',
    skip: '跳转到主要内容', lobby: '练习大厅', homeTag: '每一次练习，都听见进步', heroA: '把音乐，', heroB: '弹成你的节奏。',
    heroDescription: '从一条清晰的旋律开始。看懂音符、找到位置，再按自己的速度一步步练习。',
    local: '本地运行', original: '原创练习', beginner: '入门 · 1–7', songTitle: 'C 大调 · 第一步', songDescription: '32 个音符，一条明确的吉他指法路径。跟着简谱，把音符与指板连起来。',
    songMeta: 'C 大调 / 4拍子 / 8 小节', startPractice: '开始跟练', freeTitle: '自由练习', freeDescription: '不跟谱，先把手感找回来。使用键盘或点击指板，试听并查看本次输入。',
    freeStart: '进入自由练习', localSession: '本页暂存 · 无需上传', guideTitle: '第一次练习？从这里开始', guideBody: '数字 1–7 对应 Do–Si；音符落到亮线时，按下相应数字键。这里只展示输入，不判定命中或分数。',
    isolatedNote: '独立交互原型 · 尚未接入 Rust 评分、MIDI 设备与练习存档',
    language: '界面语言', theme: '切换主题', dark: '深色', light: '浅色', back: '返回大厅', resumeSession: '继续上次练习',
    guided: '跟谱练习', free: '自由练习', guitar: '吉他', path: '指定指法路径', pathDetail: '2 弦 · 1–12 品',
    scoreTitle: '同步简谱', scoreSubtitle: 'C 大调 · 4/4', scoreHelp: '点击音符可跳转；播放进度与当前音符同步',
    current: '当前音符', next: '下一个', measure: '第 {current} / {total} 小节', notePosition: '{string} 弦 · {fret} 品',
    keyboardHint: '按键 {key}', inputHint: '数字键 1–7，或点击指板', ready: '准备就绪', playing: '正在练习', paused: '已暂停', finished: '本轮结束',
    play: '开始', pause: '暂停', resume: '继续', replay: '再练一次', reset: '从头开始', progress: '练习进度',
    tempo: '速度', soundOn: '声音开启', soundOff: '声音关闭', sound: '切换声音', soundUnavailable: '声音暂不可用，仍可进行视觉练习',
    elapsed: '已练习', total: '总时长', inputs: '输入次数', inputDisclaimer: '输入次数不代表命中数',
    emptyInput: '开始后，试着弹出你的第一个音', recentInputs: '最近输入', recentHelp: '显示最近 32 次输入；离开或刷新页面后不保留',
    freeDetail: '按下开始，记录本页的练习时间与输入次数', freeStage: '没有固定旋律，按自己的节奏来',
    freeCurrent: '自由弹奏', freeNext: '试试数字键 1–7', freeNote: '本次输入 {note}', stageLabel: '吉他节奏引导，音符从右向左移动至当前音线',
    targetLine: '当前音', coming: '接下来', fretboard: '吉他指板', fretboardHelp: '亮色位置是一条指定路径；点击任何位置均可试听',
    stringLabel: '{string} 弦', fretLabel: '{fret} 品', openFret: '空弦', fretNote: '{string} 弦 {fret} 品，{note}',
    pauseOnHide: '已暂停：窗口离开焦点', complete: '这一轮完成了', completeBody: '可以从头再练，或点击简谱回到想练的音符。',
    introHint: '入门数字键', endNote: '结束', status: '练习状态', silentPreview: '点击开始后可播放合成示范音',
  },
  en: {
    app: 'WorldMusicHub', pageTitle: 'WorldMusicHub · Practice interaction prototype', prototype: 'Interaction prototype', transport: 'Playback controls', major: 'MAJOR',
    skip: 'Skip to main content', lobby: 'Practice lobby', homeTag: 'Find your rhythm, one note at a time', heroA: 'Make music.', heroB: 'Find your rhythm.',
    heroDescription: 'Start with a clear melody. Read the note, find its position, and practice at a pace that feels right.',
    local: 'Runs locally', original: 'Original exercise', beginner: 'Beginner · 1–7', songTitle: 'C major · First steps', songDescription: '32 notes, one explicit guitar fingering path. Connect numbered notation to the fretboard.',
    songMeta: 'C major / 4 beats / 8 measures', startPractice: 'Start guided practice', freeTitle: 'Free practice', freeDescription: 'Find your feel without a score. Use number keys or click the fretboard to hear and inspect your inputs.',
    freeStart: 'Enter free practice', localSession: 'This page only · No upload', guideTitle: 'Your first session? Start here', guideBody: 'Keys 1–7 play Do–Si. Press the matching number as the note reaches the bright line. This prototype displays inputs without judging hits or scores.',
    isolatedNote: 'Isolated interaction prototype · Rust scoring, MIDI devices, and saved takes are not connected',
    language: 'Interface language', theme: 'Change theme', dark: 'Dark', light: 'Light', back: 'Back to lobby', resumeSession: 'Resume previous session',
    guided: 'Guided practice', free: 'Free practice', guitar: 'Guitar', path: 'Selected fingering path', pathDetail: 'String 2 · Frets 1–12',
    scoreTitle: 'Synchronized score', scoreSubtitle: 'C major · 4/4', scoreHelp: 'Select a note to seek; current note follows playback',
    current: 'Current note', next: 'Up next', measure: 'Measure {current} / {total}', notePosition: 'String {string} · Fret {fret}',
    keyboardHint: 'Key {key}', inputHint: 'Use keys 1–7, or click the fretboard', ready: 'Ready', playing: 'Practicing', paused: 'Paused', finished: 'Round complete',
    play: 'Start', pause: 'Pause', resume: 'Resume', replay: 'Play again', reset: 'Restart', progress: 'Practice progress',
    tempo: 'Tempo', soundOn: 'Sound on', soundOff: 'Sound off', sound: 'Toggle sound', soundUnavailable: 'Audio unavailable; visual practice is still available',
    elapsed: 'Elapsed', total: 'Duration', inputs: 'Inputs', inputDisclaimer: 'Input count is not a hit count',
    emptyInput: 'Start, then play your first note', recentInputs: 'Recent inputs', recentHelp: 'Shows the last 32 inputs; these are not saved after leaving or reloading this page',
    freeDetail: 'Press Start to track time and input count for this page', freeStage: 'No fixed melody. Play at your own pace.',
    freeCurrent: 'Play freely', freeNext: 'Try number keys 1–7', freeNote: 'Your input: {note}', stageLabel: 'Guitar rhythm guide, notes move from right to left toward the current-note line',
    targetLine: 'Now', coming: 'Coming up', fretboard: 'Guitar fretboard', fretboardHelp: 'Bright positions mark one chosen path; click any position to hear it',
    stringLabel: 'String {string}', fretLabel: 'Fret {fret}', openFret: 'Open', fretNote: 'String {string}, fret {fret}, {note}',
    pauseOnHide: 'Paused: window lost focus', complete: 'You reached the end', completeBody: 'Play again, or select a note in the score to revisit it.',
    introHint: 'Beginner number keys', endNote: 'End', status: 'Practice status', silentPreview: 'Press Start to hear synthesized guide notes',
  },
});
export function translate(locale, key, params = {}) {
  const catalog = catalogs[locale] || catalogs['zh-CN'];
  if (!(key in catalog)) throw new Error(`Missing translation: ${key}`);
  return catalog[key].replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in params)) throw new Error(`Missing parameter ${name} in ${key}`);
    return String(params[name]);
  });
}
