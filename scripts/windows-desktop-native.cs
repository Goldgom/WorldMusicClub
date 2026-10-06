using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Text.RegularExpressions;
using System.Collections.Generic;
public sealed class NativeFileNameHost {
  public IntPtr Window;
  public uint AutomationProcess, NativeProcess;
  public string AutomationId, AutomationClass, NativeClass;
  public int NativeControlId;
  public bool AutomationEnabled, InDialog, Enabled, Visible;
}
public sealed class NativeFileNameTarget {
  public IntPtr Dialog, AppWindow, RootOwner, Host, Edit;
  public uint AppProcess, DialogProcess, HostProcess, EditProcess;
  public int HostControlId;
  public string HostClass, EditClass;
  public bool HostInDialog, EditInHost, HostEnabled, EditEnabled, EditVisible, EditReadOnly;
}
public sealed class NativePickerButton {
  public IntPtr Window;
  public uint AutomationProcess, NativeProcess;
  public string AutomationId, AutomationControlType, NativeClass;
  public int NativeControlId;
  public bool IsButton, AutomationEnabled, InDialog, Enabled, Visible;
}
public sealed class NativePickerWindowInventory {
  public IntPtr[] Windows;
  public int Visited;
  public long ElapsedMilliseconds;
  public bool Complete;
  public string StopReason;
}
public static class NativeAcceptance {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public uint Size; public RECT Monitor,Work; public uint Flags; }
  private delegate bool EnumWindowCallback(IntPtr window,IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowCallback callback,IntPtr parameter);
  // Pure policy used by both native polling loops. A ready state first
  // observed at/after the deadline cannot turn a timeout into success.
  public static int PickerPollDecision(long elapsedMilliseconds,int budgetMilliseconds,bool ready) {
    if(elapsedMilliseconds<0 || (budgetMilliseconds!=5000 && budgetMilliseconds!=10000))throw new ArgumentOutOfRangeException("budgetMilliseconds");
    return elapsedMilliseconds >= budgetMilliseconds ? -1 : ready ? 1 : 0;
  }
  public static string PickerObservationStopReason(int visited,long elapsedMilliseconds) {
    if(visited<0 || elapsedMilliseconds<0)throw new ArgumentOutOfRangeException("visited");
    return visited >= 256 ? "visit-limit" : elapsedMilliseconds >= 25 ? "time-limit" : null;
  }
  // This inventory runs outside input verification and opening/closing polls.
  // The callback/time caps limit work, not merely the retained owned windows.
  public static NativePickerWindowInventory OwnedPickerObservationWindows(IntPtr appWindow,uint appProcess) {
    if(appWindow==IntPtr.Zero || appProcess==0)throw new InvalidOperationException("Picker observation needs an exact app owner");
    var result=new NativePickerWindowInventory();var windows=new List<IntPtr>();
    var watch=System.Diagnostics.Stopwatch.StartNew();
    bool complete=EnumWindows(delegate(IntPtr window,IntPtr parameter) {
      result.Visited++;
      result.StopReason=PickerObservationStopReason(result.Visited,watch.ElapsedMilliseconds);
      if(result.StopReason!=null)return false;
      uint process;GetWindowThreadProcessId(window,out process);
      if(window!=appWindow && process==appProcess && GetAncestor(window,3)==appWindow) {
        if(windows.Count==8){result.StopReason="owned-window-limit";return false;}
        windows.Add(window);
      }
      result.StopReason=PickerObservationStopReason(result.Visited,watch.ElapsedMilliseconds);
      return result.StopReason==null;
    },IntPtr.Zero);
    watch.Stop();result.ElapsedMilliseconds=watch.ElapsedMilliseconds;
    if(result.StopReason==null)result.StopReason=PickerObservationStopReason(result.Visited,result.ElapsedMilliseconds);
    if(!complete && result.StopReason==null)result.StopReason="enumeration-failed";
    result.Complete=complete && result.StopReason==null;
    windows.Sort(delegate(IntPtr left,IntPtr right){return left.ToInt64().CompareTo(right.ToInt64());});
    result.Windows=windows.ToArray();return result;
  }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint processId);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder text,int length);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowStyle(IntPtr h,int index);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendPointer(IntPtr h,uint message,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendText(IntPtr h,uint message,UIntPtr w,string l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr ReadText(IntPtr h,uint message,UIntPtr w,StringBuilder l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor,ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("shcore.dll")] public static extern int GetScaleFactorForMonitor(IntPtr monitor,out int scale);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,uint attribute,out RECT rectangle,uint bytes);

  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key,uint mode);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr device,uint flags);
  public static void Key(byte key) { byte scan=(byte)MapVirtualKey(key,0); keybd_event(key,scan,0,UIntPtr.Zero); keybd_event(key,scan,2,UIntPtr.Zero); }
  public static byte[] CanonicalNumericKeys(string phase,string kind) {
    if(phase!="canonical-practice-controls")
      throw new InvalidOperationException("Canonical numeric edits require the canonical controls phase");
    switch(kind) {
      case "canonical-range-start": return new byte[]{0x32};
      case "canonical-range-end": return new byte[]{0x36};
      case "canonical-tempo": return new byte[]{0x39,0x30};
      default: throw new InvalidOperationException("Unknown closed canonical numeric action");
    }
  }
  public static void CanonicalNumericEdit(string phase,string kind) {
    byte[] digits=CanonicalNumericKeys(phase,kind);
    byte controlScan=(byte)MapVirtualKey(0x11,0);
    keybd_event(0x11,controlScan,0,UIntPtr.Zero);
    try { Key(0x41); }
    finally { keybd_event(0x11,controlScan,2,UIntPtr.Zero); }
    foreach(byte digit in digits)Key(digit);
    Key(0x09);
  }
  public static void HeldPerformanceKey(byte key) {
    if(key!=0x32 && key!=0x55)throw new ArgumentOutOfRangeException("key","Only the closed C5 and D-sharp test keys may be held");
    byte scan=(byte)MapVirtualKey(key,0);keybd_event(key,scan,0,UIntPtr.Zero);
    try { System.Threading.Thread.Sleep(40); }
    finally { keybd_event(key,scan,2,UIntPtr.Zero); }
  }
  public static void Click(int x,int y) { POINT actual; if(!SetCursorPos(x,y) || !GetCursorPos(out actual) || actual.X!=x || actual.Y!=y)throw new InvalidOperationException("Native pointer was clipped or could not reach the requested point"); ClickPositioned(); }
  public static void ClickPositioned() { mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
  // Pure checks for passive screen pixels. They never acquire focus or send input.
  public static RECT PassiveCaptureBounds(IntPtr window,IntPtr root,IntPtr foreground,uint expectedProcess,uint ownerProcess,bool visible,bool enabled,RECT client,POINT origin,RECT work,double viewportWidth,double viewportHeight) {
    if(window==IntPtr.Zero || root!=window || foreground!=window || expectedProcess==0 || ownerProcess!=expectedProcess || !visible || !enabled)
      throw new InvalidOperationException("Passive capture requires the visible enabled foreground app owner");
    long width=(long)client.Right-client.Left,height=(long)client.Bottom-client.Top;
    if(client.Left!=0 || client.Top!=0 || width<=0 || height<=0 || width>8192 || height>8192 || width*height>16777216 || viewportWidth!=width || viewportHeight!=height)
      throw new InvalidOperationException("Passive capture requires exact bounded unscaled client pixels");
    long right=(long)origin.X+width,bottom=(long)origin.Y+height;
    if(work.Right<=work.Left || work.Bottom<=work.Top || origin.X<work.Left || origin.Y<work.Top || right>work.Right || bottom>work.Bottom)
      throw new InvalidOperationException("Passive capture client is outside the visible work area");
    return new RECT { Left=origin.X,Top=origin.Y,Right=(int)right,Bottom=(int)bottom };
  }
  public static void ValidatePassiveCaptureScale(uint dpi,uint systemDpi,int windowAwareness,int callerAwareness,int scaleResult,int scale,double rendererRatio,int monitorCount,RECT monitor) {
    // An unaware caller is equivalent only on one 100% monitor at origin zero.
    // Mixed-monitor virtual origins and system-aware nonunit DPI stay rejected.
    bool singleUnitOrigin=monitorCount==1 && monitor.Left==0 && monitor.Top==0;
    if(monitorCount<1 || monitorCount>16 || monitor.Right<=monitor.Left || monitor.Bottom<=monitor.Top || dpi!=96 || windowAwareness<0 || windowAwareness>2 || (callerAwareness!=2 && !(callerAwareness==1 && systemDpi==96) && !(callerAwareness==0 && singleUnitOrigin)) || systemDpi==0 || scaleResult!=0 || scale!=100 || rendererRatio!=1)
      throw new InvalidOperationException("Passive capture requires verified unit desktop and renderer scale");
  }
  public static void ValidatePassiveCaptureOverlay(RECT capture,RECT overlay,bool visible) {
    if(visible && overlay.Right>overlay.Left && overlay.Bottom>overlay.Top && overlay.Left<capture.Right && overlay.Right>capture.Left && overlay.Top<capture.Bottom && overlay.Bottom>capture.Top)
      throw new InvalidOperationException("Passive capture client is occluded by a higher window");
  }
  public static int[] ValidatePassiveCapturePixels(byte[] bytes,int width,int height,int stride) {
    if(width<=0 || height<=0 || width>8192 || height>8192 || (long)width*height>16777216 || stride!=((long)width*3+3)/4*4 || bytes==null || bytes.LongLength!=(long)stride*height)
      throw new InvalidOperationException("Passive capture pixel buffer is invalid");
    int nonBlack=0,different=0,min=255,max=0;
    for(int y=0;y<height;y++)for(int x=0;x<width;x++) {
      int at=y*stride+x*3,r=bytes[at+2],g=bytes[at+1],b=bytes[at];
      if((r|g|b)!=0)nonBlack++;
      if(r!=bytes[2] || g!=bytes[1] || b!=bytes[0])different++;
      min=Math.Min(min,Math.Min(r,Math.Min(g,b)));max=Math.Max(max,Math.Max(r,Math.Max(g,b)));
    }
    if(nonBlack<64 || different<64 || max-min<8)throw new InvalidOperationException("Passive capture pixels are black or uniform");
    return new int[]{nonBlack,different,min,max};
  }
  public static RECT WorkArea(IntPtr window) {
    var monitor=MonitorFromWindow(window,2); var info=new MONITORINFO();info.Size=(uint)Marshal.SizeOf(typeof(MONITORINFO));
    if(monitor==IntPtr.Zero || !GetMonitorInfo(monitor,ref info))throw new InvalidOperationException("Cannot read the app monitor work area");
    return info.Work;
  }
  public static POINT ClientClickPoint(RECT client,POINT origin,double x,double y,double width,double height) {
    if(double.IsNaN(x)||double.IsNaN(y)||double.IsInfinity(x)||double.IsInfinity(y)||double.IsNaN(width)||double.IsNaN(height)||double.IsInfinity(width)||double.IsInfinity(height)||width<=0||height<=0||x<0||y<0||x>=width||y>=height||client.Right<=client.Left||client.Bottom<=client.Top)
      throw new InvalidOperationException("Native target is outside the finite current viewport");
    // Floor stays inside the half-open client bounds, including negative screen origins.
    return new POINT {X=checked(origin.X+(int)Math.Floor(x*(client.Right-client.Left)/width)),Y=checked(origin.Y+(int)Math.Floor(y*(client.Bottom-client.Top)/height))};
  }
  public static void ValidateClientClick(RECT work,POINT requested,POINT actual,IntPtr window,IntPtr foreground,bool hitInApp) {
    if(work.Right<=work.Left||work.Bottom<=work.Top||requested.X<work.Left||requested.X>=work.Right||requested.Y<work.Top||requested.Y>=work.Bottom)
      throw new InvalidOperationException("Native target is outside the monitor work area");
    if(actual.X!=requested.X||actual.Y!=requested.Y)throw new InvalidOperationException("Native pointer was clipped before the click");
    if(window==IntPtr.Zero||foreground!=window||!hitInApp)throw new InvalidOperationException("Native point does not hit the foreground app window");
  }
  public static IntPtr SelectFileNameHost(NativeFileNameHost[] candidates,uint appProcess) {
    if(candidates==null || candidates.Length==0 || candidates.Length>8 || appProcess==0)
      throw new InvalidOperationException("Windows filename host inventory is missing or exceeds eight candidates");
    IntPtr selected=IntPtr.Zero;
    foreach(var candidate in candidates) {
      // AutomationId is scoped to siblings, not all dialog descendants. Match
      // the UIA host to its actual HWND; repeated IDs alone are not ambiguity.
      if(candidate==null || candidate.Window==IntPtr.Zero || candidate.AutomationId!="1148" || candidate.AutomationClass!="ComboBoxEx32" || candidate.NativeClass!="ComboBoxEx32" || candidate.NativeControlId!=1148 || candidate.AutomationProcess!=appProcess || candidate.NativeProcess!=appProcess || !candidate.AutomationEnabled || !candidate.InDialog || !candidate.Enabled || !candidate.Visible)
        continue;
      if(selected!=IntPtr.Zero && selected!=candidate.Window)
        throw new InvalidOperationException("Windows filename host has multiple verified native handles");
      selected=candidate.Window;
    }
    if(selected==IntPtr.Zero)
      throw new InvalidOperationException("Windows filename host has no verified native handle");
    return selected;
  }
  public static void ValidateFileNameTarget(NativeFileNameTarget target) {
    if(target==null || target.Dialog==IntPtr.Zero || target.AppWindow==IntPtr.Zero || target.Host==IntPtr.Zero || target.Edit==IntPtr.Zero || target.Host==target.Edit || target.RootOwner!=target.AppWindow || target.AppProcess==0 || target.DialogProcess!=target.AppProcess || target.HostProcess!=target.AppProcess || target.EditProcess!=target.AppProcess || target.HostControlId!=1148 || target.HostClass!="ComboBoxEx32" || target.EditClass!="Edit" || !target.HostInDialog || !target.EditInHost || !target.HostEnabled || !target.EditEnabled || !target.EditVisible || target.EditReadOnly)
      throw new InvalidOperationException("Native filename handle ownership, class, identity or writable state does not match");
  }
  public static IntPtr SelectPickerOpenButton(NativePickerButton[] candidates,uint appProcess) {
    return SelectPickerActionButton(candidates,appProcess,1);
  }
  public static IntPtr SelectPickerActionButton(NativePickerButton[] candidates,uint appProcess,int controlId) {
    if(controlId!=1 && controlId!=2)throw new InvalidOperationException("Only native Open and Cancel buttons are accepted");
    string label=controlId==1?"Open":"Cancel";
    if(candidates==null || candidates.Length==0 || candidates.Length>8 || appProcess==0)
      throw new InvalidOperationException(label+" button inventory is missing or exceeds eight candidates");
    IntPtr selected=IntPtr.Zero;
    foreach(var candidate in candidates) {
      // The provider can report a non-Button UIA type for an actual Win32
      // Button. Its verified native identity remains the selection criterion.
      if(candidate==null || candidate.Window==IntPtr.Zero || candidate.AutomationId!=controlId.ToString(System.Globalization.CultureInfo.InvariantCulture) || candidate.NativeClass!="Button" || candidate.NativeControlId!=controlId || candidate.AutomationProcess!=appProcess || candidate.NativeProcess!=appProcess || !candidate.AutomationEnabled || !candidate.InDialog || !candidate.Enabled || !candidate.Visible)
        continue;
      if(selected!=IntPtr.Zero && selected!=candidate.Window)
        throw new InvalidOperationException(label+" button has multiple verified native handles");
      selected=candidate.Window;
    }
    if(selected==IntPtr.Zero)throw new InvalidOperationException(label+" button has no verified native handle");
    return selected;
  }
  public static POINT PickerClickPoint(RECT dialog,RECT button) {
    if(dialog.Right<=dialog.Left || dialog.Bottom<=dialog.Top || button.Right<=button.Left || button.Bottom<=button.Top || button.Left<dialog.Left || button.Top<dialog.Top || button.Right>dialog.Right || button.Bottom>dialog.Bottom)
      throw new InvalidOperationException("Open button bounds are empty or outside the owned picker");
    return new POINT { X=(int)((long)button.Left+((long)button.Right-button.Left)/2), Y=(int)((long)button.Top+((long)button.Bottom-button.Top)/2) };
  }
  public static void ValidatePickerClick(IntPtr dialog,IntPtr appWindow,IntPtr rootOwner,IntPtr foreground,uint appProcess,uint dialogProcess,bool hitInButton) {
    if(dialog==IntPtr.Zero || appWindow==IntPtr.Zero || dialog==appWindow || rootOwner!=appWindow || foreground!=dialog || appProcess==0 || dialogProcess!=appProcess || !hitInButton)
      throw new InvalidOperationException("Open click ownership, foreground or button hit test does not match");
  }
  public static bool PickerDismissed(bool exists,bool visible,bool ownedPopupVisible,bool appForeground,bool appEnabled) {
    return (!exists || !visible) && !ownedPopupVisible && appForeground && appEnabled;
  }
  public static string ReadControlText(IntPtr window) {
    var value=new StringBuilder(257);UIntPtr copied;
    if(ReadText(window,0x000D,new UIntPtr((uint)value.Capacity),value,0x23,1000,out copied)==IntPtr.Zero)
      throw new InvalidOperationException("Owned control text read exceeded 1000 ms or failed");
    return value.ToString();
  }
  public static string ResolveFixturePath(string fixtures,string output,string name) {
    if(name=="bulk-multiple") {
      string first=ResolveFixturePath(fixtures,output,"bulk-standard-a.json"),second=ResolveFixturePath(fixtures,output,"bulk-standard-b.json");
      return "\""+first+"\" \""+second+"\"";
    }
    if(name=="authoring-original-pair") {
      string first=ResolveFixturePath(fixtures,output,"authoring-original-strict.mid"),second=ResolveFixturePath(fixtures,output,"authoring-original-events.mid");
      return "\""+first+"\" \""+second+"\"";
    }
    string directory;
    if(Array.IndexOf(new[]{"original-duet.musicxml","original-duet.mxl","midi-original-ppq.mid","original-reference-overlap.mid","jianpu-original-steps.jianpu","malformed.json","folder-original.json","folder-conflict.json","原创曲包_日本語.zip","bulk-conflict.zip","bulk-backup.json","bulk-failure.zip","bulk-malformed.zip","bulk-standard-a.json","bulk-standard-b.json","clean-authored-song.zip","vsq-authored-song.zip","performance-authored-songs.zip","pitch-bend-authored-songs.zip","authoring-original-strict.mid","authoring-original-events.mid","authoring-original-blocked.mid","authoring-original.vsq","complete-practice-original.zip","canonical-practice-original.json","canonical-practice-original.musicxml","live-tone-navigation-original.json","human-mod-timbre-original.json","skin-original-score.json","skin-original.json","checker.png","basic-key-original.zip","basic-key-invalid-profile.zip","basic-key-forged-coverage.zip","catalog-original-legacy.zip","catalog-original-shared.zip","catalog-original-clean.zip"},name)>=0)
      directory=fixtures;
    else if(name!=null && Regex.IsMatch(name,@"\A(seed|restart|close-active|reopen)-(?:[1-9]|1[0-6])\.json\z",RegexOptions.CultureInvariant))
      directory=Path.Combine(output,"downloads");
    else if(name!=null && Regex.IsMatch(name,@"\A(bulk-seed|bulk-restart|bulk-failure|clean-seed|clean-restart|vsq-seed|vsq-restart|authoring-seed|authoring-restart|vsq-authoring-seed|vsq-authoring-restart|basic-key-seed|basic-key-restart|complete-practice-seed|complete-practice-restart|catalog-seed|catalog-restart|catalog-final)-(?:[1-9]|1[0-6])\.(zip|json)\z",RegexOptions.CultureInvariant))
      directory=Path.Combine(output,"downloads");
    else throw new InvalidOperationException("File is outside the finite acceptance fixture list");
    string path=Path.GetFullPath(Path.Combine(directory,name));
    if(!File.Exists(path) || (File.GetAttributes(path)&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=0)
      throw new InvalidOperationException("Acceptance fixture must be an existing regular file");
    return path;
  }
  public static IntPtr FileNameEdit(IntPtr host) {
    UIntPtr result;
    // CBEM_GETEDITCONTROL has no pointer payload; it returns this host's edit HWND.
    if(SendPointer(host,0x0407,UIntPtr.Zero,IntPtr.Zero,0x23,1000,out result)==IntPtr.Zero || result==UIntPtr.Zero)
      throw new InvalidOperationException("Native filename edit lookup failed or exceeded 1000 ms");
    return new IntPtr(unchecked((long)result.ToUInt64()));
  }
  public static void ValidateFileNameText(string path) {
    if(String.IsNullOrEmpty(path) || path.Length>32767 || path.IndexOf('\0')>=0)
      throw new InvalidOperationException("Invalid native filename text");
  }
  public static void ValidateFileNameReadback(string path,string actual,ulong copied) {
    if(copied!=(ulong)path.Length || !String.Equals(actual,path,StringComparison.Ordinal))
      throw new InvalidOperationException("Native filename readback differs from the approved fixture path");
  }
  public static void SetFileName(IntPtr edit,string path) {
    ValidateFileNameText(path);
    UIntPtr result;
    // WM_SETTEXT/WM_GETTEXT are marshalled system messages; never send pointers
    // to process-local buffers in a custom control message.
    if(SendText(edit,0x000C,UIntPtr.Zero,path,0x23,1000,out result)==IntPtr.Zero || result==UIntPtr.Zero)
      throw new InvalidOperationException("Native filename text entry failed or exceeded 1000 ms");
    // Leave room for one extra content character so a longer value cannot be
    // truncated to an apparently exact approved prefix plus terminator.
    var value=new StringBuilder(path.Length+2);
    if(ReadText(edit,0x000D,new UIntPtr((uint)value.Capacity),value,0x23,1000,out result)==IntPtr.Zero)
      throw new InvalidOperationException("Native filename readback failed or exceeded 1000 ms");
    ValidateFileNameReadback(path,value.ToString(),result.ToUInt64());
  }
}
