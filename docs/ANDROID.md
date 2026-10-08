# Android development client

The Android client embeds the existing Rust score engine, original licensed
catalog, offline engraving assets and shared UI in an Android WebView. JNI
reuses the Windows native request dispatcher and exact musical time. It starts
no server, opens no listening socket and requests no Internet permission.
Android application ID: `org.worldmusicclub.android`.

## Compile

Requirements: Python 3, Node/npm, stable Rust, a full JDK (17 or newer), Android
SDK platform 35, build-tools 35.0.0 and NDK 28.2.13676358. Set `JAVA_HOME` if
Java discovery finds a JRE. Set `ANDROID_HOME` to your SDK directory (Windows
also discovers `%LOCALAPPDATA%/Android/Sdk`). Install the SDK components using
Android Studio or `sdkmanager`.

Update Android System WebView on the device: the shared interface uses current
JavaScript, Web Audio and AudioWorklet APIs. The minimum SDK is an installation
floor; Android 9 hardware/WebView combinations have not all been device-tested.

```sh
npm ci --ignore-scripts --omit=optional
rustup target add aarch64-linux-android x86_64-linux-android
npm run android:build
# Include an x86_64 library for emulator testing:
npm run android:build -- --abi arm64-v8a --abi x86_64
```

The script calls Cargo, aapt2, javac, D8, zipalign and apksigner directly. It
does not need Gradle. The default APK supports ARM64 Android 9 (API 28) and
newer. ARM32 and other ABIs are not included. NDK libraries use 16 KiB ELF
segment alignment; APK alignment and signing are checked at the end.

Output: `dist/android/worldmusicclub-debug.apk` and `BUILD-INFO.json` with the
source SHA, dirty state, ABI list and APK SHA-256. The generated debug signing
key stays in ignored `.toolchains/android/`. This is a debug-signed development
package, not a Play Store release. The manual **Android development APK**
workflow builds ARM64 + x86_64 and uploads a development artifact; it never
publishes a release or marks acceptance complete.

## Install and inspect

```sh
adb install -r dist/android/worldmusicclub-debug.apk
adb shell am start -n org.worldmusicclub.android/.MainActivity
```

Debug WebView inspection is available through `chrome://inspect` on an attached
device. Foreign pages cannot enter this WebView or use the native bridge.
External reference links are opened by the system browser only after a user
gesture. Native file imports use the system document picker; blob exports use
the system save dialog. Score archives stay in app-private storage, backups are
disabled, and uninstalling removes that private library. Export your backups
before uninstalling.

Run `npm run android:smoke` after installation to inspect the actual APK through
its debug WebView. It verifies the rendered catalog, Rust compile/error replies,
bundled worklet assets and private-library reads, and writes a screenshot and
report under `dist/android/device-smoke/`. Set `ANDROID_SERIAL` for multiple
devices. This read-only smoke does not verify physical MIDI, audio latency or
the Android import/export dialogs.

## Current limits and acceptance

- The shared responsive UI is reused; Android USB/Bluetooth MIDI is not
  implemented. Browser Web MIDI availability must not be interpreted as native
  Android MIDI support. Physical keyboard availability depends on the device.
- Android requests have an explicit 8 MiB limit, including complete source
  bytes. Larger song packs are refused whole; no sources are silently removed.
  Exports have a 32 MiB limit. Large desktop library packs can exceed these limits.
- The bridge forwards request headers, including encoded song-pack filenames,
  conflict choices and selected song indices. Header JSON is limited to 8 KiB
  and 32 entries; Rust validates header names, values and the request origin.
- Audio starts and resumes reserve 250 ms for the Android WebView worklet
  acknowledgement. The sample anchor still controls playback and input timing;
  an acknowledgement arriving after that anchor cancels playback.
  Notation response parsing, validation and publication wait while audio owns
  startup admission, including when a seek requests a new score page.
- Debug package compilation/signature checks and device startup checks are
  separate from full browser, audio, import/export and Windows/native acceptance.
  A successful build does not accept the exact source checkpoint or promote it
  to `main`; follow `AGENTS.md` and retain the validation branch until all gates pass.
- Only original or already documented compatible-license catalog assets are
  bundled. Code and third-party music rights remain separate; the APK retains
  code and catalog notices and the engraving component notices.
