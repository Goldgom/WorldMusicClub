import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HOME_LAYOUT_CASES, HOME_LAYOUT_PREVIEW_CASE, assertHomeLayoutReport, homeLayoutScreenshotNames, homeModeIds, homeFocusIds} from './home-layout.js';
import {registerHomeLayoutBrowserRegressions} from './home-layout-browser-regression.js';
import {assertExecutedHomeLayoutCase, verifyUiPreviewHome} from '../scripts/ui-preview-home.mjs';

// Original synthetic verifier INPUTS only. No browser or server is launched,
// and these generated rectangles/PNGs are never published as acceptance evidence.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rect = (left,top,width,height) => ({left,top,right:left+width,bottom:top+height,width,height});
function reportFixture() {
  return {version:1,ok:true,scope:'actual-hosted-home-layout',originalFixturesOnly:true,nativeWebviewZoomVerified:false,
    evidence:HOME_LAYOUT_CASES.map(config => {
      const {width,height} = config.viewport, column = (width-54)/2;
      const target = id => ({id,...rect(20,80,Math.min(200,width-40),104),clip:rect(0,60,width,height-60),hits:[true,true,true,true,true]});
      const suffix = config.longLabels ? config.locale === 'en' ? ' · extended appearance and performance configuration' : ' · 更多外观与音乐演奏配置选项' : '';
      return {config:structuredClone(config),screen:'home',viewport:{width,height},documentWidth:width,
        observed:{locale:config.locale,theme:config.theme,reducedMotion:config.reducedMotion},home:{scrollWidth:width,clientWidth:width},
        intro:rect(20,80,width-40,600),free:rect(20,700,width-40,106),
        cards:homeModeIds.map((id,index) => {
          const left = index === 2 || index === 4 ? 34+column : 20, top = 80+Math.ceil(index/2)*130, cardWidth = index === 0 ? width-40 : column;
          return {id,disabled:[2,3].includes(index),...rect(left,top,cardWidth,104),
            text:[{...rect(left+12,top+40,cardWidth-24,20),content:'Synthetic title'+suffix},{...rect(left+12,top+68,cardWidth-24,18),content:'Synthetic description'+suffix}],
            badge:[2,3].includes(index) ? rect(left+cardWidth-70,top+10,60,18) : null};
        }),targets:[...homeModeIds,'start-free-practice'].map(target),
        keyboard:homeFocusIds.map(id => ({id,visible:true,outlineWidth:3,target:target(id)})),settingsOpened:true,
        settingsActivation:{control:'home-settings',trusted:true,dialog:'settings-dialog',open:true},
        screenshots:homeLayoutScreenshotNames(config).map(name => ({name,bytes:2000,sha256:'a'.repeat(64),width,height}))};
    })};
}

function originalContractPng(width,height) {
  const chunk = (type,data) => {
    const body = Buffer.concat([Buffer.from(type),data]), result = Buffer.alloc(body.length+8);
    result.writeUInt32BE(data.length); body.copy(result,4);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  const stride=1+width*3, pixels=Buffer.alloc(height*stride);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) pixels.set(((x>>4)+(y>>4))%2 ? [16,90,110] : [240,180,50], y*stride+1+x*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

test('home preview requires the exact sixteen configurations and registers one bounded actual-app case', () => {
  const expected = [[1024,689],[1024,697],[1280,720],[844,390],[390,844],[1920,1080],[512,345]].flatMap(([width,height]) => ['zh-CN','en'].map(locale => [width,height,locale,locale==='en'?'dark':'light','no-preference',false]));
  expected.push(...['zh-CN','en'].map(locale => [390,844,locale,'custom','reduce',true]));
  assert.deepEqual(HOME_LAYOUT_CASES.map(c => [c.viewport.width,c.viewport.height,c.locale,c.theme,c.reducedMotion,Boolean(c.longLabels)]),expected);
  const rows=[]; registerHomeLayoutBrowserRegressions({test:(name,options,run)=>rows.push({name,options,run})});
  assert.equal(rows.length,1); assert.equal(rows[0].name,HOME_LAYOUT_PREVIEW_CASE); assert.equal(rows[0].options.timeout,180_000); assert.equal(typeof rows[0].run,'function');
  assertHomeLayoutReport(reportFixture());
});

test('home preview rejects missing, duplicate, reordered and empty-hit evidence rather than trusting an ok flag', () => {
  const mutations = [
    r=>r.ok=false, r=>r.version=0, r=>r.originalFixturesOnly=false, r=>r.nativeWebviewZoomVerified=true, r=>r.error='failed',
    r=>r.evidence.pop(), r=>r.evidence.push(structuredClone(r.evidence[0])), r=>r.evidence[1]=structuredClone(r.evidence[0]), r=>r.evidence.reverse(),
    r=>r.evidence[0].viewport.height++, r=>r.evidence[0].observed.locale='en', r=>r.evidence[0].observed.theme='custom',
    r=>r.evidence[0].targets.pop(), r=>r.evidence[0].targets.push(structuredClone(r.evidence[0].targets[0])),
    r=>r.evidence[0].targets[1]=structuredClone(r.evidence[0].targets[0]), r=>r.evidence[0].targets.reverse(),
    r=>r.evidence[0].targets[5].hits=[], r=>r.evidence[0].targets[5].hits.pop(), r=>r.evidence[0].targets[5].hits.push(true),
    r=>r.evidence[0].targets[5].hits[3]=false, r=>r.evidence[0].targets[5].hits[3]=1,
    r=>r.evidence[0].targets[5].right=r.evidence[0].targets[5].left+1,
    r=>r.evidence[0].keyboard.pop(), r=>r.evidence[0].keyboard.push(structuredClone(r.evidence[0].keyboard[0])),
    r=>r.evidence[0].keyboard[1]=structuredClone(r.evidence[0].keyboard[0]), r=>r.evidence[0].keyboard.reverse(),
    r=>r.evidence[0].keyboard[3].target.hits=[], r=>r.evidence[0].keyboard[3].target.id='settings-button',
    r=>r.evidence[0].keyboard[3].visible=false, r=>r.evidence[0].keyboard[3].outlineWidth=0,
    r=>r.evidence[0].settingsOpened=false, r=>r.evidence[0].settingsActivation.trusted=false, r=>r.evidence[0].settingsActivation.control='settings-button',
    r=>r.evidence[0].cards[5].bottom=710, r=>r.evidence[0].free.top=470, r=>r.evidence[0].cards[5].text=[],
    r=>r.evidence[0].screenshots.pop(), r=>r.evidence[0].screenshots.reverse(), r=>r.evidence[0].screenshots[0].width++,
    r=>r.evidence[14].cards[0].text[0].content='short', r=>r.evidence[15].observed.reducedMotion='no-preference',
  ];
  for (const [index,mutate] of mutations.entries()) {const report=reportFixture();mutate(report);assert.throws(()=>assertHomeLayoutReport(report),`Home proof adversary ${index} passed`);}
});

test('home preview requires one exact executed passing TAP name and rejects missing, skipped, TODO, failed or renamed cases', () => {
  const line=`ok 23 - ${HOME_LAYOUT_PREVIEW_CASE}`; assertExecutedHomeLayoutCase(line);
  for (const tap of ['',line+' # SKIP filtered',line+' # TODO pending',line.replace(/^ok /,'not ok '),line+' extra',line.replace(' - ',' - prefix '),line+'\n'+line]) {
    assert.throws(()=>assertExecutedHomeLayoutCase(tap),/Missing executed passing home-layout preview case/);
    assert.throws(()=>verifyUiPreviewHome('/never-read-with-invalid-tap',tap),/Missing executed passing home-layout preview case/);
  }
});

test('home preview revalidates every retained PNG and hashes the exact original JSON bytes', t => {
  const directory=mkdtempSync(join(tmpdir(),'wmh-home-contract-inputs-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const report=reportFixture(),images=new Map(),tap=`ok 23 - ${HOME_LAYOUT_PREVIEW_CASE}`;
  for (const row of report.evidence) for (const shot of row.screenshots) {
    const key=`${shot.width}x${shot.height}`;
    if (!images.has(key)) images.set(key,originalContractPng(shot.width,shot.height));
    const bytes=images.get(key); shot.bytes=bytes.length;shot.sha256=digest(bytes);writeFileSync(join(directory,shot.name),bytes);
  }
  const path=join(directory,'worldmusichub-home-layout.json'),json=Buffer.from(JSON.stringify(report)+'\n');writeFileSync(path,json);
  const files=verifyUiPreviewHome(directory,tap);assert.equal(files.length,49);
  assert.deepEqual(files[0],{name:'worldmusichub-home-layout.json',bytes:json.length,sha256:digest(json)});
  assert.deepEqual(files.slice(1),report.evidence.flatMap(row=>row.screenshots));
  const first=report.evidence[0].screenshots[0],imagePath=join(directory,first.name),original=readFileSync(imagePath);
  unlinkSync(imagePath);assert.throws(()=>verifyUiPreviewHome(directory,tap),/ENOENT/);
  writeFileSync(imagePath,Buffer.from('not a PNG'));assert.throws(()=>verifyUiPreviewHome(directory,tap));
  writeFileSync(imagePath,Buffer.concat([original,Buffer.from('changed')]));assert.throws(()=>verifyUiPreviewHome(directory,tap),/byte length changed/);
  const changed=Buffer.from(original);changed[changed.length-1]^=1;writeFileSync(imagePath,changed);
  assert.throws(()=>verifyUiPreviewHome(directory,tap),/retained PNG bytes changed/);
  const wrongSize=originalContractPng(390,844);writeFileSync(imagePath,wrongSize);first.bytes=wrongSize.length;first.sha256=digest(wrongSize);writeFileSync(path,JSON.stringify(report));
  assert.throws(()=>verifyUiPreviewHome(directory,tap),/wrong viewport width/);
});
