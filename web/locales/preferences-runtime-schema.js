const plain = Object.freeze({params: Object.freeze({})});
const params = value => Object.freeze({params: Object.freeze(value)});
export default Object.freeze({
  'preferences.theme.storageUnavailable': plain,
  'preferences.theme.invalid': plain,
  'preferences.theme.unreadable': plain,
  'preferences.theme.accentInvalid': params({accent: 'text'}),
  'preferences.theme.backgroundInvalid': params({background: 'text'}),
  'preferences.theme.colorsInvalid': params({accent: 'text', background: 'text'}),
  'preferences.theme.unsaved': plain,
  'preferences.latency.storageUnavailable': plain,
  'preferences.latency.invalidSaved': plain,
  'preferences.latency.invalid': plain,
  'preferences.latency.invalidInput': plain,
  'preferences.latency.unsaved': plain,
  'preferences.beat.syntax': plain,
  'preferences.beat.range': plain,
  'notation.basicStaffAria': plain,
});
