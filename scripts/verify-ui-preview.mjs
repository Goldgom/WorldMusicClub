import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const directory=resolve(process.argv[2]||'ui-preview'),tap=readFileSync(join(directory,'tests.tap'),'utf8');
const names=['real free piano fills desktop','original grand staff and Jianpu follow','game menu and audible song preview'];
for(const name of names)assert.ok(tap.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.includes(name)&&!line.includes('# SKIP')),`Missing executed passing preview case: ${name}`);
const files=[];
for(const size of ['1280x720','1920x1080'])for(const name of [
  `worldmusichub-free-piano-${size}-zh-CN.png`,
  `worldmusichub-above-keyboard-${size}-staff.png`,
  `worldmusichub-above-keyboard-${size}-jianpu.png`,
  `worldmusichub-game-home-${size}.png`,
  `worldmusichub-game-lobby-${size}.png`,
]){
  const bytes=readFileSync(join(directory,name));assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),`${name}: not PNG`);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.equal(width,Number(size.split('x')[0]),`${name}: wrong viewport width`);assert.ok(height>=Number(size.split('x')[1]),`${name}: incomplete image`);
  files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width,height});
}
for(const name of ['worldmusichub-free-piano-stage.json','worldmusichub-above-keyboard.json','worldmusichub-game-menu-preview-evidence.json']){
  const bytes=readFileSync(join(directory,name));JSON.parse(bytes.toString('utf8'));files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const result={version:1,scope:'Actual hosted Rust/browser UI preview only',source_sha:git('rev-parse','HEAD'),source_tree:git('rev-parse','HEAD^{tree}'),commit_count:Number(git('rev-list','--count','HEAD')),accepted_package:false,windows_native_verified:false,physical_midi_verified:false,actual_speaker_output_verified:false,cases:names,files};
writeFileSync(join(directory,'worldmusichub-ui-preview.json'),JSON.stringify(result,null,2));
console.log(`Verified ${files.length} source-bound UI preview files. Full checkpoint and Windows acceptance remain separate.`);
