#!/usr/bin/env bash
# 用官方 build-tools 手工打一个 WebView 壳 APK（不依赖 Gradle / Android Studio）
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
B="$ROOT/build"
T="$ROOT/.tools"

JDK_DIR=$(ls -d "$T"/jdk-* 2>/dev/null | head -1)
BT_DIR=$(ls -d "$T"/build-tools/* 2>/dev/null | head -1)
PLAT_DIR=$(ls -d "$T"/platforms/* 2>/dev/null | head -1)
[ -d "$JDK_DIR" ] || { echo "缺少 JDK"; exit 1; }
[ -d "$BT_DIR" ] || { echo "缺少 build-tools"; exit 1; }
[ -d "$PLAT_DIR" ] || { echo "缺少 platform"; exit 1; }

JAVAC="$JDK_DIR/bin/javac"
KEYTOOL="$JDK_DIR/bin/keytool"
JAR="$JDK_DIR/bin/jar"
D8="$BT_DIR/d8.bat"
AAPT2="$BT_DIR/aapt2.exe"
ZIPALIGN="$BT_DIR/zipalign.exe"
APKSIGNER="$BT_DIR/apksigner.bat"

echo "JDK   = $JDK_DIR"
echo "BT    = $BT_DIR"
echo "PLAT  = $PLAT_DIR"

rm -rf "$B"
mkdir -p "$B/classes" "$B/dex"

echo "[1/6] javac"
"$JAVAC" -source 8 -target 8 -nowarn -encoding UTF-8 -bootclasspath "$PLAT_DIR/android.jar" \
  -d "$B/classes" android/src/com/jptracker/app/MainActivity.java

echo "[2/6] d8"
"$D8" --release --min-api 21 --lib "$PLAT_DIR/android.jar" --output "$B/dex" \
  $(find "$B/classes" -name '*.class')

echo "[3/6] aapt2 compile"
"$AAPT2" compile --dir android/res -o "$B/res.zip"

echo "[4/6] aapt2 link"
"$AAPT2" link -o "$B/base.apk" -I "$PLAT_DIR/android.jar" \
  --manifest android/AndroidManifest.xml -R "$B/res.zip" --auto-add-overlay

echo "[5/6] add classes.dex"
( cd "$B/dex" && "$JAR" --update --file "$B/base.apk" classes.dex >/dev/null )
"$ZIPALIGN" -f -p 4 "$B/base.apk" "$B/aligned.apk" >/dev/null

echo "[6/6] sign"
if [ ! -f "$T/debug.keystore" ]; then
  "$KEYTOOL" -genkeypair -keystore "$T/debug.keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
mkdir -p public
"$APKSIGNER" sign --ks "$T/debug.keystore" --ks-pass pass:android --key-pass pass:android \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out public/app.apk "$B/aligned.apk"

"$APKSIGNER" verify --print-certs public/app.apk | head -5
"$AAPT2" dump badging public/app.apk | head -4
ls -lh public/app.apk
