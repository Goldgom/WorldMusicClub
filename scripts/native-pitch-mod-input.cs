// Only the explicit pitch acceptance seed may enter its fixed +2 draft.
// No caller-supplied text, virtual key, phase, path or arbitrary target.
using System;
using System.Runtime.InteropServices;
public static class NativePitchModInput {
 [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 [DllImport("user32.dll")] static extern uint MapVirtualKey(uint key, uint mode);
 static void Down(byte key) { keybd_event(key, (byte)MapVirtualKey(key, 0), 0, UIntPtr.Zero); }
 static void Up(byte key) { keybd_event(key, (byte)MapVirtualKey(key, 0), 2, UIntPtr.Zero); }
 static void Key(byte key) { Down(key); Up(key); }
 public static void Validate(string phase, string kind) {
  if (phase != "pitch-mod-seed" || kind != "pitch-mod-shift-two") throw new InvalidOperationException("Fixed pitch edit requires the pitch seed");
 }
 public static void Edit(string phase, string kind) {
  Validate(phase, kind); Down(0x11); try { Key(0x41); } finally { Up(0x11); }
  Key(0x32); Key(0x09);
 }
}
