import test from 'node:test';
import assert from 'node:assert/strict';
import {createCleanSongMedia} from '../web/clean-song-media.js';
const node=()=>({hidden:true,src:'',currentTime:0,paused:true,plays:0,pauses:0,removeAttribute(key){this[key]='';},load(){},pause(){this.paused=true;this.pauses++;},play(){this.plays++;this.paused=false;return Promise.resolve();}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const descriptor={media:[{id:'cover',role:'cover',handle:'cover'},{id:'pv',role:'pv',handle:'pv',offset_ms:100}]};
test('media loads from opaque handles with no autoplay; gesture drives synchronized muted PV',async()=>{const cover=node(),video=node(),revoked=[],reads=[];const media=createCleanSongMedia({cover,video,loadAsset:async(key,handle)=>{reads.push([key,handle]);return new Blob([handle]);},createObjectURL:blob=>'blob:'+blob.size,revokeObjectURL:url=>revoked.push(url)});await media.select('a',descriptor);cover.onload();video.onloadeddata();assert.equal(video.plays,0);assert.equal(video.muted,true);media.sync({positionMs:50,running:true,userGesture:true});assert.equal(video.plays,0);media.sync({positionMs:600,running:true});await tick();assert.equal(video.currentTime,.5);assert.equal(video.plays,1);media.pause();assert.equal(video.paused,true);media.sync({positionMs:800,running:true});assert.equal(video.plays,1);media.clear();assert.equal(revoked.length,2);assert.equal(cover.hidden,true);assert.deepEqual(reads,[['a','cover'],['a','pv']]);});
test('late asset completion and late play settlement cannot reactivate old selection',async()=>{let resolveAsset,resolvePlay;const video=node(),urls=[];const media=createCleanSongMedia({video,loadAsset:()=>new Promise(resolve=>resolveAsset=resolve),createObjectURL:()=>{urls.push('blob');return'blob';},revokeObjectURL(){}});const pending=media.select('a',descriptor);media.clear();resolveAsset(new Blob(['a']));await pending;assert.equal(urls.length,0);
const media2=createCleanSongMedia({video,loadAsset:async()=>new Blob(['a']),createObjectURL:()=>'blob',revokeObjectURL(){}});await media2.select('a',descriptor);video.onloadeddata();video.play=function(){this.plays++;return new Promise(resolve=>resolvePlay=resolve);};media2.sync({positionMs:200,running:true,userGesture:true});media2.pause();resolvePlay();await tick();assert.equal(video.paused,true);media2.destroy();});
test('decode error revokes failed visual and reports optional-media status',async()=>{const background=node(),revoked=[],statuses=[];const media=createCleanSongMedia({background,loadAsset:async()=>new Blob(['bad']),createObjectURL:()=>'blob:bad',revokeObjectURL:url=>revoked.push(url),onStatus:status=>statuses.push(status)});await media.select('a',{media:[{id:'bg',role:'background',handle:'opaque'}]});background.onerror();assert.equal(background.hidden,true);assert.deepEqual(revoked,['blob:bad']);assert.equal(statuses.at(-1).media[0].error,'decode');media.destroy();});
test('a shorter PV holds its final frame without restarting while the song continues',async()=>{const video=node();video.duration=.5;const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['a']),createObjectURL:()=>'blob',revokeObjectURL(){}});await media.select('a',descriptor);video.onloadeddata();media.sync({positionMs:200,running:true,userGesture:true});await tick();assert.equal(video.plays,1);media.sync({positionMs:1000,running:true});assert.equal(video.currentTime,.5);assert.equal(video.paused,true);media.sync({positionMs:1100,running:true});assert.equal(video.plays,1);media.destroy();});

test('metadata-only preload admits user playback before data and reports readiness only after data',async()=>{
 const video=node();video.readyState=0;
 video.load=function(){if(!this.src)return;this.readyState=1;this.duration=5;this.onloadedmetadata?.();};
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 await media.select('a',descriptor);
 assert.equal(video.plays,0);assert.equal(video.hidden,true);assert.equal(media.snapshot().media[0].status,'loading');
 media.sync({positionMs:50,running:true,userGesture:true});assert.equal(video.plays,0,'The declared PV offset is still respected');
 media.sync({positionMs:600,running:true});await tick();
 assert.equal(video.plays,1,'Explicit playback must initiate decode when preload stops at metadata');
 assert.equal(video.currentTime,.5);assert.equal(video.hidden,true);assert.equal(media.snapshot().media[0].status,'loading');
 video.readyState=2;video.onloadeddata();
 assert.equal(video.hidden,false);assert.equal(media.snapshot().media[0].status,'ready');assert.equal(video.plays,1);
 media.destroy();
});

test('play can request initial metadata, then catch up to the current shared clock without a premature seek',async()=>{
 const video=node();let currentTime=0;video.readyState=0;
 Object.defineProperty(video,'currentTime',{get:()=>currentTime,set:value=>{assert.ok(video.readyState>=1,'Cannot seek before metadata');currentTime=value;}});
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 await media.select('a',descriptor);media.sync({positionMs:600,running:true,userGesture:true});await tick();
 assert.equal(video.plays,1);assert.equal(currentTime,0);assert.equal(media.snapshot().media[0].status,'loading');
 media.sync({positionMs:1100,running:true});video.readyState=1;video.duration=5;video.onloadedmetadata();
 assert.equal(currentTime,1);assert.equal(media.snapshot().media[0].status,'loading');assert.equal(video.hidden,true);
 video.readyState=2;video.onloadeddata();assert.equal(media.snapshot().media[0].status,'ready');media.destroy();
});

test('late source attachment uses only the still-current playback admission',async()=>{
 let resolveAsset;const video=node(),media=createCleanSongMedia({video,loadAsset:()=>new Promise(resolve=>resolveAsset=resolve),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 const pending=media.select('a',descriptor);media.sync({positionMs:600,running:true,userGesture:true});assert.equal(video.plays,0);
 resolveAsset(new Blob(['pv']));await pending;await tick();assert.equal(video.plays,1);
 media.destroy();
});

test('late source, metadata and data cannot restart a paused admission or a replaced selection',async()=>{
 let resolveAsset;const video=node(),media=createCleanSongMedia({video,loadAsset:()=>new Promise(resolve=>resolveAsset=resolve),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 const pending=media.select('a',descriptor);media.sync({positionMs:600,running:true,userGesture:true});media.pause();
 resolveAsset(new Blob(['pv']));await pending;video.readyState=1;video.onloadedmetadata();video.onloadeddata();
 assert.equal(video.plays,0);media.sync({positionMs:700,running:true});assert.equal(video.plays,0);
 const metadata=video.onloadedmetadata,data=video.onloadeddata;media.clear();metadata();data();
 assert.equal(video.plays,0);assert.equal(video.hidden,true);assert.deepEqual(media.snapshot().media,[]);media.destroy();
});

test('a cancelled play settlement does not pause a newer authorized playback',async()=>{
 const video=node(),pending=[];video.play=function(){this.plays++;this.paused=false;return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 await media.select('a',descriptor);video.onloadeddata();media.sync({positionMs:600,running:true,userGesture:true});media.pause();
 media.sync({positionMs:800,running:true,userGesture:true});assert.equal(video.plays,2);
 pending[0].resolve();await tick();assert.equal(video.paused,false,'The obsolete promise must not cancel the newer admission');
 pending[1].resolve();await tick();assert.equal(video.paused,false);media.destroy();
});

test('play rejection before first data stays an optional failure and late events cannot revive it',async()=>{
 const video=node(),revoked=[];video.play=()=>Promise.reject(new Error('decode unavailable'));
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>'blob:pv',revokeObjectURL:url=>revoked.push(url)});
 await media.select('a',descriptor);const metadata=video.onloadedmetadata,data=video.onloadeddata;
 media.sync({positionMs:600,running:true,userGesture:true});await tick();
 assert.equal(media.snapshot().media[0].status,'error');assert.equal(media.snapshot().media[0].error,'play');assert.deepEqual(revoked,['blob:pv']);
 metadata();data();assert.equal(media.snapshot().media[0].status,'error');assert.equal(video.hidden,true);assert.equal(video.paused,true);media.destroy();
});

test('obsolete play promises cannot reactivate navigation or fail a replacement source',async()=>{
 const video=node(),pending=[],revoked=[];let serial=0;
 video.play=function(){this.plays++;this.paused=false;return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>`blob:pv-${++serial}`,revokeObjectURL:url=>revoked.push(url)});
 await media.select('a',descriptor);media.sync({positionMs:600,running:true,userGesture:true});
 await media.select('b',descriptor);video.paused=false;pending[0].resolve();await tick();
 assert.equal(video.paused,true);assert.equal(video.plays,1);assert.equal(media.snapshot().key,'b');assert.equal(media.snapshot().authorized,false);
 media.sync({positionMs:600,running:true,userGesture:true});media.pause();media.sync({positionMs:600,running:true,userGesture:true});
 pending[1].reject(new Error('obsolete abort'));await tick();assert.equal(media.snapshot().media[0].status,'loading');assert.equal(video.paused,false);assert.deepEqual(revoked,['blob:pv-1']);
 pending[2].resolve();await tick();media.destroy();
});

test('duration learned after playback admission stops an already-ended PV at its final frame',async()=>{
 const video=node();let resolvePlay;video.play=function(){this.plays++;this.paused=false;return new Promise(resolve=>resolvePlay=resolve);};
 const media=createCleanSongMedia({video,loadAsset:async()=>new Blob(['pv']),createObjectURL:()=>'blob:pv',revokeObjectURL(){}});
 await media.select('a',descriptor);media.sync({positionMs:600,running:true,userGesture:true});assert.equal(video.plays,1);
 video.duration=.25;video.onloadedmetadata();assert.equal(video.currentTime,.25);assert.equal(video.paused,true);
 video.paused=false;resolvePlay();await tick();assert.equal(video.paused,true);
 video.onloadeddata();media.sync({positionMs:700,running:true});assert.equal(video.plays,1);assert.equal(video.currentTime,.25);media.destroy();
});
