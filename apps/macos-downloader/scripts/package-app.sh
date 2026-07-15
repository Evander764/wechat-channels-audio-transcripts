#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="WeChat Channels Downloader_beta"
DISPLAY_NAME="微信视频号下载器_beta"
APP="$ROOT/dist/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
TOOLS="$RESOURCES/tools"
VERSION="0.1.3-beta.1"

cd "$ROOT"
swift build -c release

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES/proxy" "$TOOLS"

cp "$ROOT/.build/release/WeChatChannelsDownloader" "$MACOS/$APP_NAME"
cp "$ROOT/.build/release/wcd-helper" "$MACOS/wcd-helper"
cp "$ROOT/Resources/proxy/"*.py "$RESOURCES/proxy/"

if [ -x "/Users/evander/Documents/Software/必备工具/wechat-live-exporter/.build/release/wechat-live-exporter" ]; then
  cp "/Users/evander/Documents/Software/必备工具/wechat-live-exporter/.build/release/wechat-live-exporter" "$TOOLS/wechat-live-exporter"
elif [ -d "/Users/evander/Documents/Software/必备工具/wechat-live-exporter" ]; then
  (cd "/Users/evander/Documents/Software/必备工具/wechat-live-exporter" && swift build -c release)
  cp "/Users/evander/Documents/Software/必备工具/wechat-live-exporter/.build/release/wechat-live-exporter" "$TOOLS/wechat-live-exporter"
fi

python3 "$ROOT/scripts/generate-icon.py" "$ROOT/dist/icon.iconset"
iconutil -c icns "$ROOT/dist/icon.iconset" -o "$RESOURCES/AppIcon.icns"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$DISPLAY_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>local.evander.wechat-channels-downloader.beta</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$DISPLAY_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticTermination</key>
  <false/>
</dict>
</plist>
PLIST

chmod +x "$MACOS/$APP_NAME" "$MACOS/wcd-helper"
[ -f "$TOOLS/wechat-live-exporter" ] && chmod +x "$TOOLS/wechat-live-exporter"
codesign --force --deep --sign - "$APP"
echo "$APP"
