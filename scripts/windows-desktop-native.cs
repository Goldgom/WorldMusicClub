using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Text.RegularExpressions;
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
public static class NativeAcceptance {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public uint Size; public RECT Monitor,Work; public uint Flags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
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
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key,uint mode);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr device,uint flags);
  public static void Key(byte key) { byte scan=(byte)MapVirtualKey(key,0); keybd_event(key,scan,0,UIntPtr.Zero); keybd_event(key,scan,2,UIntPtr.Zero); }
  public static void Click(int x,int y) { POINT actual; if(!SetCursorPos(x,y) || !GetCursorPos(out actual) || actual.X!=x || actual.Y!=y)throw new InvalidOperationException("Native pointer was clipped or could not reach the requested point"); ClickPositioned(); }
  public static void ClickPositioned() { mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
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
    if(Array.IndexOf(new[]{"original-duet.musicxml","original-duet.mxl","midi-original-ppq.mid","original-reference-overlap.mid","jianpu-original-steps.jianpu","malformed.json","folder-original.json","folder-conflict.json","原创曲包_日本語.zip","bulk-conflict.zip","bulk-backup.json","bulk-failure.zip","bulk-malformed.zip","bulk-standard-a.json","bulk-standard-b.json","clean-authored-song.zip","vsq-authored-song.zip","performance-authored-songs.zip","pitch-bend-authored-songs.zip","authoring-original-strict.mid","authoring-original-events.mid","authoring-original-blocked.mid","authoring-original.vsq"},name)>=0)
      directory=fixtures;
    else if(name!=null && Regex.IsMatch(name,@"\A(seed|restart|close-active|reopen)-(?:[1-9]|1[0-6])\.json\z",RegexOptions.CultureInvariant))
      directory=Path.Combine(output,"downloads");
    else if(name!=null && Regex.IsMatch(name,@"\A(bulk-seed|bulk-restart|bulk-failure|clean-seed|clean-restart|vsq-seed|vsq-restart|authoring-seed|authoring-restart|vsq-authoring-seed|vsq-authoring-restart)-(?:[1-9]|1[0-6])\.(zip|json)\z",RegexOptions.CultureInvariant))
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
