import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionDiagnostics} from './browser-connection-diagnostics.js';

test('connection evidence does not invoke a Windows tool on other platforms',async()=>{
  assert.deepEqual(await connectionDiagnostics('http://127.0.0.1:1234',{platform:'linux',run:()=>{throw Error('Unexpected execution');}}),{status:'not_applicable',platform:'linux'});
});
test('connection observations retain counts and distinguish them from a proven cause',async()=>{
  let command;const value={version:1,app_port:1234,system_tcp_states:[{state:'TimeWait',count:80}],app_tcp_states:[{state:'Established',count:6}],ipv4_tcp_dynamic_port_range:'Start Port : 49152\nNumber of Ports : 16384'};
  const result=await connectionDiagnostics('http://127.0.0.1:1234',{platform:'win32',run:async script=>{command=script;return{stdout:JSON.stringify(value)};}});
  assert.equal(result.status,'observed');assert.deepEqual(result.app_tcp_states,value.app_tcp_states);assert.match(result.interpretation,/do not prove/);assert.match(command,/Get-NetTCPConnection/);assert.match(command,/show dynamicport tcp/);assert.doesNotMatch(command,/Set-Net|set dynamicport|RemoteAddress|LocalAddress|OwningProcess/);
});
test('invalid origins never become shell code or trigger collection outside this app',async()=>{
  for(const origin of ['http://example.com:1234','https://127.0.0.1:1234','http://127.0.0.1:0','not a URL'])assert.equal((await connectionDiagnostics(origin,{platform:'win32',run:()=>{throw Error('Must not execute');}})).reason,'Invalid local test origin');
});
test('failed or malformed resource observations remain unavailable, never a successful retry',async()=>{
  for(const run of [async()=>{throw Error('Read unavailable');},async()=>({stdout:'not JSON'}),async()=>({stdout:JSON.stringify({version:1,app_port:1234,system_tcp_states:[{state:'bad',count:-1}],app_tcp_states:[],ipv4_tcp_dynamic_port_range:''})})])assert.equal((await connectionDiagnostics('http://127.0.0.1:1234',{platform:'win32',run})).status,'unavailable');
});
