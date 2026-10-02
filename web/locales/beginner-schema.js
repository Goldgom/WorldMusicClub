const plain = Object.freeze({params: Object.freeze({})});
const params = (value, plural) => Object.freeze({params: Object.freeze(value), ...(plural ? {plural} : {})});
export default Object.freeze({
  'beginner.referenceUnresolved': plain, 'beginner.numberedMode': plain, 'beginner.fixed': plain, 'beginner.movable': plain,
  'beginner.title': plain, 'beginner.enabled': plain, 'beginner.help': plain,
  'beginner.spellingPolicy': plain, 'beginner.referenceFixed': plain,
  'beginner.referenceMissing': plain, 'beginner.referenceUnsupported': plain,
  'beginner.referenceMajor': params({tonic: 'text'}), 'beginner.referenceMinor': params({tonic: 'text'}),
  'beginner.degree': params({degree: 'text'}), 'beginner.degreeRaised': params({degree: 'text'}),
  'beginner.degreeLowered': params({degree: 'text'}), 'beginner.octaveReference': plain,
  'beginner.octaveAbove': params({count: 'count'}, 'count'), 'beginner.octaveBelow': params({count: 'count'}, 'count'),
  'beginner.noteDescription': params({degree: 'text', octave: 'text', reference: 'text', pitch: 'text'}),
});
