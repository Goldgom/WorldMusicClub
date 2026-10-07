// Closed test-owned +2 seed edit and one fixed S press after pitch restart.
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
 public static void ValidateKey(string phase, string kind) {
  if (phase != "pitch-mod-restart" || kind != "pitch-mod-key-s") throw new InvalidOperationException("Fixed S requires the exact pitch restart action");
 }
 public static void PlayS(string phase, string kind) {
  ValidateKey(phase, kind); Down(0x53);
  try { System.Threading.Thread.Sleep(40); }
  finally { Up(0x53); }
 }
}
