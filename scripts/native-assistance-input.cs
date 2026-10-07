// Closed test-owned input. No arbitrary text, virtual key, path or target.
using System;
using System.Runtime.InteropServices;
public static class NativeAssistanceInput {
 [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] static extern uint MapVirtualKey(uint key,uint mode);
 static void Down(byte key){keybd_event(key,(byte)MapVirtualKey(key,0),0,UIntPtr.Zero);}
 static void Up(byte key){keybd_event(key,(byte)MapVirtualKey(key,0),2,UIntPtr.Zero);}
 static void Key(byte key){Down(key);Up(key);}
 public static string Value(string kind){switch(kind){case "assistance-onset":return "1";case "assistance-interval":return "100";case "assistance-held":return "2";case "assistance-span":return "7";default:throw new InvalidOperationException("Unknown fixed assistance input");}}
 public static void Edit(string phase,string kind){if(phase!="assistance-seed")throw new InvalidOperationException("Only assistance seed edits fixed limits");string value=Value(kind);Down(0x11);try{Key(0x41);}finally{Up(0x11);}foreach(char c in value)Key((byte)c);Key(0x09);}
}
