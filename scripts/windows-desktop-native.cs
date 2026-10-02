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
public static class NativeAcceptance {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint processId);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder text,int length);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowStyle(IntPtr h,int index);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendPointer(IntPtr h,uint message,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendText(IntPtr h,uint message,UIntPtr w,string l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr ReadText(IntPtr h,uint message,UIntPtr w,StringBuilder l,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key,uint mode);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr device,uint flags);
  public static void Key(byte key) { byte scan=(byte)MapVirtualKey(key,0); keybd_event(key,scan,0,UIntPtr.Zero); keybd_event(key,scan,2,UIntPtr.Zero); }
  public static void Click(int x,int y) { SetCursorPos(x,y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
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
  public static string ResolveFixturePath(string fixtures,string output,string name) {
    string directory;
    if(Array.IndexOf(new[]{"original-duet.musicxml","original-duet.mxl","midi-original-ppq.mid","jianpu-original-steps.jianpu","malformed.json"},name)>=0)
      directory=fixtures;
    else if(name!=null && Regex.IsMatch(name,@"\A(seed|restart|close-active|reopen)-(?:[1-9]|1[0-6])\.json\z",RegexOptions.CultureInvariant))
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
