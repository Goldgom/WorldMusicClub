"""Dependency-free integration checks against the actual Rust executable."""
import base64, json, subprocess, time, urllib.request, urllib.error, os, tomllib
from pathlib import Path
port=17878
binary=Path(os.environ.get('WMH_SERVER_BINARY', 'target/debug/practice-server' + ('.exe' if os.name=='nt' else '')))
version=subprocess.run([str(binary),'--version'],capture_output=True,text=True,timeout=5)
expected_version=tomllib.loads((Path(__file__).resolve().parents[1]/'Cargo.toml').read_text(encoding='utf-8'))['workspace']['package']['version']
assert version.returncode==0 and version.stdout.strip()=='WorldMusicHub '+expected_version
help_result=subprocess.run([str(binary),'--help'],capture_output=True,text=True,timeout=5)
assert help_result.returncode==0 and '--version' in help_result.stdout
bad_options=subprocess.run([str(binary),'--unknown'],capture_output=True,text=True,timeout=5)
assert bad_options.returncode==2 and 'No server was started' in bad_options.stderr
process=subprocess.Popen([str(binary),'--no-open','--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
base=f'http://127.0.0.1:{port}'
def request(path, body=None, headers=None):
    req=urllib.request.Request(base+path, data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(req,timeout=3) as r:return r.status,r.read(),r.headers
    except urllib.error.HTTPError as e:return e.code,e.read(),e.headers
try:
    for _ in range(100):
        try:
            status,body,headers=request('/api/health');break
        except (urllib.error.URLError,ConnectionError):time.sleep(.05)
    else:raise AssertionError('Server never became healthy')
    assert status==200 and json.loads(body)['engine']=='rust'
    assert headers['X-Content-Type-Options']=='nosniff'
    status,body,headers=request('/score-download.js')
    assert status==200 and body==Path('web/score-download.js').read_bytes()
    assert headers['Content-Type'].startswith('text/javascript')
    status,body,_=request('/api/catalog'); assert status==200
    catalog=json.loads(body);assert len(catalog)>=3
    status,index_body,_=request('/api/catalog/index');assert status==200
    index=json.loads(index_body);assert index['version']==1 and len(index['items'])==len(catalog)
    assert len(index_body)<20*1024 and len(index_body)<len(body)//10
    for item,score in zip(index['items'],catalog):
        assert item['id']==score['id'] and item['provenance']==score['provenance']
        assert item['written_event_count']==sum(len(part['notes']) for part in score['parts'])
        assert 'source' not in item and 'parts' not in item
        status,selected,_=request('/api/catalog/score/'+item['id']);assert status==200 and json.loads(selected)==score
    assert request('/api/catalog/score/missing-edition')[0]==404
    status,body,_=request('/api/compile',json.dumps(catalog[0]).encode(),{'Content-Type':'application/json'});assert status==200
    compilation=json.loads(body);assert len(compilation['timeline']['notes'])==15
    status,body,_=request('/api/export/musicxml',json.dumps(catalog[0]).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    exported=json.loads(body);assert exported['part_id_map']['piano']=='P1' and exported['voice_id_map']
    declared_omr=exported['xml'].replace('<encoding>','<encoding><software>Audiveris 5.11.0</software>')
    omr_input={'engine_version':'5.11.0','output_format':'musicxml','output_content':declared_omr}
    status,body,_=request('/api/omr/audiveris-draft',json.dumps(omr_input).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    draft=json.loads(body);assert draft['requires_review'] and draft['confidence'] is None and 'timeline' not in draft
    assert request('/api/compile',json.dumps(draft['score']).encode(),{'Content-Type':'application/json'})[0]==400
    draft['score']['tempo'][0]['bpm']=85
    confirmation={key:True for key in ['notes_and_rests','rhythm_and_voices','ties_and_navigation','key_and_meter','tempo','source_rights']}
    status,body,_=request('/api/omr/confirm',json.dumps({'score':draft['score'],'confirmation':confirmation}).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    reviewed=json.loads(body);assert reviewed['score']['tempo'][0]['bpm']==85
    assert json.loads(reviewed['score']['source']['content'])['input']['output_content']==declared_omr
    assert '<rights type="attribution">' in exported['xml']
    status,body,_=request('/api/import/musicxml',exported['xml'].encode(),{'Content-Type':'application/xml'})
    assert status==200,body
    imported_xml=json.loads(body);assert imported_xml['score']['source']['import_diagnostics']
    status,reloaded,_=request('/api/compile',json.dumps(imported_xml['score']).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(reloaded)['diagnostics']==imported_xml['diagnostics'],reloaded
    again=imported_xml['timeline'];assert [n['midi'] for n in again['notes']]==[n['midi'] for n in compilation['timeline']['notes']]
    assert abs(again['duration_ms']-compilation['timeline']['duration_ms'])<.001
    instrument={'timeline':compilation['timeline'],'profile':{'kind':'piano','key_count':61,'lowest_midi':None}}
    status,body,_=request('/api/instrument-check',json.dumps(instrument).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(body)['highest_midi']==96
    status,body,_=request('/api/practice-targets',json.dumps(instrument).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    targets=json.loads(body);assert targets['playable'] and targets['target_count']==15 and targets['source_note_count']==15
    assert all(group['source_occurrence_ids'] and group['source_note_ids'] for group in targets['groups'])
    adaptation={'score':catalog[0],'operation':{'part_id':None,'octaves':1},'profile':instrument['profile']}
    status,body,_=request('/api/adaptation/preview',json.dumps(adaptation).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    adapted=json.loads(body);assert adapted['original_preserved'] and adapted['changed_note_count']==15
    assert adapted['scored_mode_allowed']
    assert [n['midi'] for n in adapted['compilation']['timeline']['notes']]==[n['midi']+12 for n in compilation['timeline']['notes']]
    status,body,_=request('/api/adaptation/restore',json.dumps(adapted['compilation']['score']).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(body)['score']==catalog[0],body
    transposition={'score':catalog[0],'operation':{'semitones':2},'profile':instrument['profile']}
    status,body,_=request('/api/transposition/preview',json.dumps(transposition).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    transposed=json.loads(body);assert transposed['original_preserved'] and transposed['changed_note_count']==15
    assert transposed['written_interval']=={'diatonic_steps':1,'fifths_delta':2}
    assert [n['midi'] for n in transposed['compilation']['timeline']['notes']]==[n['midi']+2 for n in compilation['timeline']['notes']]
    assert json.loads(transposed['compilation']['score']['source']['content'])['original']==catalog[0]
    status,body,_=request('/api/transposition/restore',json.dumps(transposed['compilation']['score']).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(body)['score']==catalog[0],body
    status,body,_=request('/api/export/jianpu',json.dumps(catalog[0]).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    numbered=json.loads(body);assert '; License: CC0-1.0' in numbered['text'] and numbered['note_map']
    status,body,_=request('/api/import/jianpu',numbered['text'].encode(),{'Content-Type':'text/plain'})
    assert status==200,body
    assert [n['midi'] for n in json.loads(body)['timeline']['notes']]==[n['midi'] for n in compilation['timeline']['notes']]
    status,body,_=request('/api/metronome',json.dumps({'score':catalog[0],'pulse':'quarter'}).encode(),{'Content-Type':'application/json'})
    assert status==200,body
    grid=json.loads(body);assert len(grid['ticks'])==16 and grid['accent_policy']=='written_measure_boundary'
    assert abs(grid['duration_ms']-compilation['timeline']['duration_ms'])<.001
    window={'score':catalog[0],'from':{'numerator':1,'denominator':1},'to':{'numerator':4,'denominator':1}}
    status,body,_=request('/api/practice-window',json.dumps(window).encode(),{'Content-Type':'application/json'})
    assert status==200 and len(json.loads(body)['target_note_ids'])==3
    performance={'timeline':compilation['timeline'],'inputs':[],'tolerance_ms':150}
    status,body,_=request('/api/assess',json.dumps(performance).encode(),{'Content-Type':'application/json'});assert status==200 and len(json.loads(body)['misses'])==15
    pitch_rows=json.loads(body)['pitch_breakdown'];assert sum(row['missed'] for row in pitch_rows)==15
    result=json.loads(body)
    assert result['grade_counts']=={'perfect':0,'good':0,'early':0,'late':0,'missed':15,'extra':0}
    assert result['onset_completion']=={'total':15,'complete':0,'longest_complete_sequence':0}
    assert all(row['mean_abs_error_ms'] is None and row['timing_bias_ms'] is None for row in pitch_rows)
    performance['inputs']=[{'midi':note['midi'],'at_ms':note['start_ms']+10,'velocity':90} for note in compilation['timeline']['notes']]
    performance['inputs'].append({'midi':0,'at_ms':0,'velocity':90})
    status,body,_=request('/api/assess',json.dumps(performance).encode(),{'Content-Type':'application/json'});assert status==200,body
    pitch_rows=json.loads(body)['pitch_breakdown'];assert sum(row['matched'] for row in pitch_rows)==15
    result=json.loads(body)
    assert sum(result['grade_counts'][grade] for grade in ['perfect','good','early','late'])==15
    assert result['onset_completion']=={'total':15,'complete':15,'longest_complete_sequence':15}
    assert pitch_rows[0]['midi']==0 and pitch_rows[0]['extra']==1 and pitch_rows[0]['expected']==0
    assert all(abs(row['timing_bias_ms']-10)<1e-6 for row in pitch_rows if row['matched'])
    assert request('/api/compile',b'{',{'Content-Type':'application/json'})[0]==400
    assert request('/api/compile',b'{}',{'Content-Type':'text/plain'})[0]==415
    assert request('/api/catalog',headers={'Host':'attacker.example'})[0]==403
    assert request('/api/catalog',headers={'Origin':'https://attacker.example'})[0]==403
    assert request('/../../Cargo.toml')[0]==404
    assert request('/unknown')[0]==404
    xml=Path('tests/fixtures/original-duet.musicxml').read_bytes()
    status,body,_=request('/api/import/musicxml',xml,{'Content-Type':'application/xml'})
    assert status==200,body
    parsed=json.loads(body);assert parsed['score']['source']['content'].encode()==xml
    assert len(parsed['timeline']['notes'])>0
    status,body,_=request('/api/import/musicxml',b'<!DOCTYPE score [<!ENTITY x SYSTEM "file:///etc/passwd">]><score-partwise/>',{'Content-Type':'application/xml'})
    assert status==400
    mxl=Path('tests/fixtures/original-duet.mxl').read_bytes()
    status,body,_=request('/api/import/mxl',mxl,{'Content-Type':'application/zip'})
    assert status==200,body
    archived=json.loads(body);assert archived['score']['source']['format']=='worldmusichub-mxl-archive-v1'
    source=json.loads(archived['score']['source']['content']);assert source['files']['selected.musicxml']['content'].encode()==xml
    assert base64.b64decode(source['files']['original.mxl']['content'],validate=True)==mxl
    assert source['files']['original.mxl']['bytes']==len(mxl)
    status,body,_=request('/api/compile',json.dumps(archived['score']).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(body)['score']['source']==archived['score']['source'],body
    assert request('/api/import/mxl',b'not a zip',{'Content-Type':'application/zip'})[0]==400
    jianpu=Path('tests/fixtures/jianpu-original-steps.jianpu').read_bytes()
    status,body,_=request('/api/import/jianpu',jianpu,{'Content-Type':'text/plain; charset=utf-8'})
    assert status==200,body
    jianpu_result=json.loads(body);assert jianpu_result['score']['source']['content'].encode()==jianpu
    assert abs(jianpu_result['timeline']['duration_ms']-7500)<.001
    assert request('/api/import/jianpu',b'8 9 bad',{'Content-Type':'text/plain'})[0]==400
    midi=Path('tests/fixtures/midi-original-ppq.mid').read_bytes()
    status,body,_=request('/api/import/midi',midi,{'Content-Type':'audio/midi'})
    assert status==200,body
    midi_result=json.loads(body);assert len(midi_result['timeline']['notes'])==3
    import base64
    assert base64.b64decode(midi_result['score']['source']['content'])==midi
    assert request('/api/import/midi',b'not midi',{'Content-Type':'audio/midi'})[0]==400
    png=Path('tests/fixtures/omr-original-scale.png').read_bytes()
    status,body,_=request('/api/import/image',png,{'Content-Type':'image/png'})
    assert status==200,body
    review=json.loads(body);assert review['requires_review'] and len(review['candidates'])==8
    assert all(c['duration']=='unknown' for c in review['candidates'])
    assert request('/api/import/image',b'not an image',{'Content-Type':'image/png'})[0]==400
    print('Rust server integration checks passed: health, catalog, compile, scoring, invalid input, Host/Origin defenses, path containment')
finally:
    process.terminate()
    try:process.wait(timeout=5)
    except subprocess.TimeoutExpired:process.kill()
