const messages = {
  en: {
    title: 'Machine accompaniment', machine: 'Machine', unidentified: 'Original instrument: not identified', subset: 'Machine subset of human part', previous: 'Previous accompaniment parts', next: 'Next accompaniment parts',
    page: 'Page {page} of {pages}', part: 'Source part {number}', empty: 'No machine parts',
    limit: 'Showing the first 128 machine parts',
    playing: 'Playing', silent: 'Silent', muted: 'Muted', paused: 'Paused', ready: 'Ready',
    preparing: 'Preparing', ended: 'Ended', unavailable: 'Unavailable',
  },
  zh: {
    title: '机器伴奏', machine: '机器', unidentified: '原始乐器：未识别', subset: '真人声部内的机器辅助', previous: '上一个机器声部', next: '下一个机器声部',
    page: '第 {page} / {pages} 页', part: '源声部 {number}', empty: '没有机器声部',
    limit: '仅显示前 128 个机器声部',
    playing: '演奏中', silent: '静音段', muted: '已静音', paused: '已暂停', ready: '就绪',
    preparing: '准备中', ended: '已结束', unavailable: '不可用',
  },
};
export const PART_ACTIVITY_STATES = Object.freeze(['playing', 'silent', 'muted', 'paused', 'ready', 'preparing', 'ended', 'unavailable']);
export function partActivityText(locale, key, values = {}) {
  const text = messages[locale === 'en' ? 'en' : 'zh'][key] || messages.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}
