import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const defaultRun=script=>execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:4000,maxBuffer:64*1024,windowsHide:true});

/** Passive aggregate counts only: no endpoints, credentials or OS changes. */
export async function connectionDiagnostics(origin,{platform=process.platform,run=defaultRun}={}){
  if(platform!=='win32')return{status:'not_applicable',platform};
  let port;
  try{const url=new URL(origin);port=Number(url.port);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535)throw Error('invalid');}
  catch{return{status:'unavailable',reason:'Invalid local test origin'};}
  const script=`$ErrorActionPreference='Stop'; $tcp=@(Get-NetTCPConnection -ErrorAction Stop); $app=@($tcp | Where-Object { $_.LocalPort -eq ${port} -or $_.RemotePort -eq ${port} }); function Counts($items) { @($items | Group-Object -Property State | ForEach-Object { @{state=[string]$_.Name;count=[int]$_.Count} }) }; $range=(& netsh interface ipv4 show dynamicport tcp | Out-String).Trim(); @{version=1;app_port=${port};system_tcp_states=@(Counts $tcp);app_tcp_states=@(Counts $app);ipv4_tcp_dynamic_port_range=$range} | ConvertTo-Json -Depth 5 -Compress`;
  try{
    const {stdout}=await run(script),value=JSON.parse(stdout.replace(/^\uFEFF/,''));
    if(value.version!==1||value.app_port!==port||!['system_tcp_states','app_tcp_states'].every(key=>Array.isArray(value[key])&&value[key].every(item=>typeof item.state==='string'&&Number.isSafeInteger(item.count)&&item.count>=0))||typeof value.ipv4_tcp_dynamic_port_range!=='string')throw Error('Unexpected count schema');
    return{status:'observed',...value,interpretation:'Resource observation only; these counts do not prove the cause of a browser socket error.'};
  }catch(error){return{status:'unavailable',reason:String(error.message||error).slice(0,500)};}
}
