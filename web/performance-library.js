import {FREE_RECORD_FORMAT, FREE_INPUT_KINDS, FREE_RECORD_SCOPE, FREE_CLOSURE_POLICY, FREE_RECORD_LIMITS, freeObservationStorageBytes, freeConfigurationStorageBytes, validateFreeKeyboardConfiguration} from './free-practice-recorder.js';

/** Append-only, origin-local sealed recordings. Separate from the saved-score database. */
export const PERFORMANCE_LIBRARY_LIMITS = Object.freeze({records:100, recordBytes:16*1024*1024, totalBytes:64*1024*1024, backupBytes:80*1024*1024});
export const PERFORMANCE_BACKUP_FORMAT = 'worldmusichub-performance-backup';
const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).byteLength;
const fail = (code, message = code) => Object.assign(new Error(message), {code});
const invalid = path => { throw fail('performance.invalid_record', `Invalid performance field: ${path}`); };
const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;
const time = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const inputKinds = new Set(FREE_INPUT_KINDS);
const alias = (value,prefix) => typeof value === 'string' && new RegExp(`^${prefix}-[1-9][0-9]{0,5}$`).test(value) && Number(value.split('-')[1]) <= FREE_RECORD_LIMITS.events;
const reason = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const controllers = 'only CC120/123 cleanup is observed; pedals and other controllers are not captured';
function object(value, keys, path) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || ![null,Object.prototype].includes(Object.getPrototypeOf(value))) invalid(path);
 const names = Reflect.ownKeys(value);
 if (names.length !== keys.length || names.some(key => !keys.includes(key))) invalid(path);
 for (const key of names) { const descriptor = Object.getOwnPropertyDescriptor(value,key); if (!descriptor.enumerable || !Object.hasOwn(descriptor,'value')) invalid(`${path}.${key}`); }
}
function array(value,max,path,min = 0) {
 if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid(path);
 for (let i = 0; i < value.length; i++) { const descriptor = Object.getOwnPropertyDescriptor(value,String(i)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) invalid(`${path}[${i}]`); }
}
function configValue(key,value) {
 switch(key) {
  case 'keyboard_configuration': try { return validateFreeKeyboardConfiguration(value); } catch { return false; }
  case 'sound': return typeof value === 'boolean';
  case 'instrument': return ['piano','guitar'].includes(value);
  case 'keyboard_base_midi': return integer(value,0,127);
  case 'keyboard_octave_shift': return integer(value,-10,10);
  case 'keyboard_semitone_transpose': return integer(value,-127,127);
  default: return false;
 }
}
function route(segments,eventTime) {
 // A binary search avoids events × segments work at the supported bounds.
 let low = 0, high = segments.length - 1, found = null;
 while (low <= high) { const mid = (low + high) >>> 1; if (segments[mid].start_wall_ms <= eventTime) { found = segments[mid]; low = mid + 1; } else high = mid - 1; }
 return found && eventTime < found.end_wall_ms ? found.id : null;
}

/** Strict v1 validation; never rewrites, sorts, fills fields or infers releases. */
export function validatePerformanceRecord(record) {
 object(record,['format','version','id','revision','mode','created_at','stopped_at','state','score_context','clock','segments','configuration','observations','capabilities','closure'],'record');
 if (record.format !== FREE_RECORD_FORMAT || record.version !== 1) throw fail('performance.unsupported_version','Unsupported performance format or version. Keep the original file for a compatible app.');
 if (!identity(record.id) || record.revision !== 1 || record.mode !== 'free' || record.state !== 'stopped' || record.score_context !== null || !iso(record.created_at) || !iso(record.stopped_at) || record.stopped_at < record.created_at) invalid('identity or sealed state');
 const clock = record.clock;
 object(clock,['domain_id','unit','origin_monotonic_ms','stopped_monotonic_ms','basis','gap_policy'],'clock');
 if (clock.domain_id !== `free:${record.id}` || clock.unit !== 'ms' || clock.basis !== 'page_monotonic' || clock.gap_policy !== 'preserved' || !time(clock.origin_monotonic_ms) || !time(clock.stopped_monotonic_ms) || clock.stopped_monotonic_ms < clock.origin_monotonic_ms) invalid('clock');
 const origin = clock.origin_monotonic_ms, stopped = clock.stopped_monotonic_ms;
 array(record.segments,FREE_RECORD_LIMITS.segments,'segments',1);
 let previousEnd = origin;
 record.segments.forEach((segment,index) => {
  object(segment,['id','start_wall_ms','end_wall_ms'],`segments[${index}]`);
  if (segment.id !== index + 1 || !time(segment.start_wall_ms) || !time(segment.end_wall_ms) || segment.start_wall_ms < previousEnd || segment.end_wall_ms < segment.start_wall_ms || segment.end_wall_ms > stopped || (!index && segment.start_wall_ms !== origin)) invalid(`segments[${index}]`);
  previousEnd = segment.end_wall_ms;
 });
 array(record.configuration,FREE_RECORD_LIMITS.configurations,'configuration');
 let lastConfiguration = origin, configurationBytes = 2, lastKeyboardId = 0;
 record.configuration.forEach((item,index) => {
  object(item,['sequence','wall_ms','key','value'],`configuration[${index}]`);
  if (item.sequence !== index + 1 || !time(item.wall_ms) || item.wall_ms < lastConfiguration || item.wall_ms > stopped || !configValue(item.key,item.value)) invalid(`configuration[${index}]`);
  configurationBytes += freeConfigurationStorageBytes(item);
  if (configurationBytes > FREE_RECORD_LIMITS.configurationBytes) invalid('configuration byte budget');
  if (item.key === 'keyboard_configuration') {
   if (item.value.configuration_id <= lastKeyboardId) invalid('keyboard configuration identity order');
   lastKeyboardId = item.value.configuration_id;
  }
  lastConfiguration = item.wall_ms;
 });
 object(record.capabilities,['assessment','audio_capture','release_pairing','duration_inference','physical_fingering'],'capabilities');
 if (Object.values(record.capabilities).some(value => value !== false)) invalid('capabilities');
 object(record.closure,['late_delivery_grace_ms','policy'],'closure');
 if (record.closure.late_delivery_grace_ms !== 0 || record.closure.policy !== FREE_CLOSURE_POLICY) invalid('closure');
 const observations = record.observations;
 object(observations,['version','scope','event_order','pairing','release_assessment','duration_eligibility','controllers','limit','truncated','omitted_observations','first_omitted_received_wall_ms','byte_limit','estimated_retained_bytes','omission_reason','sources','events'],'observations');
 if (observations.version !== 1 || observations.scope !== FREE_RECORD_SCOPE || observations.event_order !== 'receipt_order' || observations.pairing !== 'not_implemented' || observations.release_assessment !== 'not_implemented' || observations.duration_eligibility !== 'unknown' || observations.controllers !== controllers || !integer(observations.limit,1,FREE_RECORD_LIMITS.events)) invalid('observations semantics');
 array(observations.events,observations.limit,'events',1);
 array(observations.sources,observations.events.length,'sources');
 const sources = new Map();
 observations.sources.forEach((source,index) => {
  object(source,['id','generation','input_kind'],`sources[${index}]`);
  if (source.id !== `source-${index + 1}` || !(source.generation === null || alias(source.generation,'generation')) || !inputKinds.has(source.input_kind)) invalid(`sources[${index}]`);
  sources.set(source.id,source);
 });
 const seenSources = new Set(), seenGenerations = new Set();
 let lastReceipt = origin, retainedBytes = 0;
 observations.events.forEach((event,index) => {
  object(event,['event_id','kind','source_id','source_generation','input_kind','channel','midi','velocity','encoding','reason','event_wall_ms','received_wall_ms','timestamp_basis','raw_timestamp_ms','boundary_wall_ms','onset_capture','event_ms','received_ms','segment_id','routing','velocity_provenance'],`events[${index}]`);
  const path = `events[${index}]`;
  retainedBytes += freeObservationStorageBytes(event,event.source_id !== null && !seenSources.has(event.source_id));
  if (event.event_id !== index + 1 || !['note_on','note_off','boundary','synthetic_release'].includes(event.kind) || !time(event.event_wall_ms) || !time(event.received_wall_ms) || event.event_wall_ms > event.received_wall_ms || event.received_wall_ms < lastReceipt || event.received_wall_ms > stopped || event.event_ms !== event.event_wall_ms - origin || event.received_ms !== event.received_wall_ms - origin || event.onset_capture !== null) invalid(path);
  lastReceipt = event.received_wall_ms;
  if (event.source_generation !== null) {
   if (!alias(event.source_generation,'generation')) invalid(`${path}.source_generation`);
   if (!seenGenerations.has(event.source_generation)) { if (event.source_generation !== `generation-${seenGenerations.size + 1}`) invalid(`${path}.source_generation`); seenGenerations.add(event.source_generation); }
  }
  if (event.source_id !== null) {
   const source = sources.get(event.source_id);
   if (!source || source.generation !== event.source_generation || source.input_kind !== event.input_kind) invalid(`${path}.source_id`);
   if (!seenSources.has(source.id)) { if (source.id !== `source-${seenSources.size + 1}`) invalid(`${path}.source_id`); seenSources.add(source.id); }
  } else if (event.kind !== 'boundary' || event.input_kind !== null) invalid(`${path}.source_id`);
  if (!(event.channel === null || integer(event.channel,0,15)) || !(event.midi === null || integer(event.midi,0,127)) || !(event.velocity === null || integer(event.velocity,0,127)) || !(event.encoding === null || (typeof event.encoding === 'string' && event.encoding.length <= 64)) || !(event.reason === null || reason(event.reason)) || !['application_clock','event_monotonic','event_epoch','event_clamped','receipt_fallback'].includes(event.timestamp_basis) || !(event.raw_timestamp_ms === null || (Number.isFinite(event.raw_timestamp_ms) && Math.abs(event.raw_timestamp_ms) <= Number.MAX_SAFE_INTEGER)) || !(event.boundary_wall_ms === null || (time(event.boundary_wall_ms) && event.boundary_wall_ms === event.event_wall_ms))) invalid(path);
  const note = event.kind === 'note_on' || event.kind === 'note_off';
  if (note && (event.source_id === null || event.reason !== null || event.boundary_wall_ms !== null)) invalid(path);
  if (event.kind === 'note_on' && event.midi === null) invalid(`${path}.midi`);
  if (event.kind === 'synthetic_release' && (event.source_id === null || event.midi === null)) invalid(path);
  if (!note && (event.reason === null || event.velocity !== null || event.encoding !== null || event.timestamp_basis !== 'application_clock' || event.raw_timestamp_ms !== null || (event.reason === 'free_start' ? event.boundary_wall_ms !== null : event.boundary_wall_ms !== event.event_wall_ms))) invalid(path);
  if (event.kind === 'boundary' && event.midi !== null) invalid(path);
  const segment = route(record.segments,event.event_wall_ms);
  if (event.segment_id !== segment || event.routing !== (segment !== null ? 'recording_segment' : event.event_wall_ms < origin ? 'before_start' : 'outside_recording_segment')) invalid(`${path}.routing`);
  const provenance = event.input_kind === 'midi' ? 'midi_message' : event.velocity === null ? null : 'ui_default';
  if (event.velocity_provenance !== provenance) invalid(`${path}.velocity_provenance`);
 });
 if (observations.byte_limit !== FREE_RECORD_LIMITS.observationBytes || observations.estimated_retained_bytes !== retainedBytes || retainedBytes > observations.byte_limit) invalid('observation byte budget');
 if (seenSources.size !== sources.size) invalid('unused source mappings');
 const first = observations.events[0];
 if (first.kind !== 'boundary' || first.reason !== 'free_start' || first.event_wall_ms !== origin || first.received_wall_ms !== origin || first.source_id !== null || first.source_generation !== null) invalid('start boundary');
 if (typeof observations.truncated !== 'boolean' || !integer(observations.omitted_observations,0,Number.MAX_SAFE_INTEGER)) invalid('truncation');
 if (observations.truncated) {
  if (observations.omitted_observations < 1 || !['event_limit','byte_limit'].includes(observations.omission_reason) || (observations.omission_reason === 'event_limit' && observations.events.length !== observations.limit) || (observations.omission_reason === 'byte_limit' && observations.byte_limit - retainedBytes > 2048) || !time(observations.first_omitted_received_wall_ms) || observations.first_omitted_received_wall_ms < lastReceipt || observations.first_omitted_received_wall_ms > stopped) invalid('truncation');
 } else {
  if (observations.omitted_observations !== 0 || observations.first_omitted_received_wall_ms !== null || observations.omission_reason !== null || !observations.events.some(event => event.kind === 'boundary' && event.reason === 'free_stop' && event.event_wall_ms === stopped)) invalid('stop boundary or truncation');
 }
 const raw = JSON.stringify(record);
 if (bytes(raw) > PERFORMANCE_LIBRARY_LIMITS.recordBytes) throw fail('performance.record_bytes','This performance exceeds the 16 MiB saved-record limit.');
 return true;
}
function snapshot(record,label = null) {
 if (label !== null && (typeof label !== 'string' || label.length > 200)) throw fail('performance.invalid_label','A performance label must contain at most 200 characters.');
 validatePerformanceRecord(record);
 const raw = JSON.stringify(record);
 return {raw,bytes:bytes(raw),label:label?.trim() || null,record_id:record.id,record_revision:record.revision,created_at:record.created_at,stopped_at:record.stopped_at,format:record.format,mode:record.mode,state:'stopped'};
}
function metadata(row) {
 object(row,['bytes','label','record_id','record_revision','created_at','stopped_at','format','mode','state','key','revision','saved_at'],'metadata');
 if (!identity(row.key) || row.revision !== 1 || !identity(row.record_id) || row.record_revision !== 1 || !integer(row.bytes,1,PERFORMANCE_LIBRARY_LIMITS.recordBytes) || !(row.label === null || (typeof row.label === 'string' && row.label.length <= 200)) || !iso(row.created_at) || !iso(row.stopped_at) || row.stopped_at < row.created_at || !iso(row.saved_at) || row.format !== FREE_RECORD_FORMAT || row.mode !== 'free' || row.state !== 'stopped') throw fail('performance.corrupt_storage','The performance library has invalid metadata.');
}
function limits(rows,items) {
 if (rows.length + items.length > PERFORMANCE_LIBRARY_LIMITS.records) throw fail('performance.record_limit','The performance library holds at most 100 recordings. Existing recordings were kept.');
 for (const row of rows) metadata(row);
 if ([...rows,...items].reduce((sum,row) => sum + row.bytes,0) > PERFORMANCE_LIBRARY_LIMITS.totalBytes) throw fail('performance.total_bytes','The performance library is limited to 64 MiB. Existing recordings were kept.');
}
function storageError(error) {
 if (error?.code?.startsWith?.('performance.')) return error;
 return fail(error?.name === 'QuotaExceededError' ? 'performance.quota' : 'performance.storage',error?.name === 'QuotaExceededError' ? 'Browser storage is full. The stopped recording can still be exported or saved again.' : error?.message || 'Local performance storage is unavailable. Keep an exported recording instead.');
}
function parse(text,max) {
 if (typeof text !== 'string' || bytes(text) > max) throw fail('performance.import_bytes','The performance import exceeds its byte limit.');
 try { return JSON.parse(text); } catch { throw fail('performance.invalid_json','This file is not valid performance JSON.'); }
}
function parseBackup(text) {
 const data = parse(text,PERFORMANCE_LIBRARY_LIMITS.backupBytes);
 object(data,['format','version','exported_at','entries'],'backup');
 if (data.format !== PERFORMANCE_BACKUP_FORMAT || data.version !== 1) throw fail('performance.unsupported_version','Unsupported performance backup format or version.');
 if (!iso(data.exported_at)) invalid('backup.exported_at');
 array(data.entries,PERFORMANCE_LIBRARY_LIMITS.records,'backup.entries');
 return data.entries.map((entry,index) => { object(entry,['label','record'],`entries[${index}]`); return snapshot(entry.record,entry.label); });
}

export function openPerformanceLibrary({factory = globalThis.indexedDB,name = 'worldmusichub.performances'} = {}) {
 return new Promise((resolve,reject) => {
  if (!factory) { reject(fail('performance.unavailable','This browser does not provide local performance storage. Export the stopped recording instead.')); return; }
  let request, settled = false;
  try { request = factory.open(name,1); } catch (error) { reject(storageError(error)); return; }
  request.onupgradeneeded = event => {
   if (settled) { request.transaction.abort(); return; }
   try {
    if (event.oldVersion === 0) { request.result.createObjectStore('metadata',{keyPath:'key'}); request.result.createObjectStore('records',{keyPath:'key'}); }
   } catch (error) { settled = true; request.transaction.abort(); reject(storageError(error)); }
  };
  request.onblocked = () => { settled = true; reject(fail('performance.blocked','Another tab is blocking the performance library. Close that tab and try again; recordings were not reset.')); };
  request.onerror = () => { settled = true; reject(storageError(request.error)); };
  request.onsuccess = () => {
   if (settled) { request.result.close(); return; }
   const db = request.result;
   if (!db.objectStoreNames.contains('metadata') || !db.objectStoreNames.contains('records')) { settled = true; db.close(); reject(fail('performance.corrupt_storage','The performance library is incomplete. It was not reset.')); return; }
   settled = true; resolve(new PerformanceLibrary(db));
  };
 });
}
class PerformanceLibrary {
 constructor(db) { this.db = db; this.closed = false; db.onversionchange = () => this.close(); }
 close() { this.closed = true; this.db.close(); }
 operation(mode,start) {
  if (this.closed) return Promise.reject(fail('performance.closed','The performance library was closed or upgraded in another tab. Reload before saving.'));
  return new Promise((resolve,reject) => {
   let tx,result,failure;
   try { tx = this.db.transaction(['metadata','records'],mode); } catch (error) { reject(storageError(error)); return; }
   const abort = error => { failure = error; try { tx.abort(); } catch { reject(storageError(error)); } };
   tx.oncomplete = () => resolve(result);
   tx.onabort = () => reject(storageError(failure || tx.error));
   tx.onerror = () => { failure ||= tx.error; };
   try { start(tx,value => { result = value; },abort); } catch (error) { abort(error); }
  });
 }
 list() { return this.operation('readonly',(tx,done,abort) => { const request = tx.objectStore('metadata').getAll(); request.onsuccess = () => { try { limits(request.result,[]); done(request.result.sort((a,b) => b.saved_at.localeCompare(a.saved_at) || a.key.localeCompare(b.key))); } catch (error) { abort(error); } }; }); }
 get(key) {
  if (!identity(key)) return Promise.reject(fail('performance.invalid_key','Invalid saved-performance key.'));
  return this.operation('readonly',(tx,done,abort) => {
   const metadata = tx.objectStore('metadata').get(key), payload = tx.objectStore('records').get(key);
   let row,stored,count = 0;
   const finish = () => { if (++count !== 2) return; try { if (!row && !stored) { done(null); return; } done(this.readStored(row,stored)); } catch (error) { abort(error); } };
   metadata.onsuccess = () => { row = metadata.result; finish(); }; payload.onsuccess = () => { stored = payload.result; finish(); };
  });
 }
 load(key) { return this.get(key); }
 readStored(row,stored) {
  if (!row || !stored || row.key !== stored.key || row.revision !== 1 || !iso(row.saved_at) || typeof stored.raw !== 'string' || bytes(stored.raw) !== row.bytes) throw fail('performance.corrupt_storage','A saved recording is incomplete or inconsistent. It was not changed.');
  metadata(row);
  const record = parse(stored.raw,PERFORMANCE_LIBRARY_LIMITS.recordBytes), checked = snapshot(record,row.label);
  if (Object.keys(checked).filter(key => key !== 'raw').some(key => checked[key] !== row[key])) throw fail('performance.corrupt_storage','A saved recording does not match its metadata. It was not changed.');
  return {...row,record};
 }
 save(record,options = {}) {
  let item;
  try { if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'label')) throw fail('performance.immutable','Saved performances are immutable. Save creates a new local copy; replacement options are not supported.'); item = snapshot(record,options.label ?? null); }
  catch (error) { return Promise.reject(error); }
  return this.append([item]).then(rows => rows[0]);
 }
 append(items) {
  return this.operation('readwrite',(tx,done,abort) => {
   const metadata = tx.objectStore('metadata'), request = metadata.getAll();
   request.onsuccess = () => { try {
    limits(request.result,items);
    const rows = [], now = new Date().toISOString();
    for (const item of items) {
     const {raw,...fields} = item, key = globalThis.crypto.randomUUID();
     const row = {...fields,key,revision:1,saved_at:now};
     // add, never put: even a UUID collision aborts the complete transaction.
     metadata.add(row); tx.objectStore('records').add({key,raw}); rows.push(row);
    }
    done(rows);
   } catch (error) { abort(error); } };
  });
 }
 async exportRecord(key) { const item = await this.get(key); if (!item) throw fail('performance.not_found','The saved recording was not found.'); return JSON.stringify(item.record); }
 importRecord(text,options = {}) {
  try { return this.save(parse(text,PERFORMANCE_LIBRARY_LIMITS.recordBytes),options); } catch (error) { return Promise.reject(error); }
 }
 exportBackup() {
  return this.operation('readonly',(tx,done,abort) => {
   const meta = tx.objectStore('metadata').getAll(), records = tx.objectStore('records').getAll();
   let rows,payloads,count = 0;
   const finish = () => { if (++count !== 2) return; try {
    limits(rows,[]);
    if (rows.length !== payloads.length) throw fail('performance.corrupt_storage','The performance library contains incomplete snapshots.');
    const byKey = new Map(payloads.map(item => [item.key,item]));
    const entries = rows.map(row => { const item = this.readStored(row,byKey.get(row.key)); return {label:item.label,record:item.record}; });
    const result = JSON.stringify({format:PERFORMANCE_BACKUP_FORMAT,version:1,exported_at:new Date().toISOString(),entries});
    if (bytes(result) > PERFORMANCE_LIBRARY_LIMITS.backupBytes) throw fail('performance.backup_bytes','The performance backup exceeds 80 MiB.');
    done(result);
   } catch (error) { abort(error); } };
   meta.onsuccess = () => { rows = meta.result; finish(); }; records.onsuccess = () => { payloads = records.result; finish(); };
  });
 }
 restoreBackup(text) {
  try { const items = parseBackup(text); limits([],items); return this.append(items); } catch (error) { return Promise.reject(error); }
 }
}

/** Descriptive retained observations only; this is never an accuracy or improvement grade. */
export function describePerformance(record) {
 validatePerformanceRecord(record);
 const events = record.observations.events, pitches = new Map(), inputs = new Map(), intervals = new Map();
 const kinds = {note_on:0,note_off:0,synthetic_release:0,boundary:0};
 const routing = {recording_segment:0,before_start:0,outside_recording_segment:0};
 let previous = null, reordered = 0, unassigned = 0, acrossBoundaries = 0;
 for (const event of events) {
  kinds[event.kind]++;
  if (event.kind === 'note_on' || event.kind === 'note_off') routing[event.routing]++;
  if (event.kind !== 'note_on') continue;
  pitches.set(event.midi,(pitches.get(event.midi) || 0) + 1);
  inputs.set(event.input_kind,(inputs.get(event.input_kind) || 0) + 1);
  if (previous) {
   if (previous.segment_id === null || event.segment_id === null) unassigned++;
   else if (previous.segment_id !== event.segment_id) acrossBoundaries++;
   else {
    const delta = event.event_ms - previous.event_ms;
    if (delta < 0) reordered++;
    else intervals.set(delta,(intervals.get(delta) || 0) + 1);
   }
  }
  previous = event;
 }
 const gaps = [];
 for (let i = 0; i < record.segments.length; i++) {
  const from = record.segments[i].end_wall_ms, to = record.segments[i + 1]?.start_wall_ms ?? record.clock.stopped_monotonic_ms;
  if (to > from) gaps.push({from_ms:from-record.clock.origin_monotonic_ms,to_ms:to-record.clock.origin_monotonic_ms});
 }
 const pitchRows = [...pitches].sort((a,b) => a[0] - b[0]).map(([midi,count]) => ({midi,count}));
 return {
  record_id:record.id,record_revision:record.revision,event_counts:{total:events.length,...kinds},
  pitch_onsets:{range:pitchRows.length ? {min: pitchRows[0].midi,max:pitchRows.at(-1).midi} : null,distribution:pitchRows},
  input_onsets:[...inputs].sort((a,b) => a[0].localeCompare(b[0])).map(([input_kind,count]) => ({input_kind,count})),
  musical_observation_routing:routing,
  inter_onset_intervals:{basis:'adjacent receipt-order onsets in the same recording segment',distribution:[...intervals].sort((a,b) => a[0]-b[0]).map(([ms,count]) => ({ms,count})),excluded:{reordered,unassigned,across_boundaries:acrossBoundaries}},
  preserved_gaps:gaps,
  omissions:{truncated:record.observations.truncated,count:record.observations.omitted_observations,first_received_ms:record.observations.first_omitted_received_wall_ms === null ? null : record.observations.first_omitted_received_wall_ms-record.clock.origin_monotonic_ms},
  release_pairing:'unknown',assessment:null,
 };
}
export function comparePerformances(first,second) {
 return {format:'worldmusichub-descriptive-performance-comparison',version:1,basis:'retained observations only; no accuracy, duration, sustain, fingering or improvement inference',a:describePerformance(first),b:describePerformance(second)};
}
