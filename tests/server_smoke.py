"""Dependency-free integration checks against the actual Rust executable."""
import json, subprocess, time, urllib.request, urllib.error, os
from pathlib import Path
port=17878
binary=Path('target/debug/practice-server' + ('.exe' if os.name=='nt' else ''))
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
    status,body,_=request('/api/catalog'); assert status==200
    catalog=json.loads(body);assert len(catalog)>=3
    status,body,_=request('/api/compile',json.dumps(catalog[0]).encode(),{'Content-Type':'application/json'});assert status==200
    compilation=json.loads(body);assert len(compilation['timeline']['notes'])==15
    instrument={'timeline':compilation['timeline'],'profile':{'kind':'piano','key_count':61,'lowest_midi':None}}
    status,body,_=request('/api/instrument-check',json.dumps(instrument).encode(),{'Content-Type':'application/json'})
    assert status==200 and json.loads(body)['highest_midi']==96
    window={'score':catalog[0],'from':{'numerator':1,'denominator':1},'to':{'numerator':4,'denominator':1}}
    status,body,_=request('/api/practice-window',json.dumps(window).encode(),{'Content-Type':'application/json'})
    assert status==200 and len(json.loads(body)['target_note_ids'])==3
    performance={'timeline':compilation['timeline'],'inputs':[],'tolerance_ms':150}
    status,body,_=request('/api/assess',json.dumps(performance).encode(),{'Content-Type':'application/json'});assert status==200 and len(json.loads(body)['misses'])==15
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
    assert json.loads(body)['score']['source']['content'].encode()==xml
    assert request('/api/import/mxl',b'not a zip',{'Content-Type':'application/zip'})[0]==400
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
