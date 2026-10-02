const plain=Object.freeze({params:Object.freeze({})});
const params=value=>Object.freeze({params:Object.freeze(value)});
export default Object.freeze({
  'guitar.phrase.title':plain,'guitar.phrase.mode':plain,'guitar.phrase.whole':plain,'guitar.phrase.explicit':plain,
  'guitar.phrase.from':plain,'guitar.phrase.to':plain,'guitar.phrase.apply':plain,'guitar.phrase.revert':plain,
  'guitar.phrase.help':plain,'guitar.phrase.repeats':plain,'guitar.phrase.draft':plain,'guitar.phrase.invalid':plain,
  'guitar.phrase.pending':params({from:'text',to:'text'}),
  'guitar.phrase.inventory':params({from:'text',to:'text',selected:'count',total:'count',holds:'count',start:'text',end:'text'}),
  'guitar.phrase.wholeHelp':plain,'guitar.phrase.noTargets':plain,'guitar.phrase.ready':params({count:'count'}),'guitar.phrase.inactiveLock':plain,'guitar.phrase.pendingLock':plain,
  'guitar.phrase.locks':params({total:'count',active:'count'}),'guitar.phrase.locksPending':params({total:'count'})
});
