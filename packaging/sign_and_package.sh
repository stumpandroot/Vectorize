#!/bin/bash
# Signs dist/Vectorize.app, puts it in a DMG, notarizes the DMG, and staples the ticket.
#
# Environment:
#   SIGN_IDENTITY       "Developer ID Application: Your Name (TEAMID)". Without it, the DMG is unsigned (for testing only).
#   APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID   for notarizing. Without them, the DMG is signed but not notarized.
#   VZ_VERSION          version in the file name, such as 1.0.0
set -euo pipefail

APP="dist/Vectorize.app"
VERSION="${VZ_VERSION:-1.0.0}"
if [ "$(uname -m)" = "arm64" ]; then LABEL="Apple-Silicon"; else LABEL="Intel"; fi
DMG="dist/Vectorize-${VERSION}-${LABEL}.dmg"
ENT="packaging/entitlements.plist"

sign() {
  codesign --force --timestamp --options runtime --entitlements "$ENT" --sign "$SIGN_IDENTITY" "$1"
}

if [ -n "${SIGN_IDENTITY:-}" ]; then
  echo "Signing every binary inside the app"
  while IFS= read -r -d '' f; do
    if file -b "$f" | grep -q "Mach-O"; then sign "$f"; fi
  done < <(find "$APP/Contents" -type f -print0)
  echo "Signing the app"
  sign "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
else
  echo "SIGN_IDENTITY isn't set, so the app stays unsigned. Use this DMG for testing only."
fi

echo "Making $DMG"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Vectorize" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "Notarizing (this usually takes a few minutes)"
    OUT="$(xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait --timeout 45m --output-format json)"
    echo "$OUT"
    STATUS="$(echo "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')"
    if [ "$STATUS" != "Accepted" ]; then
      ID="$(echo "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
      [ -n "$ID" ] && xcrun notarytool log "$ID" --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID" || true
      echo "Notarization status: $STATUS" >&2
      exit 1
    fi
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
    spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
  else
    echo "Apple ID secrets aren't set, so the DMG is signed but not notarized."
  fi
fi

echo "dmg=$DMG" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "Done: $DMG"
