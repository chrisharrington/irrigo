#!/usr/bin/env bash
#
# Build a debug APK inside the dev container and drop it at the repo root as
# irrigo.apk. Sideload that file to the Pixel to install.
#
# The Android SDK / NDK / Gradle caches live in the dev container's named
# volumes, so the first build after a container recreate is slow (~5-10 min)
# while the toolchain populates; subsequent builds are incremental.
#
# Re-run expo prebuild manually after editing app.json or adding a native
# module — this script does not:
#   docker compose exec dev bash -c 'cd /app/app && bunx expo prebuild --platform android'

set -euo pipefail

cd "$(dirname "$0")"

APK_SRC='app/android/app/build/outputs/apk/debug/app-debug.apk'
APK_DEST='./irrigo.apk'

if ! docker compose ps --status running --services 2>/dev/null | grep -qx dev; then
    echo 'error: dev container is not running. Start it with: docker compose up -d dev' >&2
    exit 1
fi

echo '==> building debug APK inside dev container...'
docker compose exec -T dev bash -c 'cd /app/app/android && ./gradlew assembleDebug'

if [[ ! -f "$APK_SRC" ]]; then
    echo "error: build succeeded but APK not found at $APK_SRC" >&2
    exit 1
fi

cp "$APK_SRC" "$APK_DEST"
SIZE=$(du -h "$APK_DEST" | cut -f1)
echo "==> wrote $APK_DEST ($SIZE)"
