import {readFileSync} from 'node:fs';

// Original exercises, emitted and byte-checked by the real Rust route tests.
// These are source inputs and independent expected receipts, not a JS compiler.
export function assistanceBrowserFixtures() {
  const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  return {
    canonical: read('assistance-canonical'),
    basic: read('assistance-native-basic'),
    vsq: read('assistance-native-vsq'),
    vsqOpened: read('vsq-clean-v1-native-open'),
  };
}

// Newly authored two-part exact C4 unison, derived only from our CC0 exercise.
// Selecting one part cannot split a physical keyboard attack across owners.
export function originalCrossScopeAssistanceScore(canonical) {
  const score = structuredClone(canonical.compilation.score);
  score.id = 'original-assistance-browser-cross-scope';
  score.title = 'Original assistance cross-scope unison';
  const [first, second] = score.parts[0].notes;
  second.at = structuredClone(first.at);
  score.parts = [
    {...score.parts[0], notes: [first]},
    {...score.parts[0], id: 'second-piano', name: 'Second piano', notes: [second]},
  ];
  return score;
}

/** Browser-only consumer replay of Rust-produced Basic/VSQ fixtures. This is
 * real Chromium AudioWorklet evidence, not desktop NativeLibrary acceptance.
 * All plans, clocks, gates, messages and rendering use production modules. */
export async function replayNativeAssistanceAudio({basic, vsq, vsqOpened}) {
  const [{prepareCleanSong, prepareVsqPractice}, {admitPracticeAssistance}, {CleanSongPlayer},
    {buildBasicKeyAudioPlan}, {buildVsqAudioPlan}, {BasicKeyAudioReceiver}] = await Promise.all([
    import('/clean-song-package.js'), import('/practice-assistance-receipt.js'), import('/clean-song-player.js'),
    import('/basic-key-audio-plan.js'), import('/vsq-audio-plan.js'), import('/basic-key-audio-receiver.js'),
  ]);
  // The suite has already used trusted Playwright clicks in this document.
  // Chromium Web Audio uses this sticky activation; no autoplay flag is added.
  const userActivated = navigator.userActivation.hasBeenActive;
  if (!userActivated) throw Error('Native fixture replay requires a prior trusted browser gesture');
  const context = new AudioContext();
  await context.resume();
  const observer = await globalThis.__wmhPreviewAudioTools.observeReceiver(document, {Receiver: BasicKeyAudioReceiver});
  globalThis.__assistanceNativeAudio = observer;
  const output = context.createGain(); output.gain.value = .2; output.connect(context.destination);
  const songs = {
    basic: prepareCleanSong(`native:${basic.source.key}`, basic.opened.clean_package, JSON.parse(basic.opened.score_json)),
    vsq: prepareVsqPractice(prepareCleanSong(`native:${vsq.source.key}`, vsqOpened.clean_package, JSON.parse(vsqOpened.score_json)), vsq.selected_runtime),
  };
  const result = {kind: 'native-fixture-replay-real-chromium-audio', userActivated, contextState: context.state, sampleRate: context.sampleRate, cases: []};
  globalThis.__assistanceNativeResult = result;
  let player;
  const currentOptions = (song, response) => {
    const {selection, mode, settings, revision, selection_digest} = response.checked.plan;
    const binding = {source: response.source, sourceToken: song, runtimeToken: song.runtime,
      selection, mode, settings, revision, expected_selection_digest: selection_digest};
    return {context, output, sampleRate: context.sampleRate, mode: selection.selected_part_ids.length ? 'practice' : 'listen',
      practiceSelection: {kind: 'parts', part_ids: selection.selected_part_ids},
      assistance: admitPracticeAssistance(response, binding), assistanceContext: binding,
      acceptedPolicyId: song.runtime.rendition?.policy_id};
  };
  try {
    for (const [kind, response] of [['basic', basic.explicit], ['vsq', vsq.narrow_scope]]) {
      const song = songs[kind], before = JSON.stringify(song), build = kind === 'basic' ? buildBasicKeyAudioPlan : buildVsqAudioPlan;
      const fixture = kind === 'basic' ? basic : vsq;
      const full = build(song, {sampleRate: context.sampleRate});
      const options = currentOptions(song, response);
      const row = {kind, source: fixture.source, full, checked: response.checked,
        original: build(song, currentOptions(song, fixture.original)),
        automatic: build(song, currentOptions(song, fixture.automatic)),
        ...(kind === 'vsq' ? {empty: build(song, currentOptions(song, fixture.empty))} : {}),
        errors: []};
      result.cases.push(row);
      player = new CleanSongPlayer({getPositionMs: () => 0, onError: error => row.errors.push({code: error.code, message: error.message})});
      player.select(song);
      await player.prepare(options);
      const receiver = (kind === 'basic' ? player.basicKeys : player.vsq).receiver;
      row.plan = structuredClone(receiver.plan);
      let timer, onMessage;
      const ended = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error(`${kind} real worklet never reached its complete source end`)), Math.ceil(full.durationFrames / context.sampleRate * 1000) + 1500);
        onMessage = event => {
          if (event.data?.type === 'error') reject(Error(event.data.message));
          if (event.data?.type === 'ended') resolve({trusted: event.isTrusted, portMatches: event.target === receiver.node.port,
            ...event.data, ledger: {actualStarts: Array.from(event.data.ledger.actualStarts), actualEnds: Array.from(event.data.ledger.actualEnds)}});
        };
        receiver.node.port.addEventListener('message', onMessage);
      });
      // Attach rejection before start can fail; neither promise is left dangling.
      try { [row.started, row.ended] = await Promise.all([player.startPrepared(), ended]); }
      finally { clearTimeout(timer); receiver.node.port.removeEventListener('message', onMessage); }
      row.audit = await receiver.audit({offset: 0, count: 32});
      row.sourceUnchanged = JSON.stringify(song) === before;
      player.stop(); player = null;
    }
    // Await actual disposal, without adding a scheduling or clock substitute.
    await new Promise((resolve, reject) => {
      let frame;
      const timeout = setTimeout(() => { cancelAnimationFrame(frame); reject(Error('Native fixture receivers failed to dispose')); }, 1500);
      const inspect = () => { if (observer.quiet()) { clearTimeout(timeout); resolve(); } else frame = requestAnimationFrame(inspect); };
      inspect();
    });
    observer.assertHealthy(); result.audio = observer.snapshot(); result.status = observer.status();
    return result;
  } finally { player?.stop(); output.disconnect(); await context.close(); }
}
