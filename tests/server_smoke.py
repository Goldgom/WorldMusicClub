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
    performance={'timeline':compilation['timeline'],'inputs':[],'tolerance_ms':150}
    status,body,_=request('/api/assess',json.dumps(performance).encode(),{'Content-Type':'application/json'});assert status==200 and len(json.loads(body)['misses'])==15
    assert request('/api/compile',b'{',{'Content-Type':'application/json'})[0]==400
    assert request('/api/compile',b'{}',{'Content-Type':'text/plain'})[0]==415
    assert request('/api/catalog',headers={'Host':'attacker.example'})[0]==403
    assert request('/api/catalog',headers={'Origin':'https://attacker.example'})[0]==403
    assert request('/../../Cargo.toml')[0]==404
    assert request('/unknown')[0]==404
    print('Rust server integration checks passed: health, catalog, compile, scoring, invalid input, Host/Origin defenses, path containment')
finally:
    process.terminate()
    try:process.wait(timeout=5)
    except subprocess.TimeoutExpired:process.kill()
