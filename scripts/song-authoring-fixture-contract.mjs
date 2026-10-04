// Shared assertions over actual Rust draft responses; never generates a response.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function authoringDraftFingerprint(packageBytes){
  const hash=createHash('sha256').update('worldmusichub-clean-draft-v1\0');
  for(const field of ['metadata_json','score_json']){const bytes=Buffer.from(packageBytes[field]),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(bytes.length));hash.update(length).update(bytes);}
  return hash.digest('hex');
}
const coordinate=origin=>`${origin.track}:${origin.event}`;
export function validateAuthoringDraft(draft,fixture){
  assert.equal(draft.state,fixture.expectedState);
  assert.deepEqual(draft.source,{format:'midi',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256});
  assert.equal(draft.source_name,fixture.filename);assert.equal(typeof draft.title,'string');assert.ok(draft.title.trim().length>0&&Buffer.byteLength(draft.title)<=1000&&!/[\u0000-\u001f\u007f-\u009f]/u.test(draft.title));
  const {parts,...inventory}=draft.inventory;assert.deepEqual(inventory,fixture.inventory);
  assert.deepEqual(inventory.tracks[0].channels,[]);assert.equal(inventory.tracks[0].key_attacks,0);
  if(fixture.id==='blocked'){
    assert.equal(draft.package,null);assert.equal(draft.draft_sha256,null);assert.deepEqual(parts,[]);
    const source=fixture.sourceEvents.find(e=>e.command.kind==='unsupported_controller');
    assert.ok(draft.diagnostics.some(d=>d.code==='complete_conversion_rejected'&&d.source_event_id===source.event_id&&d.track_index===source.origin.track));
    return{metadata:null,score:null,inventory:draft.inventory};
  }
  assert.deepEqual(Object.keys(draft.package).sort(),['metadata_json','score_json']);
  assert.equal(draft.draft_sha256,authoringDraftFingerprint(draft.package));
  const metadata=JSON.parse(draft.package.metadata_json),score=JSON.parse(draft.package.score_json);
  assert.equal(metadata.format,'worldmusichub-song');assert.equal(metadata.version,2);assert.equal(metadata.score.path,'score.json');
  assert.equal(score.format,'worldmusichub-complete-score');assert.equal(score.version,fixture.id==='strict'?1:2);
  assert.equal(metadata.id,`midi-clean-${fixture.manifest.sha256}`);assert.equal(metadata.title,draft.title);
  assert.equal(metadata.score.bytes,Buffer.byteLength(draft.package.score_json));assert.equal(metadata.score.sha256,digest(draft.package.score_json));
  assert.deepEqual(metadata.sources,[draft.source]);assert.deepEqual(metadata.media,[]);
  assert.equal(metadata.rights.status,'user_supplied_unverified');assert.deepEqual(score.source,draft.source);
  assert.equal(score.performance.profile,fixture.expectedProfile);assert.equal(parts.length,2);
  const expectedParts=fixture.inventory.tracks.flatMap(t=>t.channels.filter(c=>c.key_attacks||c.key_releases).map(c=>({id:`midi-t${t.source_index+1}-c${c.channel+1}`,track_id:t.track_id,channel:c.channel,notation_available:fixture.id==='strict'})));
  assert.deepEqual(parts,expectedParts);
  assert.deepEqual(score.performance.parts.map(({id,track_id,channel})=>({id,track_id,channel})),expectedParts.map(({notation_available,...p})=>p));
  assert.deepEqual(score.performance.tracks,fixture.inventory.tracks.map(t=>({id:t.track_id,name:t.name,source_index:t.source_index,source_event_count:t.source_event_count,end:t.end})));
  const original=new Map(fixture.sourceEvents.map(e=>[coordinate(e.origin),e])),represented=new Set();
  const events=fixture.sourceEvents.filter(e=>fixture.id!=='strict'||!['key_attack','key_release'].includes(e.command.kind)).sort((a,b)=>a.tick-b.tick||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
  assert.deepEqual(score.performance.events.map(e=>e.origin),events.map(e=>e.origin),'The complete original event order must remain stable');
  assert.deepEqual(score.performance.end,{numerator:4,denominator:1});
  for(const e of score.performance.events){
    const key=coordinate(e.origin),source=original.get(key);assert.ok(source,key);assert.ok(!represented.has(key),key);represented.add(key);
    assert.deepEqual(e.at,source.at);const {part_id,...command}=e.command;assert.deepEqual(command,source.command);
    if(['key_attack','key_release'].includes(command.kind))assert.equal(part_id,`midi-t${e.origin.track+1}-c${command.channel+1}`);
    if(fixture.id==='events')assert.equal(e.event_id,source.event_id);
  }
  if(fixture.id==='strict'){
    assert.equal(score.notation.source,null);assert.equal(score.coverage.status,'complete');
    assert.equal(score.notation.id,metadata.id);assert.deepEqual(score.notation.parts.map(p=>p.id),expectedParts.map(p=>p.id));
    const notes=new Map(score.notation.parts.flatMap(p=>p.notes.map(n=>[n.id,{...n,part_id:p.id}])));
    for(const note of score.performance.notes){
      for(const key of ['attack','release']){const id=coordinate(note[key]);assert.ok(!represented.has(id));represented.add(id);}
      const attack=original.get(coordinate(note.attack)),release=original.get(coordinate(note.release)),written=notes.get(note.note_id);
      assert.equal(attack.command.kind,'key_attack');assert.equal(release.command.kind,'key_release');assert.equal(attack.command.key,release.command.key);assert.equal(attack.command.channel,release.command.channel);assert.equal(attack.origin.track,release.origin.track);
      assert.equal(note.part_id,`midi-t${attack.origin.track+1}-c${attack.command.channel+1}`);assert.equal(written.part_id,note.part_id);
      assert.equal(note.release_velocity,release.command.velocity);assert.deepEqual(written.at,attack.at);
      const midi=(written.pitch.octave+1)*12+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[written.pitch.step]+written.pitch.alter;
      assert.equal(midi,attack.command.key);assert.equal(written.velocity,attack.command.velocity);
      assert.equal(written.duration.numerator*480/written.duration.denominator,release.tick-attack.tick);
    }
    assert.equal(score.performance.notes.length,fixture.inventory.key_attacks);
  }else{
    assert.equal(score.id,metadata.id);assert.equal(score.notation,null);assert.equal('notes' in score.performance,false);
    assert.equal(score.coverage.notation.status,'unavailable');assert.equal(score.coverage.targets.represented_attacks,0);
  }
  assert.equal(fixture.id==='strict'?score.notation.title:score.title,draft.title);
  assert.deepEqual([...represented].sort(),[...original.keys()].sort(),'Every original event must be represented once');
  const coverage=score.coverage.performance??score.coverage;assert.equal(coverage.source_tracks,fixture.inventory.source_tracks);assert.equal(coverage.source_events,fixture.inventory.source_events);assert.equal(coverage.represented_events,fixture.inventory.source_events);
  if(fixture.id==='strict')assert.equal(coverage.pitched_notes,fixture.inventory.key_attacks);
  else{assert.equal(coverage.key_attacks,fixture.inventory.key_attacks);assert.equal(coverage.key_releases,fixture.inventory.key_releases);assert.equal(score.coverage.notation.represented_attacks,0);assert.equal(score.coverage.targets.status,'unavailable');}
  return{metadata,score,inventory:draft.inventory};
}
