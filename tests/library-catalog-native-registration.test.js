import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const phases=['catalog-seed','catalog-restart','catalog-final'];
const fixtures=['catalog-original-legacy.zip','catalog-original-shared.zip','catalog-original-clean.zip'];
const host=read('scripts/windows-desktop-acceptance.ps1');
const rust=read('crates/desktop-shell/src/acceptance.rs');
const profile=read('scripts/windows-desktop-profile.ps1');
const native=read('scripts/windows-desktop-native.cs');

test('catalog native scenario selects one exact renderer, fixture preparer and verifier across three phases',()=>{
  assert.match(host,/\[ValidateSet\([^\n]*'library-catalog'/);
  assert.match(host,/\$phases=if\(\$Scenario -eq 'library-catalog'\)\{@\('catalog-seed','catalog-restart','catalog-final'\)\}/);
  assert.match(host,/\$nativeReportName=if\(\$Scenario -eq 'library-catalog'\)\{'native-library-catalog.json'\}/);
  assert.match(host,/\$verifier=if\(\$Scenario -eq 'library-catalog'\)\{'verify-library-catalog-acceptance.mjs'\}/);
  assert.ok(host.includes("'prepare-library-catalog-acceptance.mjs'"));
  assert.match(rust,/pub const CATALOG_PHASES: \[&str; 3\] = \["catalog-seed", "catalog-restart", "catalog-final"\]/);
  assert.match(rust,/\.chain\(CATALOG_PHASES\)\s*\.find/);
  assert.match(rust,/else if CATALOG_PHASES.contains\(&self.phase\) \{\s*include_str!\("\.\.\/library-catalog-acceptance.js"\)/);
  for(const file of fixtures){assert.ok(rust.includes(`"${file}"`));assert.ok(native.includes(`"${file}"`));}
  for(const phase of phases){assert.ok(profile.includes(`'${phase}'`));assert.ok(native.includes(phase));}
  assert.match(rust,/\.chain\(CATALOG_PHASES.iter\(\)\)/);
});

test('catalog profile and window hooks preserve other scenarios and require an existing profile on restart',()=>{
  const windows=read('crates/desktop-shell/src/windows.rs');
  assert.match(windows,/\.inner_size\(1280\.0, 900\.0\)/);
  assert.match(windows,/if worldmusichub_desktop::acceptance::CATALOG_PHASES.contains\(&acceptance.phase\)\s*\|\| worldmusichub_desktop::acceptance::COMPLETE_PRACTICE_PHASES.contains\(\s*&acceptance.phase,?\s*\)\s*\{\s*builder = builder.inner_size\(1280\.0, 720\.0\);\s*\}/);
  assert.match(rust,/if CATALOG_PHASES.contains\(&self.phase\) \{\s*self.directory.join\("webview-catalog-profile"\)\s*\} else if PHASES.contains\(&self.phase\) \{\s*self.directory.join\("webview-profile"\)/);
  assert.match(rust,/let existing_required = \(catalog && self.phase != "catalog-seed"\) \|\| complete_restart/);
  assert.match(rust,/if existing_required \{[\s\S]*?require_ordinary_directory\(&profile\)\?;[\s\S]*?require_catalog_profile_evidence\("catalog-seed", true\)\?;[\s\S]*?return Ok\(false\)/);
  assert.match(profile,/if\(\$selection.existing_required\) \{[\s\S]*?if\(\$selection.profile_absent_before_launch\)\{throw/);
  assert.match(profile,/Assert-CatalogProfilePredecessor \$Directory \$selection 'catalog-seed' \$true/);
  assert.match(profile,/Assert-CatalogProfilePredecessor \$Directory \$selection 'catalog-restart' \$false/);
  assert.match(host,/\$item.profile_fresh=\$profileSelection.fresh_required;\$item.profile_reused=\$profileSelection.existing_required/);
  assert.doesNotMatch(host+profile,/localStorage\.setItem|indexedDB|Copy-Item[^\n]*webview|Remove-Item[^\n]*webview/);
});

test('catalog config and before snapshot remain bounded process-owner evidence routes',()=>{
  assert.match(rust,/if path == "\/__desktop_smoke\/catalog-config" \{\s*if !CATALOG_PHASES.contains\(&self.phase\) \|\| request.method\(\) != "GET"/);
  assert.match(rust,/read_ordinary_json\(&self.directory.join\("catalog-config.json"\), 128 \* 1024\)/);
  assert.match(rust,/if value\["kind"\] == "catalog-snapshot-before" \{\s*if self.phase != "catalog-seed"/);
  assert.match(rust,/if \*requested \{\s*return Some\(error\(400, "Catalog snapshot already requested"\)\)/);
  assert.match(host,/if\(\$Action.kind -ceq 'catalog-snapshot-before'\) \{[\s\S]*?Save-Json \(Get-CatalogAcceptanceSnapshot[\s\S]*?-BeforeBootstrap\) \$snapshot[\s\S]*?return\s*\}/);
  assert.match(host,/\$sequence -gt 64/);
  assert.match(host,/\$reportLimit=if\(\$Scenario -eq 'bulk-import'\)\{4MB\}elseif\([^\n]*'library-catalog'[^\n]*\)\)\{1MB\}/);
  assert.match(host,/\$native.config_sha256=\(Get-FileHash -LiteralPath \$configPath -Algorithm SHA256\)/);
  for(const variable of ['WMH_SOURCE_SHA','WMH_SOURCE_TREE','WMH_LIBRARY_CATALOG_EXECUTABLE'])assert.ok(host.includes(`$env:${variable}=`));
  const snapshot=read('scripts/windows-desktop-catalog-snapshot.ps1');
  for(const area of ['songs','backups','clean-songs','clean-backups','imports','import-backups','catalog','catalog-backups','.catalog-staging'])assert.ok(snapshot.includes(`'${area}'`));
  assert.match(snapshot,/\$nodes -gt 2048/);assert.match(snapshot,/\$rows.Count -ge 512/);
  assert.match(snapshot,/\$entry.depth -ge 8/);assert.match(snapshot,/\$bytes -gt 16MB -or \$totalBytes -gt 32MB/);
  assert.doesNotMatch(snapshot,/Get-ChildItem[^\n]*-Recurse/);
  assert.ok(snapshot.indexOf('Reparse points cannot be catalog acceptance artifacts')<snapshot.indexOf('$pending.Enqueue(@{item=$item;depth=$entry.depth+1})'));
  assert.match(read('tests/windows-desktop-contract.ps1'),/windows-catalog-contract\.ps1/);
});


test('catalog application screenshots capture exactly the actual client pixels without changing picker captures',()=>{
  const capture=host.slice(host.indexOf('function Capture-Handle('),host.indexOf('function Find-Control('));
  assert.match(capture,/function Capture-Handle\(\[IntPtr\]\$Handle,\[string\]\$Name,\[switch\]\$ClientOnly,\[string\]\$GeometryFile\)/);
  assert.match(capture,/\$printFlags=2/);
  assert.match(capture,/if\(\$ClientOnly\) \{\s*if\(\$Scenario -cnotin @\('library-catalog','complete-practice'\)\)\{throw/);
  assert.match(capture,/GetClientRect\(\$Handle,\[ref\]\$rectangle\)/);
  assert.match(capture,/actual client pixels exceed the finite capture bound/);
  assert.match(capture,/Get-CatalogCaptureAssociation \$Name \$env:WMH_DESKTOP_ACCEPTANCE_PHASE -ClientOnly:\$ClientOnly -GeometryFile \$GeometryFile/);
  assert.match(capture,/\$native\[\$association.manifest\]\+=,\$row/);
  assert.match(capture,/Get-NativeWindowGeometry \$App/);
  assert.ok(capture.indexOf('Get-NativeWindowGeometry')<capture.lastIndexOf('Capture-Handle $App.MainWindowHandle'));
  assert.doesNotMatch(capture,/-ne 1280|-ne 720/);
  assert.match(capture,/\$printFlags=3\s*\} elseif\(-not \[NativeAcceptance\]::GetWindowRect\(\$Handle,\[ref\]\$rectangle\)\)/);
  assert.match(capture,/System.Drawing.Bitmap\(\(\$rectangle.Right-\$rectangle.Left\),\(\$rectangle.Bottom-\$rectangle.Top\)\)/);
  assert.match(capture,/PrintWindow\(\$Handle,\$device,\$printFlags\)/);
  assert.match(capture,/Capture-Handle \$App.MainWindowHandle \$Name -ClientOnly:\(\$Scenario -cin @\('library-catalog','complete-practice'\)\)/);
  assert.doesNotMatch(capture,/DrawImage|\.Resize\(|\.ScaleTransform\(/);
  const pickerCalls=host.split('\n').filter(line=>line.includes('Capture-Handle $dialog '));
  assert.ok(pickerCalls.length>0);
  for(const line of pickerCalls)assert.doesNotMatch(line,/-ClientOnly|-GeometryFile/);
  assert.match(capture,/Capture-Handle \$App.MainWindowHandle[^\n]*-GeometryFile \$catalogCaptureGeometryFile/);
  assert.match(host,/\$native.diagnostic_screenshots=@\(\)/);
});


test('native source allowlist import cannot accidentally invoke the verifier CLI',()=>{
  const command=host.match(/\$sourceNames=& node --input-type=module -e '([^']+)' -- catalog-source-list \(Join-Path \$PSScriptRoot 'verify-library-catalog-acceptance.mjs'\)/);
  assert.ok(command,'Source allowlist import needs a distinct inert argv[1] before the module path');
  const verifier=fileURLToPath(new URL('../scripts/verify-library-catalog-acceptance.mjs',import.meta.url));
  const result=spawnSync(process.execPath,['--input-type=module','-e',command[1],'--','catalog-source-list',verifier],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  const files=JSON.parse(result.stdout);
  assert.ok(Array.isArray(files)&&files.length>=15&&files.length<=40);
  assert.ok(files.includes('scripts/verify-library-catalog-acceptance.mjs'));
  assert.ok(files.includes('scripts/windows-desktop-acceptance.ps1'));
});


test('native geometry failures preserve renderer error and raw actual pixels as separate diagnostics',()=>{
  const geometry=read('scripts/windows-desktop-geometry.ps1'), renderer=read('crates/desktop-shell/library-catalog-acceptance.js');
  assert.match(geometry,/owner -ne \$App.Id -or \$root -ne \$window/);
  for(const name of ['GetClientRect','GetWindowRect','ClientToScreen','GetMonitorInfo','GetDpiForWindow','GetScaleFactorForMonitor','GetWindowDpiAwarenessContext','GetThreadDpiAwarenessContext'])assert.ok(geometry.includes(name),name);
  assert.match(geometry,/System.Drawing.Bitmap\(\$width,\$height\)/);
  assert.match(geometry,/kind='diagnostic-only';accepted=\$false/);
  assert.match(geometry,/PrintWindow\(\$window,\$device,3\)/);
  assert.doesNotMatch(geometry,/SetProcessDpi|SetThreadDpi|SetWindowPos|ChangeDisplaySettings|DrawImage|ScaleTransform|Resize/);
  assert.match(host,/\$firstError=\$_;\$failure=\$firstError.Exception.Message/);
  assert.match(host,/New-NativeFailureDiagnostics \$phase \$failure/);
  assert.match(host,/throw \$firstError/);
  const receipt=host.indexOf('$catalogRendererGeometry=$report.geometry;');
  assert.ok(receipt>0&&host.indexOf('if(-not $report.ok)',receipt)<host.indexOf('Capture-Window $app "native-$phase"',receipt),'Original renderer error is checked before success capture');
  assert.match(renderer,/document_client: \{width: document.documentElement.clientWidth, height: document.documentElement.clientHeight\}/);
  assert.match(renderer,/device_pixel_ratio: devicePixelRatio/);
  assert.match(renderer,/innerWidth >= 900 && innerHeight >= 640 && innerWidth <= 1280 && innerHeight <= 720/);
  assert.match(renderer,/innerWidth === 1280 && innerHeight === 720/);
  assert.ok(read('tests/windows-desktop-contract.ps1').includes('windows-desktop-geometry-contract.ps1'));
});
