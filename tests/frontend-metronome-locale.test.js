import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {setupMetronome,validateMetronomeGrid,scopedClicks,ClickScheduler} from '../web/metronome.js';

const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const grid=(overrides={})=>({pulse:'notated_unit',accent_policy:'written_measure_boundary',duration_ms:2000,ticks:[0,500,1000,1500].map((start_ms,index)=>({id:`tick-${index}`,start_ms,accent:index===0})),diagnostics:[],...overrides});
function fixture({locale='zh-CN',api}={}) {
  const {document,window}=parseHTML('<html><body><section aria-label="Metronome"><label><input id="metronome-enabled" type="checkbox">Click track</label><label>Pulse<select id="metronome-pulse"><option value="notated_unit" selected>Notated</option><option value="quarter">Quarter</option><option value="dotted_quarter">Dotted</option></select></label><label>Level<input id="metronome-level" type="range" value="25"><span id="metronome-level-value"></span></label><p id="metronome-status"></p><ul id="metronome-diagnostics"></ul><input id="count-in" type="checkbox"></section></body></html>');
  const prototype=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
  Object.defineProperty(prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  const i18n=createI18n({locale,onReport:report=>assert.fail(JSON.stringify(report))}),score={id:'source-preserved'},counts={api:0,score:0,duration:0,window:0,clock:0,countIn:0,silence:0},clicks=[];
  const synth={muted:false,silenceClicks(){counts.silence++},click(...args){clicks.push(args)}};
  let loop=null;
  const instance=setupMetronome({document,i18n,synth,api:async(...args)=>{counts.api++;return api?api(...args):grid()},getScore:()=>{counts.score++;return score},getDuration:()=>{counts.duration++;return 2000},getWindow:()=>{counts.window++;return loop},getPlayback:()=>{counts.clock++;return {running:false}},getCountInMs:()=>{counts.countIn++;return 0}});
  return {document,window,i18n,score,counts,clicks,synth,instance,$:id=>document.getElementById(id),setLoop(value){loop=value},enable(){document.getElementById('metronome-enabled').checked=true;document.getElementById('metronome-enabled').dispatchEvent(new window.Event('change'))},restore(){instance.destroy();if(descriptor)Object.defineProperty(prototype,'value',descriptor);else delete prototype.value}};
}

test('metronome locale change updates labels and ARIA while off without touching score, audio or drafts',()=>{
  const f=fixture();try {
    assert.match(f.$('metronome-status').textContent,/已关闭/);assert.equal(f.$('metronome-enabled').getAttribute('aria-label'),'节拍器');
    const pulse=f.$('metronome-pulse'),option=pulse.querySelector('option[value="quarter"]');pulse.value='quarter';f.$('metronome-level').value='77';f.document.activeElement=pulse;
    const counts={...f.counts};f.i18n.setLocale('en');
    assert.match(f.$('metronome-status').textContent,/^Off/);assert.equal(pulse.getAttribute('aria-label'),'Pulse');assert.equal(f.$('metronome-level').getAttribute('aria-label'),'Click level');
    assert.equal(pulse.value,'quarter');assert.equal(pulse.querySelector('option[value="quarter"]'),option);assert.equal(f.document.activeElement,pulse);assert.equal(f.$('metronome-level').value,'77');assert.equal(f.$('metronome-level-value').textContent,'77%');
    assert.deepEqual(f.counts,counts);assert.deepEqual(f.clicks,[]);
  }finally{f.restore();}
});

test('in-flight metronome preparation retains its request and resolves into the currently selected locale',async()=>{
  let finish,signal;const f=fixture({api:(_url,_body,abort)=>{signal=abort;return new Promise(resolve=>{finish=resolve})}});
  try {
    f.enable();assert.equal(f.counts.api,1);assert.match(f.$('metronome-status').textContent,/正在依据/);const counts={...f.counts};
    f.i18n.setLocale('en');assert.deepEqual(f.counts,counts);assert.equal(signal.aborted,false);assert.match(f.$('metronome-status').textContent,/Preparing optional clicks/);
    finish(grid());await settle();assert.match(f.$('metronome-status').textContent,/^4 Rust-timed clicks/);assert.equal(f.counts.api,1);
    const readyCounts={...f.counts};f.i18n.setLocale('zh-CN');assert.match(f.$('metronome-status').textContent,/4 个/);assert.deepEqual(f.counts,readyCounts);
  }finally{f.restore();}
});

test('ready metronome locale redraw preserves scheduler cursor, exact click identity and mute presentation',async()=>{
  const f=fixture({locale:'en'});try {
    f.enable();await settle();const clock={running:true,position:0,segment:10,startPosition:0};f.instance.advance(clock);
    assert.equal(f.clicks.length,1);const first=[...f.clicks[0]],counts={...f.counts};f.i18n.setLocale('zh-CN');
    assert.deepEqual(f.counts,counts);assert.equal(f.clicks.length,1);f.instance.advance(clock);assert.equal(f.clicks.length,1,'Already scheduled click must not replay after a locale change');
    f.instance.advance({...clock,position:450});assert.equal(f.clicks.length,2);assert.equal(f.clicks[1][0],'click:10:tick-1');assert.deepEqual(f.clicks[0],first);
    f.synth.muted=true;f.instance.updateMute();assert.match(f.$('metronome-status').textContent,/全局声音已静音/);const mutedCounts={...f.counts};f.i18n.setLocale('en');assert.match(f.$('metronome-status').textContent,/Global sound is muted/);assert.deepEqual(f.counts,mutedCounts);
    assert.equal(f.$('metronome-enabled').checked,true);assert.deepEqual(f.score,{id:'source-preserved'});
  }finally{f.restore();}
});

test('known metronome codes have localized summaries and retain exact external diagnostic text in disclosures',async()=>{
  const original='<script>Some written measures differ & 保留原文</script>',unknown='Unknown engine diagnostic: C# major & sourceId';
  const diagnostics=[{code:'metronome_irregular_measures',message:original},{code:'metronome_compound_policy',message:'Explicit eighth policy'},{code:'__proto__',message:unknown}];
  const response=grid({diagnostics}),before=structuredClone(response),f=fixture({api:()=>response});
  try {
    f.enable();await settle();const first=f.$('metronome-diagnostics').children[0],details=first.querySelector('details');details.open=true;f.document.activeElement=details.querySelector('summary');
    assert.match(first.querySelector('span').textContent,/部分谱面小节/);assert.equal(details.querySelector('p').textContent,original);assert.equal(first.querySelector('script'),null);
    const counts={...f.counts};f.i18n.setLocale('en');assert.deepEqual(f.counts,counts);assert.equal(f.$('metronome-diagnostics').children[0],first);assert.equal(details.open,true);assert.equal(f.document.activeElement,details.querySelector('summary'));
    assert.match(first.querySelector('span').textContent,/written measures/);assert.equal(details.querySelector('summary').textContent,'Original technical details');assert.equal(details.querySelector('p').textContent,original);
    const last=f.$('metronome-diagnostics').lastElementChild;assert.equal(last.querySelector('span').textContent,'The score engine reported a diagnostic.');assert.equal(last.querySelector('p').textContent,unknown);assert.deepEqual(response,before);
  }finally{f.restore();}
});

test('metronome local validation codes and external failure detail redraw without retrying or sounding',async()=>{
  assert.throws(()=>validateMetronomeGrid({},'notated_unit',2000),{code:'metronome_invalid_response'});
  assert.throws(()=>validateMetronomeGrid(grid({ticks:[{id:'bad',start_ms:-1,accent:false}]}),'notated_unit',2000),{code:'metronome_invalid_timing'});
  assert.throws(()=>scopedClicks(grid(),{from:3,to:1}),{code:'metronome_invalid_window'});
  assert.throws(()=>scopedClicks(grid({ticks:[{id:'1',start_ms:0,accent:false},{id:'2',start_ms:50,accent:false}]})),{code:'metronome_too_dense'});
  assert.throws(()=>new ClickScheduler(grid().ticks).due({position:300,segment:1,startPosition:0}),{code:'metronome_late'});
  for(const isExternal of [true,false]) {
    const original='<img src=x> Remote error & source detail';
    const f=fixture({api:()=>{if(isExternal)throw Error(original);return grid({duration_ms:1200})}});
    try {
      f.enable();await settle();assert.equal(f.$('metronome-enabled').checked,false);assert.match(f.$('metronome-status').textContent,/节拍器已关闭/);
      assert.equal(f.$('metronome-error-details').hidden,!isExternal);assert.equal(f.$('metronome-error-details').querySelector('p').textContent,isExternal?original:'');
      const counts={...f.counts};f.i18n.setLocale('en');assert.deepEqual(f.counts,counts);assert.equal(f.clicks.length,0);
      assert.match(f.$('metronome-status').textContent,isExternal?/could not prepare or play/:/response is incomplete/);assert.equal(f.$('metronome-error-details').querySelector('img'),null);
    }finally{f.restore();}
  }
});

test('locale redraw does not rescope loops, clear diagnostics, or change a pending pulse selection',async()=>{
  const f=fixture({api:()=>grid({diagnostics:Array.from({length:102},()=>({code:'future_code',message:'Retained detail'}))})});
  try {
    f.enable();await settle();f.setLoop({start_ms:400,end_ms:1100});f.instance.reset();assert.match(f.$('metronome-status').textContent,/2 个/);
    f.$('metronome-pulse').value='dotted_quarter';const counts={...f.counts};f.i18n.setLocale('en');
    assert.deepEqual(f.counts,counts);assert.equal(f.$('metronome-pulse').value,'dotted_quarter');assert.match(f.$('metronome-status').textContent,/^2 Rust-timed/);assert.equal(f.$('metronome-diagnostics').children.length,101);assert.match(f.$('metronome-more-diagnostics').textContent,/2 further score diagnostics/);
  }finally{f.restore();}
});
