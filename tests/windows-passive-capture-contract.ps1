# The compiled production helper is exercised only with original scalar/pixel
# inputs. No window APIs, screenshots, pointer, keyboard, or GUI are invoked.
$captureClient=New-Object NativeAcceptance+RECT;$captureClient.Right=640;$captureClient.Bottom=360
$captureOrigin=New-Object NativeAcceptance+POINT;$captureOrigin.Y=31
$captureWork=New-Object NativeAcceptance+RECT;$captureWork.Right=640;$captureWork.Bottom=391
$captureBox=[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,101,$true,$true,$captureClient,$captureOrigin,$captureWork,640,360)
Assert-True ($captureBox.Left -eq 0 -and $captureBox.Top -eq 31 -and $captureBox.Right -eq 640 -and $captureBox.Bottom -eq 391) 'passive exact client pixels'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]0,[IntPtr]10,[IntPtr]10,101,101,$true,$true,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive missing HWND'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]11,[IntPtr]10,101,101,$true,$true,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive foreign root'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]11,101,101,$true,$true,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive foreign foreground'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,102,$true,$true,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive foreign PID'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,101,$false,$true,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive hidden client'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,101,$true,$false,$captureClient,$captureOrigin,$captureWork,640,360)} 'passive disabled client'
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,101,$true,$true,$captureClient,$captureOrigin,$captureWork,800,360)} 'passive scaled viewport'
$offscreen=New-Object NativeAcceptance+POINT;$offscreen.X=-1;$offscreen.Y=31
Assert-Rejected {[NativeAcceptance]::PassiveCaptureBounds([IntPtr]10,[IntPtr]10,[IntPtr]10,101,101,$true,$true,$captureClient,$offscreen,$captureWork,640,360)} 'passive offscreen client'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureOverlay($captureBox,$captureBox,$true)} 'passive occluded client'
[NativeAcceptance]::ValidatePassiveCaptureOverlay($captureBox,$captureBox,$false);$script:checks++
foreach($windowAwareness in @(0,1,2)){[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,$windowAwareness,1,0,100,1,1,$captureWork);$script:checks++}
[NativeAcceptance]::ValidatePassiveCaptureScale(96,144,2,2,0,100,1,1,$captureWork);$script:checks++
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(120,96,1,1,0,100,1,1,$captureWork)} 'passive nonunit window DPI'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,144,1,1,0,100,1,1,$captureWork)} 'passive system caller virtualization'
[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,0,0,100,1,1,$captureWork);$script:checks++
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,0,0,100,1,2,$captureWork)} 'passive unaware mixed monitor topology'
$shiftedMonitor=New-Object NativeAcceptance+RECT;$shiftedMonitor.Left=10;$shiftedMonitor.Right=650;$shiftedMonitor.Bottom=391
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,0,0,100,1,1,$shiftedMonitor)} 'passive unaware nonzero monitor origin'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,1,-1,100,1,1,$captureWork)} 'passive scale query failure'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,1,0,125,1,1,$captureWork)} 'passive scaled monitor'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCaptureScale(96,96,1,1,0,100,1.25,1,$captureWork)} 'passive scaled renderer'
$originalPixels=[byte[]]::new(16*16*3)
for($pixel=1;$pixel -lt 256;$pixel++){$originalPixels[$pixel*3]=200}
$stats=[NativeAcceptance]::ValidatePassiveCapturePixels($originalPixels,16,16,48)
Assert-True ($stats[0] -eq 255 -and $stats[1] -eq 255 -and $stats[2] -eq 0 -and $stats[3] -eq 200) 'passive RGB statistics'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCapturePixels([byte[]]::new(768),16,16,48)} 'passive black pixels'
$uniform=[byte[]]::new(768);for($pixel=0;$pixel -lt 256;$pixel++){$uniform[$pixel*3]=200}
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCapturePixels($uniform,16,16,48)} 'passive uniform colored pixels'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCapturePixels($originalPixels,16,16,64)} 'passive wrong padded RGB stride'
Assert-Rejected {[NativeAcceptance]::ValidatePassiveCapturePixels($originalPixels,16,15,48)} 'passive wrong buffer length'
