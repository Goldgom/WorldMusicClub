import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANCE_ALGORITHM,ASSISTANCE_SCHEMA_VERSION,ASSISTANCE_PLANNER_REVISION,
  ASSISTANCE_PRESET_REVISION,assistancePresets,assistancePresetId,
  assistancePresetSettings,defaultAssistanceSettings,validateAssistanceSettings,
} from '../web/practice-assistance-receipt.js';
import {
  ASSISTANCE_PREFERENCE_VERSION,PracticeAssistanceStore,
  createPracticeAssistanceController,validateAssistanceRecipe,
} from '../web/practice-assistance.js';
import {assistanceContext,assistanceResponse,memoryStorage} from './practice-assistance-fixtures.js';

const settings=(targets,interval,keys,span)=>({
  algorithm_id:'wmc-keyboard-assistance-v1',max_targets_per_onset:targets,
  min_onset_interval_ms:interval,max_simultaneous_keys:keys,max_held_span_semitones:span,
});
const catalog=[
  {id:'single',settings:settings(1,500,1,0)},
  {id:'balanced',settings:settings(2,250,3,7)},
  {id:'dense',settings:settings(4,125,6,12)},
];

test('revision 1 fixes explicit numeric keyboard configurations and the existing default',()=>{
  assert.equal(ASSISTANCE_PRESET_REVISION,1);
  assert.equal(ASSISTANCE_ALGORITHM,'wmc-keyboard-assistance-v1');
  assert.deepEqual(assistancePresets(),catalog);
  assert.deepEqual(defaultAssistanceSettings(),settings(2,250,3,7));
  assert.deepEqual(assistancePresetSettings('balanced'),defaultAssistanceSettings());
  for(const {id,settings:value} of assistancePresets()){
    assert.equal(validateAssistanceSettings(value),value);
    assert.equal(assistancePresetId(value),id);
    assert.deepEqual(assistancePresetSettings(id),value);
  }
});

test('catalog arrays, entries and settings are independent mutable defensive copies',()=>{
  const first=assistancePresets(),second=assistancePresets();
  assert.notEqual(first,second);
  for(let index=0;index<first.length;index++){
    assert.notEqual(first[index],second[index]);
    assert.notEqual(first[index].settings,second[index].settings);
    first[index].settings.max_targets_per_onset=32;
    first[index].settings.preset_revision=99;
    first[index].id='changed';
  }
  first.reverse();first.push({id:'invented',settings:{}});
  assert.deepEqual(second,catalog);
  assert.deepEqual(assistancePresets(),catalog);
  for(const {id,settings:value} of catalog){
    const picked=assistancePresetSettings(id),again=assistancePresetSettings(id);
    assert.notEqual(picked,again);
    picked.algorithm_id='changed';delete picked.max_simultaneous_keys;
    assert.deepEqual(again,value);
    assert.deepEqual(assistancePresetSettings(id),value);
  }
  const defaults=defaultAssistanceSettings();defaults.max_held_span_semitones=127;
  assert.deepEqual(assistancePresetSettings('balanced'),settings(2,250,3,7));
});

test('matching accepts numeric field order but never alters frozen input',()=>{
  for(const {id,settings:value} of catalog){
    const reversed=Object.freeze(Object.fromEntries(Object.entries(value).reverse()));
    const before=JSON.stringify(reversed);
    assert.equal(assistancePresetId(reversed),id);
    assert.equal(JSON.stringify(reversed),before);
  }
});

test('every numeric edit becomes Custom unless the entire configuration matches',()=>{
  for(const {settings:value} of catalog){
    for(const key of ['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones']){
      const edited=Object.freeze({...value,[key]:value[key]+1});
      assert.equal(validateAssistanceSettings(edited),edited);
      assert.equal(assistancePresetId(edited),'custom');
      assert.equal(edited[key],value[key]+1);
    }
  }
  for(const value of [settings(1,0,1,0),settings(32,60000,32,127),settings(3,175,4,9)]){
    const before=structuredClone(value);
    assert.equal(validateAssistanceSettings(value),value);
    assert.equal(assistancePresetId(value),'custom');
    assert.deepEqual(value,before);
  }
});

test('incomplete, invalid and future settings stay Custom without coercion or repairs',()=>{
  const baseline=settings(2,250,3,7);
  const inherited=Object.create(baseline);
  const invalid=[null,undefined,false,2,'balanced',[],inherited,{},
    {...baseline,algorithm_id:'wmc-keyboard-assistance-v2'},
    {...baseline,max_targets_per_onset:'2'},
    {...baseline,max_targets_per_onset:0},
    {...baseline,max_simultaneous_keys:33},
    {...baseline,min_onset_interval_ms:NaN},
    {...baseline,min_onset_interval_ms:Infinity},
    {...baseline,min_onset_interval_ms:250.1},
    {...baseline,max_held_span_semitones:-1},
    {...baseline,max_held_span_semitones:128},
    {...baseline,preset_id:'balanced'},
    {...baseline,preset_revision:1},
  ];
  for(const key of Object.keys(baseline)){
    const incomplete={...baseline};delete incomplete[key];invalid.push(incomplete);
  }
  for(const value of invalid){
    if(value&&typeof value==='object')Object.freeze(value);
    assert.equal(assistancePresetId(value),'custom');
    assert.throws(()=>validateAssistanceSettings(value),{code:'practice_assistance_invalid'});
  }
  assert.deepEqual(assistancePresets(),catalog);
});

test('unknown preset IDs reject explicitly instead of defaulting or converting Custom',()=>{
  for(const id of ['custom','original','off','Balanced',' balanced ','',null,undefined,1,{},['balanced'],'toString','__proto__']){
    assert.throws(()=>assistancePresetSettings(id),{name:'TypeError',code:'practice_assistance_invalid'});
  }
  assert.deepEqual(defaultAssistanceSettings(),settings(2,250,3,7));
});

function storedRecipe(context,value){
  const response=assistanceResponse(context,{settings:value});
  return{format:'wmc-practice-assistance-recipe',version:1,
    preference_key:context.preferenceKey,source:null,selection:context.selection,
    mode:'automatic',settings:value,planner_revision:1,revision:1,
    expected_selection_digest:response.checked.plan.selection_digest};
}
function harness(context,storage){
  const store=new PracticeAssistanceStore({storage}),calls=[];
  const controller=createPracticeAssistanceController({getContext:()=>context,store,api:async(path,body)=>{
    calls.push({path,body:structuredClone(body)});
    return assistanceResponse(context,{mode:path.endsWith('/original')?'original':'automatic',settings:body.settings??null,selection:body.selection});
  }});
  return{store,controller,calls};
}

test('reading or choosing configurations alone preserves default Original without writes or requests',async()=>{
  const context=assistanceContext({canonical:true}),before=structuredClone(context),storage=memoryStorage();
  const {controller,calls}=harness(context,storage);
  await controller.restore();
  for(const {id} of assistancePresets())assistancePresetId(assistancePresetSettings(id));
  assert.equal(controller.state().phase,'default');
  assert.equal(controller.current(),null);
  controller.beginDraft();
  assert.equal(controller.state().draft.mode,'original');
  assert.equal(controller.state().draft.settings,null);
  assert.equal(assistancePresetId(controller.state().draft.settings),'custom');
  controller.cancelDraft();
  assert.equal(controller.state().phase,'default');
  assert.equal(calls.length,0);
  assert.equal(storage.values.size,0);
  assert.deepEqual(context,before);
});

test('existing numeric recipes restore and match descriptively without new fields or byte migration',async()=>{
  for(const [value,presetId] of [[settings(2,250,3,7),'balanced'],[settings(3,175,4,9),'custom']]){
    const context=assistanceContext({canonical:true}),storage=memoryStorage();
    let writes=0;storage.setItem=()=>{writes++;throw Error('Unexpected recipe rewrite');};
    const {store,controller,calls}=harness(context,storage),recipe=storedRecipe(context,value);
    const raw=JSON.stringify(recipe,null,2),key=store.key(context);storage.values.set(key,raw);
    const read=store.read(context);
    assert.equal(read.status,'saved');
    assert.equal(assistancePresetId(read.recipe.settings),presetId);
    assert.equal(validateAssistanceRecipe(read.recipe,context),read.recipe);
    await controller.restore();
    assert.equal(controller.state().phase,'ready');
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].body.settings,value);
    assert.deepEqual(controller.current().plan.settings,value);
    assert.equal(assistancePresetId(controller.current().plan.settings),presetId);
    controller.beginDraft();
    assert.equal(assistancePresetId(controller.state().draft.settings),presetId);
    controller.cancelDraft();
    assert.equal(storage.values.get(key),raw);
    assert.equal(writes,0);
  }
});

test('preset metadata does not relax recipe, planner or plan version fences',async()=>{
  assert.equal(ASSISTANCE_SCHEMA_VERSION,1);
  assert.equal(ASSISTANCE_PLANNER_REVISION,1);
  assert.equal(ASSISTANCE_PREFERENCE_VERSION,1);
  for(const change of [r=>r.version=2,r=>r.planner_revision=2,r=>r.revision=2,
    r=>r.preset_id='balanced',r=>r.preset_revision=ASSISTANCE_PRESET_REVISION]){
    const context=assistanceContext({canonical:true}),storage=memoryStorage();
    const {store,controller,calls}=harness(context,storage),recipe=storedRecipe(context,settings(2,250,3,7));
    change(recipe);
    const key=store.key(context),raw=JSON.stringify(recipe);storage.values.set(key,raw);
    assert.equal(assistancePresetId(recipe.settings),'balanced');
    assert.throws(()=>validateAssistanceRecipe(recipe,context),{code:'assistance_preference_invalid'});
    await controller.restore();
    assert.equal(controller.state().blocked,true);
    assert.equal(controller.current(),null);
    assert.equal(calls.length,0);
    assert.equal(storage.values.get(key),raw);
  }
});
