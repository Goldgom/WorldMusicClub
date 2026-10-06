using System;

// A separate fixed-key state machine. Existing C5/D-sharp and paired Key()
// primitives are intentionally unchanged. Only this owner can hold test R.
public static class NativeLiveToneNavigationKey {
  private static bool held;
  private static string ownerPhase;
  private static IntPtr ownerWindow;
  private static uint ownerProcess;
  private static System.Diagnostics.Stopwatch heldClock;
  public static bool Held { get { return held; } }
  public static long HeldMilliseconds { get { return held && heldClock!=null ? heldClock.ElapsedMilliseconds : 0; } }

  public static bool IsPhase(string phase) {
    return phase=="live-navigation-settings-keyup" || phase=="live-navigation-settings-navigation"
      || phase=="live-navigation-authoring-keyup" || phase=="live-navigation-authoring-navigation"
      || phase=="human-timbre-seed" || phase=="human-timbre-migrate" || phase=="human-timbre-restart";
  }
  public static bool ValidateTransition(string phase,string kind,bool wasHeld,string priorPhase,IntPtr priorWindow,uint priorProcess,IntPtr window,IntPtr foreground,uint process,bool enabled) {
    if(!IsPhase(phase))throw new InvalidOperationException("Fixed R actions require an explicit native live-tone phase");
    if(window==IntPtr.Zero || foreground!=window || process==0 || !enabled)
      throw new InvalidOperationException("Prepared live-key foreground ownership was lost");
    if(kind=="live-key-r-down") {
      if(wasHeld)throw new InvalidOperationException("Native test R is already held");
      return true;
    }
    if(kind=="live-key-r-up") {
      if(!wasHeld || priorPhase!=phase || priorWindow!=window || priorProcess!=process)
        throw new InvalidOperationException("Native test R release does not match its original owner");
      return false;
    }
    throw new InvalidOperationException("Unknown closed native R action");
  }
  public static void Down(string phase,IntPtr window,IntPtr foreground,uint process,bool enabled) {
    ValidateTransition(phase,"live-key-r-down",held,ownerPhase,ownerWindow,ownerProcess,window,foreground,process,enabled);
    // Record ownership before sending down, so finally can release even if the
    // platform call fails after it has changed the keyboard state.
    held=true;ownerPhase=phase;ownerWindow=window;ownerProcess=process;heldClock=System.Diagnostics.Stopwatch.StartNew();
    NativeAcceptance.keybd_event(0x52,(byte)NativeAcceptance.MapVirtualKey(0x52,0),0,UIntPtr.Zero);
  }
  public static void Up(string phase,IntPtr window,IntPtr foreground,uint process,bool enabled) {
    ValidateTransition(phase,"live-key-r-up",held,ownerPhase,ownerWindow,ownerProcess,window,foreground,process,enabled);
    ReleaseIfHeld();
  }
  public static bool ReleaseIfHeld() {
    if(!held)return false;
    NativeAcceptance.keybd_event(0x52,(byte)NativeAcceptance.MapVirtualKey(0x52,0),2,UIntPtr.Zero);
    held=false;ownerPhase=null;ownerWindow=IntPtr.Zero;ownerProcess=0;heldClock.Stop();heldClock=null;return true;
  }
}
