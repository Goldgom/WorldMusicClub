# MIDI input setup

Open **Settings → MIDI device & key test**, connect the keyboard to your computer, then choose **Connect MIDI**. The browser requests input access only after that click, with system-exclusive messages disabled. A browser permission grant is not a physical-device or audio-latency test. No MIDI output, instrument programming or hardware transposition command is sent.

Choose **All MIDI inputs**, one exact reported device, or **No MIDI input**. A saved single-device choice remains unavailable when it disappears; the app does not substitute a similarly named keyboard. The choice is stored only in this browser profile. If storage cannot be read, inputs default to None with a visible message; if saving fails, the new choice remains usable in the current tab. Device identifiers, names and manufacturers do not enter score, library, backup or take exports.

Connection and port-open state are separate. A connected device can have a closed port; `pending` is a Web MIDI connection state, distinct from an opening request still in progress. A busy or failed input stays visible and can be retried with Connect MIDI. Only selected input ports are opened. Changing devices releases their previous input generation without silencing a new generation's same-pitch key. MIDI channels remain separate.

## Visual key test

Start **visual key test** in Settings and press/release keys. The monitor displays MIDI pitch (middle C is MIDI60/C4), channel1–16, attack/release velocity, held input contacts and the pitch extrema observed during this test. The configured instrument range is shown separately; observing a few keys does not establish the keyboard's full range or key count. Endpoint comparison does not certify a playable arrangement or fingering.

Testing pauses playback and routes its notes exclusively to this silent monitor. It does not create practice inputs or score the test. Closing Settings, changing selection/devices, hiding the page or losing focus stops testing and clears held highlights. Last readings remain explicitly marked stopped. Configure piano key count/range separately in the instrument settings.

Delayed events are assigned through private timestamped binding intervals. An older genuine practice event may still reach its original pass after testing begins, without replaying live sound. Notes whose timestamps belong to the test stay excluded even if delivered later. After a test-mode change, a practice message without a usable event timestamp is excluded rather than guessed into a take. Current test messages can still be displayed using receipt time. Exclusions are visible and preserved as an aggregate page-lifetime count in [take export metadata](TAKE_EXPORT.md); no per-pass attribution is invented.

## Practice and verification limits

Return to the stage and start a practice pass to assess note-on pitch/timing. MIDI transmits input messages, not the keyboard's audio. The app's synthesized sound is approximate; hardware/driver/acoustic latency needs testing on the actual computer. Sustain pedal, note duration, release accuracy, hand choice and guitar string/finger are not graded. A MIDI pitch does not prove a particular fingering.

Automated checks use simulated MIDI ports and browser events, including equal-pitch ports, reconnect/replacement, permission refusal, selection persistence, delayed callbacks and test-mode isolation. Genuine hardware, physical keys and OS/device-driver behavior remain unverified. Browser support follows the [Web MIDI API](https://www.w3.org/TR/webmidi/); see also [port connection states](https://developer.mozilla.org/en-US/docs/Web/API/MIDIPort/connection) and [MIDI message events](https://developer.mozilla.org/en-US/docs/Web/API/MIDIInput/midimessage_event).
