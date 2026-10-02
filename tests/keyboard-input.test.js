import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createKeyboardInput, DEFAULT_KEYBOARD_MAPPING, LEGACY_KEYBOARD_MAPPING,
  validateKeyboardConfiguration, keyboardInputAllowed, KeyboardConfigurationError} from '../web/keyboard-input.js';
import {InputEvidence} from '../web/input-evidence.js';

function fixture(options = {}) {
  const {document} = parseHTML('<html><body><main id="stage"><div data-keyboard-performance tabindex="0" id="surface"><button data-midi="60" id="note"><span id="nested-note"></span></button></div><button id="button"><span id="nested-button"></span></button><input id="input"><textarea id="textarea"></textarea><select id="select"></select><a id="link"><span id="nested-link"></span></a><details id="instrument-settings"><summary id="summary"></summary><div id="setting"></div></details><div contenteditable="true" id="editor"><span id="nested-editor"></span></div><div role="slider" id="slider"><span id="nested-slider"></span></div><dialog id="dialog"><div id="dialog-child"></div></dialog><div id="notice"><span id="notice-child"></span></div></main></body></html>');
  let wall = 100;
  const calls = [], views = [], changes = [], context = {screen:'stage',hidden:false,dialogOpen:false};
  const controller = createKeyboardInput({getContext:() => context,now:() => wall,timeOrigin:() => 10000,
    pressNote:(...args) => calls.push(['on',...args]),releaseNote:(...args) => calls.push(['off',...args]),
    releaseMatching:(...args) => calls.push(['cancel',...args]),onChange:value => views.push(value),
    onConfiguration:event => changes.push(event),...options});
  function event(code, extra = {}) {
    return {code,key:code.startsWith('Key') ? code.slice(3).toLowerCase() : code,timeStamp:wall,target:document.body,
      defaultPrevented:false,preventDefault() { this.defaultPrevented = true; },...extra};
  }
  return {controller,context,calls,views,changes,event,document,at:value => {wall = value;},target:id => document.getElementById(id)};
}

const hasCode = code => error => error instanceof KeyboardConfigurationError && error.code === code;

function freeFixture() {
  const f = fixture();
  f.document.body.insertAdjacentHTML('beforeend',`<section id="free-practice-screen">
    <h2 id="free-title" data-keyboard-performance tabindex="-1">Free practice</h2>
    <div id="free-keys" data-keyboard-performance tabindex="0">
      <button id="free-note" data-midi="60"><span id="free-note-child"></span></button>
      <button id="free-button"><span id="free-button-child"></span></button>
      <input id="free-input"><textarea id="free-textarea"></textarea><select id="free-select"></select>
      <a id="free-link"><span id="free-link-child"></span></a>
      <div contenteditable="true" id="free-editor"><span id="free-editor-child"></span></div>
      <div role="slider" id="free-slider"><span id="free-slider-child"></span></div>
      <div role="button" id="free-widget" data-keyboard-performance></div>
      <dialog id="free-dialog"><div id="free-dialog-child"></div></dialog>
      <div id="free-focus-region" tabindex="0"></div>
      <div data-keyboard-input="off" id="free-off"><span id="free-off-child"></span></div>
    </div>
    <p id="free-general">General content</p><div id="keyboard"></div><div id="fretboard"></div>
  </section>`);
  f.context.screen = 'free';
  return f;
}

test('default four chromatic rows expose exactly 47 distinct physical notes and honest boundaries', () => {
  const f = fixture(), state = f.controller.snapshot();
  assert.equal(state.keyCount,47); assert.equal(state.noteCount,47); assert.equal(state.playableKeyCount,47);
  assert.deepEqual(state.range,{low:36,high:82});
  assert.deepEqual(state.rows.map(row => [row.id,row.range,row.bindings.length]),[
    ['bottom',{low:36,high:45},10],['home',{low:46,high:56},11],['upper',{low:57,high:69},13],['number',{low:70,high:82},13],
  ]);
  assert.deepEqual(state.bindings.map(binding => binding.midi),Array.from({length:47},(_,i) => 36+i));
  assert.deepEqual(state.rows.map(row => row.bindings.map(key => key.label).join(' ')),[
    'Z X C V B N M , . /', "A S D F G H J K L ; '", 'Q W E R T Y U I O P [ ] \\', '` 1 2 3 4 5 6 7 8 9 0 - =',
  ]);
  assert.equal(state.bindings[0].note,'C2'); assert.equal(state.bindings.at(-1).note,'A♯5');
  assert.match(state.labelBasis,/physical US/); assert.match(state.rollover,/unknown/);
  assert.equal(f.calls.length,0,'Constructing the controller neither captures notes nor unlocks audio');
});

test('the legacy piano arrangement is available as an explicit alternate mapping', () => {
  const f = fixture({configuration:{mapping:LEGACY_KEYBOARD_MAPPING,baseMidi:60}});
  assert.deepEqual(f.controller.snapshot().range,{low:60,high:76});
  f.controller.keydown(f.event('KeyW',{key:'z'}));
  assert.equal(f.calls[0][2],61,'event.code, never layout-dependent event.key, defines the note');
});

test('every default binding delivers its exact MIDI pitch, and modifiers/layout changes do not strand keyup', () => {
  const f = fixture();
  for (const binding of DEFAULT_KEYBOARD_MAPPING) {
    assert.equal(f.controller.keydown(f.event(binding.code,{key:'unrelated',shiftKey:true})),true);
    const on = f.calls.at(-1); assert.match(on[1],new RegExp(`^key:keyboard-[0-9]+:[0-9]+:${binding.code}$`)); assert.equal(on[2],36+binding.offset);
    assert.equal(f.controller.keyup(f.event(binding.code,{key:'different',ctrlKey:true,altKey:true,target:f.target('input')})),true);
    const off = f.calls.at(-1); assert.equal(off[0],'off'); assert.equal(off[1],on[1]);
    assert.equal(Object.hasOwn(off[3],'midi'),false,'Raw PC keyup is not a pitch observation or duration pairing');
  }
  assert.deepEqual(f.controller.snapshot().held,[]);
});

test('held ownership suppresses duplicate and auto-repeat attacks without suppressing chords', () => {
  const f = fixture();
  f.controller.keydown(f.event('KeyZ')); f.controller.keydown(f.event('KeyZ'));
  f.controller.keydown(f.event('KeyX',{repeat:true})); f.controller.keydown(f.event('KeyX'));
  assert.equal(f.calls.length,2); assert.equal(f.controller.snapshot().held.length,2);
  f.controller.keyup(f.event('KeyZ')); assert.deepEqual(f.controller.snapshot().held.map(key => key.code),['KeyX']);
  const before = f.calls.length; f.controller.keyup(f.event('KeyZ')); f.controller.keyup(f.event('F7'));
  assert.equal(f.calls.length,before,'Unrelated keyups never become musical evidence');
});

test('inactive stage, hidden page, dialogs, settings, modifiers and IME never route onsets', () => {
  const f = fixture();
  for (const patch of [{screen:'lobby'},{hidden:true},{dialogOpen:true},{settingsOpen:true},{composing:true}]) {
    const old = {...f.context}; Object.assign(f.context,patch);
    assert.equal(f.controller.keydown(f.event('KeyZ')),false); Object.keys(f.context).forEach(key => delete f.context[key]); Object.assign(f.context,old);
  }
  for (const patch of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{keyCode:229},{key:'Dead'},{key:'Process'},{key:'Unidentified'},{defaultPrevented:true}]) {
    const event = f.event('KeyZ',patch); assert.equal(f.controller.keydown(event),false);
  }
  assert.equal(f.calls.length,0);
  assert.equal(createKeyboardInput().keydown(f.event('KeyZ')),false,'Missing stage context is inert');
});

test('nested typing targets, settings descendants, links, buttons and ARIA widgets are protected', () => {
  const f = fixture();
  for (const id of ['input','textarea','select','link','nested-link','summary','setting','editor','nested-editor','slider','nested-slider','dialog-child','notice-child','button','nested-button']) {
    assert.equal(f.controller.keydown(f.event('KeyZ',{target:f.target(id)})),false,id);
    assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target(id)})),false,`${id} arrow`);
  }
  assert.equal(f.calls.length,0); assert.equal(f.controller.snapshot().transpose,0);
  assert.equal(f.controller.keydown(f.event('KeyZ',{target:f.target('nested-note')})),true);
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('nested-note')})),false,'Focused musical buttons retain arrow navigation');
});

test('plain arrows transpose only from stage body or explicit performance surface', () => {
  const f = fixture();
  for (const [code,expected] of [['ArrowUp',12],['ArrowRight',13],['ArrowDown',1],['ArrowLeft',0]]) {
    const event = f.event(code,{target:f.target('surface')});
    assert.equal(f.controller.keydown(event),true); assert.equal(event.defaultPrevented,true);
    assert.equal(f.controller.snapshot().transpose,expected); f.controller.keyup(f.event(code));
  }
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('stage')})),false,'Arbitrary focus regions do not grant control capture');
  for (const patch of [{shiftKey:true},{ctrlKey:true},{metaKey:true},{altKey:true}]) {
    const event = f.event('ArrowUp',patch); assert.equal(f.controller.keydown(event),false); assert.equal(event.defaultPrevented,false);
  }
  assert.equal(f.controller.snapshot().transpose,0);
});

test('arrow auto-repeat and duplicate notifications do not accelerate transposition', () => {
  const f = fixture();
  f.controller.keydown(f.event('ArrowUp')); f.controller.keydown(f.event('ArrowUp')); f.controller.keydown(f.event('ArrowUp',{repeat:true}));
  assert.equal(f.controller.snapshot().transpose,12);
  f.controller.keyup(f.event('ArrowUp')); f.controller.keydown(f.event('ArrowUp')); assert.equal(f.controller.snapshot().transpose,24);
});

test('offset and mapping changes release prior sources before publishing the new configuration', () => {
  const f = fixture(); f.controller.keydown(f.event('KeyZ')); f.controller.keydown(f.event('KeyX'));
  f.at(120); f.controller.transposeBy(12);
  assert.deepEqual(f.calls.at(-1),['cancel','key:',120,{reason:'keyboard_input_transpose',inputKind:'typing_keyboard'}]);
  assert.equal(f.controller.snapshot().held.length,0);
  f.controller.keydown(f.event('KeyZ',{repeat:true})); assert.equal(f.calls.at(-1)[0],'cancel');
  f.controller.keyup(f.event('KeyZ',{key:'Z',shiftKey:true})); assert.equal(f.calls.at(-1)[0],'off');
  f.controller.keydown(f.event('KeyZ')); assert.equal(f.calls.at(-1)[2],48);
  f.controller.configure({mapping:[{code:'KeyX',offset:2}]});
  assert.equal(f.calls.at(-1)[0],'cancel'); assert.equal(f.controller.snapshot().bindings[0].midi,50);
  f.controller.keyup(f.event('KeyZ')); assert.equal(f.calls.at(-1)[1],f.calls.at(-3)[1],'Removed mapping still releases the original source');
  const changes = f.changes.length; assert.equal(f.controller.configure({}),false); assert.equal(f.changes.length,changes);
});

test('blur/layout cleanup is scoped, preserves later raw keyup, and permits a fresh attack after lost external keyup', () => {
  const f = fixture(); f.controller.keydown(f.event('KeyZ'));
  f.controller.contextChanged('blur',130); assert.equal(f.calls.at(-1)[0],'cancel');
  f.controller.keydown(f.event('KeyZ',{repeat:true})); assert.equal(f.calls.at(-1)[0],'cancel');
  f.controller.keydown(f.event('KeyZ')); assert.equal(f.calls.at(-1)[0],'on');
  f.controller.contextChanged('keyboard_layout_changed',140); f.context.screen = 'lobby';
  f.controller.keyup(f.event('KeyZ',{key:'y',target:f.target('input')})); assert.equal(f.calls.at(-1)[0],'off');
  const count = f.calls.length; f.controller.releaseAll('blur',150); assert.equal(f.calls.length,count,'Cleanup is idempotent');
});

test('composition releases owned input, blocks subsequent keys, and requires an explicit composition end', () => {
  const f = fixture(); f.controller.keydown(f.event('KeyZ')); f.controller.compositionStart({timeStamp:120});
  assert.equal(f.calls.at(-1)[3].reason,'keyboard_composition');
  assert.equal(f.controller.keydown(f.event('KeyX')),false); f.controller.keyup(f.event('KeyZ',{isComposing:true}));
  f.controller.compositionEnd(); assert.equal(f.controller.keydown(f.event('KeyX')),true);
  f.controller.keydown(f.event('KeyC',{keyCode:229})); assert.equal(f.calls.at(-1)[3].reason,'keyboard_composition');
});

test('invalid updates are atomic and every validation error has a stable localization code', () => {
  const f = fixture(); f.controller.keydown(f.event('KeyZ'));
  const cases = [
    [{mapping:[]},'keyboard_mapping_size'],[{baseMidi:128},'keyboard_base_range'],[{transpose:128},'keyboard_transpose_range'],
    [{allowDuplicatePitches:'true'},'keyboard_duplicate_permission'],[{mapping:[{code:'Space',offset:0}]},'keyboard_code_reserved'],
    [{mapping:[{code:'KeyZ',offset:0},{code:'KeyZ',offset:1}]},'keyboard_duplicate_code'],
    [{mapping:[{code:'KeyZ',offset:0.5}]},'keyboard_offset_range'],
    [{mapping:[{code:'KeyZ',offset:0},{code:'KeyX',offset:0}]},'keyboard_duplicate_pitch'],
    [{mapping:[{code:'KeyZ',offset:0,label:''}]},'keyboard_label_invalid'],[{baseMidi:127,transpose:1},'keyboard_no_playable_notes'],
  ];
  for (const [configuration,code] of cases) assert.throws(() => f.controller.configure(configuration),hasCode(code));
  assert.throws(() => f.controller.transposeBy(0.5),hasCode('keyboard_transpose_integer'));
  assert.throws(() => createKeyboardInput({configurationLimit:0}),hasCode('keyboard_history_limit'));
  assert.equal(f.calls.length,1); assert.equal(f.controller.snapshot().held.length,1); assert.equal(f.changes.length,1);
});

test('only explicitly authorized duplicate-pitch aliases share pitch, never source ownership', () => {
  const mapping = [{code:'KeyZ',offset:0},{code:'KeyX',offset:0}];
  const f = fixture({configuration:{mapping,allowDuplicatePitches:true}});
  f.controller.keydown(f.event('KeyZ')); f.controller.keydown(f.event('KeyX')); f.controller.keyup(f.event('KeyZ'));
  assert.equal(f.controller.snapshot().keyCount,2); assert.equal(f.controller.snapshot().noteCount,1);
  assert.deepEqual(f.controller.snapshot().held.map(held => [held.source,held.midi]),[[f.calls[1][1],36]]);
  assert.notEqual(f.calls[0][1],f.calls[1][1]);
  assert.equal(f.controller.exportConfigurationData().current_configuration.duplicate_pitch_policy,'explicit_aliases');
});

test('MIDI edges disable rather than clamp bindings, with accurate range and playable note count', () => {
  const f = fixture({configuration:{baseMidi:0,transpose:-2}});
  let state = f.controller.snapshot(); assert.deepEqual(state.range,{low:0,high:44}); assert.equal(state.disabledKeyCount,2);
  assert.equal(state.noteCount,45); assert.equal(state.bindings[0].midi,null); assert.equal(state.bindings[0].requestedMidi,-2);
  assert.equal(f.controller.keydown(f.event('KeyZ')),false); assert.equal(f.controller.keydown(f.event('KeyC')),true); assert.equal(f.calls.at(-1)[2],0);
  f.controller.configure({baseMidi:127,transpose:0}); state = f.controller.snapshot();
  assert.equal(state.noteCount,1); assert.equal(state.disabledKeyCount,46); assert.deepEqual(state.range,{low:127,high:127});
  assert.equal(f.controller.keydown(f.event('ArrowRight')),true,'Impossible final transpose is handled without changing pitch or throwing');
  assert.equal(f.controller.snapshot().transpose,0); assert.equal(f.controller.snapshot().noteCount,1);
});

test('mapping, output snapshots and configuration history cannot be mutated to change controller state', () => {
  const mapping = [{code:'KeyZ',offset:0,label:'Z'}]; const f = fixture({configuration:{mapping}});
  mapping[0].offset = 50; mapping.push({code:'KeyX',offset:1});
  const state = f.controller.snapshot(); state.bindings[0].midi = 127; state.range.low = 127;
  assert.equal(f.controller.snapshot().noteCount,1); assert.equal(f.controller.snapshot().range.low,36);
  const exported = f.controller.exportConfigurationData();
  assert.throws(() => {exported.events[0].mapping[0].offset = 20;},TypeError);
  assert.throws(() => {DEFAULT_KEYBOARD_MAPPING[0].offset = 20;},TypeError);
  assert.equal(validateKeyboardConfiguration().baseMidi,36);
});

test('configuration evidence preserves initial settings, full mapping, receipt order, time basis and visible truncation', () => {
  const f = fixture({configurationLimit:2});
  f.at(200); f.controller.configure({transpose:1},{eventTime:10150,reason:'keyboard_input_transpose'});
  f.at(300); f.controller.configure({transpose:2},{eventTime:0});
  const data = f.controller.exportConfigurationData();
  assert.equal(data.initial_configuration.configuration_id,1); assert.equal(data.initial_configuration.mapping.length,47);
  assert.equal(data.events[1].event_wall_ms,150); assert.equal(data.events[1].received_wall_ms,200); assert.equal(data.events[1].timestamp_basis,'event_epoch');
  assert.equal(data.events[1].scope,'performance_input_only'); assert.equal(data.current_configuration.transpose_semitones,2);
  assert.equal(data.current_configuration.configuration_id,3); assert.equal(data.truncated,true); assert.equal(data.omitted_configurations,1);
  assert.equal(data.first_omitted_received_wall_ms,300); assert.equal(f.changes.length,3,'Adapter sees every configuration despite bounded local export');
  assert.match(data.hardware_rollover,/unknown/);
});

test('existing InputEvidence adapter retains scoped synthetic boundaries and opaque source aliases without inventing duration scoring', () => {
  const evidence = new InputEvidence(); evidence.start();
  evidence.append({kind:'note_on',source:'midi:private-device-id',inputKind:'midi',midi:36,eventWall:90});
  const f = fixture({pressNote:(source,midi,velocity,eventWall,options) => evidence.append({kind:'note_on',source,midi,velocity,eventWall,...options}),
    releaseNote:(source,eventWall,options) => evidence.release({source,eventWall,...options}),
    releaseMatching:(prefix,eventWall,options) => evidence.cancel({prefix,eventWall,...options})});
  f.controller.keydown(f.event('KeyZ')); f.controller.keydown(f.event('KeyX'));
  f.at(120); f.controller.transposeBy(1); f.at(130); f.controller.keyup(f.event('KeyZ')); f.controller.keyup(f.event('KeyX'));
  const exported = evidence.exportData();
  assert.equal(evidence.active.size,1,'Keyboard cleanup cannot silence or cancel MIDI ownership');
  assert.equal(exported.events.filter(event => event.kind === 'synthetic_release').length,2);
  assert.equal(exported.events.filter(event => event.kind === 'note_off').length,2);
  assert.equal(exported.events.filter(event => event.kind === 'note_off').every(event => event.midi === null),true);
  assert.doesNotMatch(JSON.stringify(exported),/private-device-id|key:keyboard-|keyboard-serial/);
  assert.equal(exported.pairing,'not_implemented'); assert.equal(exported.release_assessment,'not_implemented');
});

test('the controller never infers hardware ghosting from absent chord events', () => {
  const f = fixture(); f.controller.keydown(f.event('KeyZ')); f.controller.keydown(f.event('KeyX'));
  const snapshot = f.controller.snapshot();
  assert.equal(snapshot.held.length,2); assert.equal('ghostingDetected' in snapshot,false);
  assert.equal('rolloverLimit' in snapshot,false); assert.match(snapshot.rollover,/missing browser events cannot identify/);
});

test('guard helper uses caller stage authorization and does not expand to free-practice claims elsewhere', () => {
  const f = fixture();
  assert.equal(keyboardInputAllowed(f.event('KeyZ'),{screen:'lobby',freePracticeActive:true}),false);
  assert.equal(keyboardInputAllowed(f.event('KeyZ'),{screen:'stage'}),true);
});

test('free practice routes note keys and transpose arrows only on explicit title and keys surfaces', () => {
  const f = freeFixture();
  for (const id of ['free-title','free-keys']) {
    const note = f.event('KeyZ',{target:f.target(id)});
    assert.equal(f.controller.keydown(note),true,id); assert.equal(note.defaultPrevented,true);
    assert.equal(f.calls.at(-1)[2],36);
    assert.equal(f.controller.keyup(f.event('KeyZ')),true);
    for (const [code,expected] of [['ArrowUp',12],['ArrowRight',13],['ArrowDown',1],['ArrowLeft',0]]) {
      const arrow = f.event(code,{target:f.target(id)});
      assert.equal(f.controller.keydown(arrow),true,`${id} ${code}`); assert.equal(arrow.defaultPrevented,true);
      assert.equal(f.controller.snapshot().transpose,expected); f.controller.keyup(f.event(code));
    }
    const space = f.event('Space',{key:' ',target:f.target(id)});
    assert.equal(f.controller.keydown(space),false); assert.equal(space.defaultPrevented,false,'Transport Space remains outside the controller');
  }
  assert.equal(f.controller.keydown(f.event('KeyX',{target:f.target('free-note-child')})),true);
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('free-note-child')})),false,'Musical buttons retain arrow ownership');
});

test('free practice body, general content, unmarked instruments and other screens never grant capture', () => {
  const f = freeFixture();
  for (const target of [f.document.body,f.document.documentElement,f.target('free-practice-screen'),f.target('free-general'),f.target('keyboard'),f.target('fretboard'),f.target('stage'),f.target('surface'),f.target('nested-note')]) {
    for (const code of ['KeyZ','ArrowUp']) {
      const event = f.event(code,{target});
      assert.equal(f.controller.keydown(event),false,`${target.id || target.tagName} ${code}`);
      assert.equal(event.defaultPrevented,false);
    }
  }
  f.target('free-practice-screen').setAttribute('data-keyboard-performance','');
  assert.equal(f.controller.keydown(f.event('KeyZ',{target:f.target('free-general')})),false,'The screen itself is not an explicit descendant performance surface');
  for (const screen of ['lobby','results',undefined]) {
    assert.equal(keyboardInputAllowed(f.event('KeyZ',{target:f.target('free-title')}),{screen,freePracticeActive:true}),false);
  }
  assert.equal(f.calls.length,0); assert.equal(f.controller.snapshot().transpose,0);
});

test('free performance surfaces preserve hidden, dialog, modifier, repeat and IME guards', () => {
  const f = freeFixture();
  for (const patch of [{hidden:true},{dialogOpen:true},{settingsOpen:true},{composing:true}]) {
    for (const control of [false,true]) {
      assert.equal(keyboardInputAllowed(f.event(control ? 'ArrowUp' : 'KeyZ',{target:f.target('free-title')}),{screen:'free',...patch},{control}),false);
    }
  }
  for (const patch of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{keyCode:229},{key:'Dead'},{key:'Process'},{key:'Unidentified'},{defaultPrevented:true},{repeat:true}]) {
    for (const code of ['KeyZ','ArrowUp']) {
      assert.equal(f.controller.keydown(f.event(code,{target:f.target('free-keys'),...patch})),false,`${code} ${JSON.stringify(patch)}`);
    }
  }
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('free-title'),shiftKey:true})),false);
  assert.equal(f.calls.length,0); assert.equal(f.controller.snapshot().transpose,0);
});

test('free performance markers preserve editable, nested widget and composed-path ownership', () => {
  const f = freeFixture();
  for (const id of ['free-button','free-button-child','free-input','free-textarea','free-select','free-link','free-link-child','free-editor','free-editor-child','free-slider','free-slider-child','free-dialog-child','free-focus-region','free-off-child']) {
    for (const code of ['KeyZ','ArrowUp']) {
      assert.equal(f.controller.keydown(f.event(code,{target:f.target(id)})),false,`${id} ${code}`);
    }
  }
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('free-widget')})),false,'An explicit marker cannot steal focused widget arrows');
  const event = f.event('KeyZ',{target:f.target('free-title'),composedPath:() => [f.target('free-input'),f.target('free-keys'),f.document.body]});
  assert.equal(f.controller.keydown(event),false);
  const outside = f.event('KeyZ',{target:f.target('free-title'),composedPath:() => [f.target('surface'),f.document.body]});
  assert.equal(f.controller.keydown(outside),false,'Retargeting does not grant another screen performance ownership');
  assert.equal(f.calls.length,0); assert.equal(f.controller.snapshot().transpose,0);
});

test('free practice releases the original contact after leaving the screen or changing focus', () => {
  const f = freeFixture();
  f.controller.keydown(f.event('KeyZ',{target:f.target('free-title')}));
  const source = f.calls.at(-1)[1];
  f.controller.contextChanged('screen_changed',120); f.context.screen = 'lobby';
  assert.equal(f.calls.at(-1)[0],'cancel');
  assert.equal(f.controller.keyup(f.event('KeyZ',{target:f.target('input'),ctrlKey:true})),true);
  assert.equal(f.calls.at(-1)[0],'off'); assert.equal(f.calls.at(-1)[1],source);
  assert.equal(f.controller.snapshot().held.length,0);
});

test('retargeted editable controls in a composed event path retain typing ownership', () => {
  const f = fixture();
  const event = f.event('KeyZ',{target:f.target('stage'),composedPath:() => [f.target('input'),f.target('stage'),f.document.body]});
  assert.equal(f.controller.keydown(event),false); assert.equal(f.calls.length,0);
});

test('explicit duplicate-pitch bindings are visible as aliases in the active model', () => {
  const f = fixture({configuration:{mapping:[{code:'KeyZ',offset:0},{code:'KeyX',offset:0}],allowDuplicatePitches:true}});
  assert.deepEqual(f.controller.snapshot().pitchAliases,[{midi:36,codes:['KeyZ','KeyX']}]);
});

test('old async audio unlock cannot admit a later same-pitch contact after release and replay', async () => {
  const audioHeld = new Map(), pending = [], audible = [], calls = [];
  const f = fixture({
    pressNote:async (source,midi) => {
      audioHeld.set(source,midi); calls.push(source);
      await new Promise(resolve => pending.push(resolve));
      if (audioHeld.get(source) === midi) audible.push(source);
    },
    releaseNote:source => audioHeld.delete(source),
    releaseMatching:prefix => {for (const source of audioHeld.keys()) if (source.startsWith(prefix)) audioHeld.delete(source);},
  });
  f.controller.keydown(f.event('KeyZ')); f.controller.keyup(f.event('KeyZ')); f.controller.keydown(f.event('KeyZ'));
  assert.notEqual(calls[0],calls[1],'Every physical contact has a unique callback source, even at the same pitch');
  pending[0](); await Promise.resolve(); assert.deepEqual(audible,[]);
  pending[1](); await Promise.resolve(); assert.deepEqual(audible,[calls[1]]);
  f.controller.configure({transpose:12}); f.controller.configure({transpose:0});
  f.controller.keyup(f.event('KeyZ')); f.controller.keydown(f.event('KeyZ'));
  assert.equal(new Set(calls).size,3); pending[2](); await Promise.resolve(); assert.deepEqual(audible,[calls[1],calls[2]]);
});

test('controller replacement cannot reuse a still-pending old audio ownership source', () => {
  const first = fixture(), replacement = fixture();
  first.controller.keydown(first.event('KeyZ')); replacement.controller.keydown(replacement.event('KeyZ'));
  assert.notEqual(first.calls[0][1],replacement.calls[0][1]);
});

test('a performance marker cannot let a focused real button steal transposition arrows', () => {
  const f = fixture(); f.target('button').setAttribute('data-keyboard-performance','');
  assert.equal(f.controller.keydown(f.event('ArrowUp',{target:f.target('button')})),false);
  assert.equal(f.controller.snapshot().transpose,0);
});

test('mapping cleanup rejects old async unlock after returning to exactly the same pitch', async () => {
  const held = new Map(), pending = [], audible = [];
  const f = fixture({pressNote:async (source,midi) => {
    held.set(source,midi); await new Promise(resolve => pending.push(resolve));
    if (held.get(source) === midi) audible.push(source);
  },releaseMatching:prefix => {for (const source of held.keys()) if (source.startsWith(prefix)) held.delete(source);}});
  f.controller.keydown(f.event('KeyZ')); const previous = f.controller.snapshot().held[0];
  f.controller.configure({transpose:12}); f.controller.configure({transpose:0});
  f.controller.keydown(f.event('KeyZ')); const current = f.controller.snapshot().held[0];
  assert.equal(previous.midi,current.midi); assert.notEqual(previous.source,current.source);
  pending[0](); await Promise.resolve(); assert.deepEqual(audible,[]);
  pending[1](); await Promise.resolve(); assert.deepEqual(audible,[current.source]);
});
