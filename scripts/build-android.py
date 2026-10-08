"""Build a debug APK with the official Android SDK tools and the Rust NDK target.

No Gradle download or third-party Android runtime is needed. Signing is debug-only.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {"arm64-v8a": ("aarch64-linux-android", "aarch64-linux-android"),
           "x86_64": ("x86_64-linux-android", "x86_64-linux-android")}


def run(args, env=None):
    print("Running:", " ".join(str(value) for value in args), flush=True)
    subprocess.run([str(value) for value in args], cwd=ROOT, env=env, check=True)


def tool(directory, name):
    return directory / (name + (".exe" if os.name == "nt" else ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--abi", choices=TARGETS, action="append", help="Repeat for a universal APK; default arm64-v8a")
    parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
    parser.add_argument("--ndk", default=os.environ.get("ANDROID_NDK_HOME"))
    parser.add_argument("--build-tools", default="35.0.0")
    parser.add_argument("--platform", default="35")
    parser.add_argument("--jobs", type=int, default=2, help="Bound native compilation memory (default 2)")
    options = parser.parse_args()
    sdk = Path(options.sdk) if options.sdk else Path.home() / "AppData/Local/Android/Sdk"
    if not sdk.is_dir():
        parser.error("Set ANDROID_HOME or pass --sdk to the Android SDK directory")
    ndk = Path(options.ndk) if options.ndk else sdk / "ndk/28.2.13676358"
    host = "windows-x86_64" if os.name == "nt" else "linux-x86_64"
    llvm = ndk / "toolchains/llvm/prebuilt" / host / "bin"
    android_jar = sdk / "platforms" / ("android-" + options.platform) / "android.jar"
    tools = sdk / "build-tools" / options.build_tools
    if os.environ.get("JAVA_HOME"):
        java_home = Path(os.environ["JAVA_HOME"])
    else:
        settings = subprocess.run([shutil.which("java") or "java", "-XshowSettings:properties", "-version"], capture_output=True, text=True, check=True)
        match = re.search(r"^\s*java.home\s*=\s*(.+)$", settings.stderr, re.MULTILINE)
        if not match:
            parser.error("Cannot discover JDK; set JAVA_HOME")
        java_home = Path(match.group(1).strip())
    java = java_home / "bin"
    required = [android_jar, tool(llvm, "clang"), tool(tools, "aapt2"), tool(tools, "zipalign"), tools / "lib/d8.jar", tools / "lib/apksigner.jar", tool(java, "javac"), tool(java, "keytool")]
    for path in required:
        if not path.is_file():
            parser.error(f"Missing tool: {path}. Set JAVA_HOME to a full JDK and install SDK 35/build-tools 35.0.0/NDK 28.2.13676358")
    abis = list(dict.fromkeys(options.abi or ["arm64-v8a"]))
    output = ROOT / "dist/android"
    work = ROOT / "target/android-package"
    output.mkdir(parents=True, exist_ok=True)
    # Delete only this build's verified private staging directory.
    if work.resolve().parent != (ROOT / "target").resolve():
        raise RuntimeError("Android staging escaped target")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    classes = work / "classes"
    classes.mkdir()
    native = {}
    for abi in abis:
        target, triple = TARGETS[abi]
        env = os.environ.copy()
        key = target.upper().replace("-", "_")
        env[f"CARGO_TARGET_{key}_LINKER"] = str(tool(llvm, "clang"))
        env[f"CARGO_TARGET_{key}_RUSTFLAGS"] = f"-C link-arg=--target={triple}28 -C link-arg=-Wl,-z,max-page-size=16384"
        env.pop("RUSTFLAGS", None)  # Host Windows CRT flags must not reach Android.
        env[f"CC_{target.replace('-', '_')}"] = str(tool(llvm, "clang"))
        env[f"CFLAGS_{target.replace('-', '_')}"] = f"--target={triple}28"
        env[f"AR_{target.replace('-', '_')}"] = str(tool(llvm, "llvm-ar"))
        run(["cargo", "build", "-p", "worldmusicclub-android", "--release", "--locked", "--jobs", options.jobs, "--target", target], env)
        native[abi] = ROOT / "target" / target / "release/libworldmusicclub_android.so"
    run([tool(tools, "aapt2"), "compile", "--dir", ROOT / "android/res", "-o", work / "resources.zip"])
    unaligned = work / "unsigned.apk"
    run([tool(tools, "aapt2"), "link", "-o", unaligned, "-I", android_jar, "--manifest", ROOT / "android/AndroidManifest.xml", "--debug-mode", "-A", ROOT / "android/assets", work / "resources.zip"])
    sources = sorted((ROOT / "android/src").rglob("*.java"))
    run([tool(java, "javac"), "-encoding", "UTF-8", "--release", "8", "-classpath", android_jar, "-d", classes, *sources])
    dex = work / "dex"
    dex.mkdir()
    run([tool(java, "java"), "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--min-api", "28", "--lib", android_jar, "--output", dex, *sorted(classes.rglob("*.class"))])
    source_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    source_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=ROOT, text=True).strip())
    identity = {"product": "WorldMusicClub", "source_sha": source_sha, "source_tree": source_tree, "source_dirty": dirty,
                "abis": abis, "min_sdk": 28, "target_sdk": 35, "signing": "debug", "acceptance": "development-unaccepted"}
    with zipfile.ZipFile(unaligned, "a", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dex.glob("*.dex")):
            archive.write(path, path.name)
        for abi, path in native.items():
            archive.write(path, f"lib/{abi}/{path.name}")
        archive.writestr("assets/BUILD-INFO.json", json.dumps(identity, indent=2) + "\n")
        archive.write(ROOT / "LICENSE", "assets/LICENSE")
        archive.write(ROOT / "docs/CATALOG_RIGHTS.md", "assets/CATALOG_RIGHTS.md")
        for path in sorted((ROOT / "catalog/editions").rglob("LICENSE*")):
            archive.write(path, "assets/" + path.relative_to(ROOT).as_posix())
        for abi in abis:
            notices = work / "notices" / abi
            run([sys.executable, ROOT / "scripts/prepare-rust-notices.py", "--target", TARGETS[abi][0], "--manifest-path", ROOT / "crates/android-shell/Cargo.toml", "--no-default-features", "--output", notices])
            for path in sorted(notices.rglob("*")):
                if path.is_file():
                    archive.write(path, f"assets/licenses/rust/{abi}/" + path.relative_to(notices).as_posix())
    aligned = work / "aligned.apk"
    run([tool(tools, "zipalign"), "-f", "-P", "16", "4", unaligned, aligned])
    keystore = ROOT / ".toolchains/android/debug.keystore"
    keystore.parent.mkdir(parents=True, exist_ok=True)
    if not keystore.exists():
        run([tool(java, "keytool"), "-genkeypair", "-keystore", keystore, "-storepass", "android", "-keypass", "android", "-alias", "androiddebugkey", "-dname", "CN=Android Debug,O=WorldMusicClub,C=US", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000"])
    apk = output / "worldmusicclub-debug.apk"
    run([tool(java, "java"), "-jar", tools / "lib/apksigner.jar", "sign", "--ks", keystore, "--ks-key-alias", "androiddebugkey", "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", apk, aligned])
    run([tool(java, "java"), "-jar", tools / "lib/apksigner.jar", "verify", "--verbose", apk])
    run([tool(tools, "zipalign"), "-c", "-P", "16", "4", apk])
    identity["apk_sha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
    (output / "BUILD-INFO.json").write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")
    print(f"Debug APK: {apk}\nSHA-256: {identity['apk_sha256']}\nDevelopment package; full acceptance is separate.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
