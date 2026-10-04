import assert from 'node:assert/strict';

const positive=value=>Number.isSafeInteger(value)&&value>0;
function absoluteDirectory(value,label){
  assert.ok(typeof value==='string'&&value.length>0&&value.length<=32768&&!/[\r\n\0]/.test(value),`Native ${label} directory is invalid`);
  const path=value.replaceAll('\\','/');
  assert.ok((path.startsWith('/')&&!path.startsWith('//')||/^[A-Za-z]:\//.test(path))&&
    path.split('/').slice(1).every(part=>part&&part!=='.'&&part!=='..'),`Native ${label} directory must be absolute without aliases`);
  return path;
}

/** Validate the native host's atomic profile creation records. The supplied
 * reader must bound ordinary evidence files and include their bytes/hashes in
 * the final proof. Profile contents are deliberately not read or retained. */
export async function verifyNativeProfileEvidence(native,phases,readJson){
  assert.ok(Array.isArray(native.phases),'Native profile phase rows are missing');
  assert.deepEqual(native.phases.map(row=>row?.phase),phases,'Native profile phases must be exact and ordered');
  assert.equal(new Set(native.phases.map(row=>row?.process_id)).size,phases.length,'Native profile phases must use distinct processes');
  const library=absoluteDirectory(native.directory,'library');
  assert.ok(library.endsWith('/Scores'),'Native library directory must identify the absolute Scores root');
  const root=library.slice(0,-'/Scores'.length),used=new Set();
  for(const row of native.phases){
    const phase=row.phase,profile=absoluteDirectory(row.profile_directory,`${phase} profile`);
    assert.equal(profile,`${root}/webview-profiles/${phase}`,`Native ${phase} profile directory must use its exact phase under the evidence root`);
    assert.ok(!used.has(profile),'Native phases must not reuse profile directories');used.add(profile);
    assert.ok(positive(row.process_id),`Native ${phase} profile process identity is invalid`);
    assert.ok(row.profile_fresh===true&&row.profile_reused===false&&row.profile_absent_before_launch===true,`Native ${phase} requires an absent fresh profile before launch`);
    const host=await readJson(`profile-${phase}.json`,16*1024);
    assert.ok(host&&typeof host==='object'&&!Array.isArray(host)&&host.version===1,`Native ${phase} profile host record is invalid`);
    assert.equal(host.phase,phase,`Native ${phase} profile host phase differs`);
    assert.equal(host.process_id,row.process_id,`Native ${phase} profile host process differs`);
    assert.equal(host.profile_directory,row.profile_directory,`Native ${phase} profile host directory differs`);
    assert.equal(host.library_directory,native.directory,`Native ${phase} profile host library directory differs`);
    assert.ok(host.fresh_required===true&&host.created_new===true,`Native ${phase} profile host must prove fresh atomic creation`);
  }
}
