#!/usr/bin/env bash
#
# Build an APK inside the dev container and drop it at the repo root as
# irrigo-<type>-YYYYMMDD-HHMMSS.apk. Sideload that file to the Pixel to
# install.
#
# Usage:
#   ./build-apk.sh              # debug build (default, fastest)
#   ./build-apk.sh --release    # release build (bundled JS, minified, no Metro)
#
# The release build is still signed with debug.keystore (see
# app/android/app/build.gradle), which is fine for personal sideloading —
# the phone already trusts that key, so release APKs install over the
# existing debug build without uninstalling first.
#
# The Android SDK / NDK / Gradle caches live in the dev container's named
# volumes, so the first build after a container recreate is slow (~5-10 min)
# while the toolchain populates; subsequent builds are incremental.
#
# Re-run expo prebuild manually after editing app.json or adding a native
# module — this script only runs it automatically on first build (when
# app/android is missing):
#   docker compose exec dev bash -c 'cd /app/app && bunx expo prebuild --platform android'

set -euo pipefail

cd "$(dirname "$0")"

BUILD_TYPE='debug'
for arg in "$@"; do
    case "$arg" in
        -r|--release) BUILD_TYPE='release' ;;
        -d|--debug)   BUILD_TYPE='debug' ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "error: unknown argument: $arg" >&2
            echo "usage: $0 [--release|--debug]" >&2
            exit 1
            ;;
    esac
done

if [[ "$BUILD_TYPE" == 'release' ]]; then
    GRADLE_TASK='assembleRelease'
    APK_SRC='app/android/app/build/outputs/apk/release/app-release.apk'
else
    GRADLE_TASK='assembleDebug'
    APK_SRC='app/android/app/build/outputs/apk/debug/app-debug.apk'
fi

APK_DEST="./irrigo-${BUILD_TYPE}-$(date +%Y%m%d-%H%M%S).apk"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx dev; then
    echo 'error: dev container is not running. Start it with: docker compose up -d dev' >&2
    exit 1
fi

if [[ ! -d app/android ]]; then
    echo '==> app/android missing; running expo prebuild...'
    docker compose exec -T dev bash -c 'cd /app/app && bunx expo prebuild --platform android'
fi

echo "==> building $BUILD_TYPE APK inside dev container..."
docker compose exec -T dev bash -c "cd /app/app/android && ./gradlew $GRADLE_TASK"

if [[ ! -f "$APK_SRC" ]]; then
    echo "error: build succeeded but APK not found at $APK_SRC" >&2
    exit 1
fi

cp "$APK_SRC" "$APK_DEST"

find . -maxdepth 1 -name "irrigo-${BUILD_TYPE}-*.apk" ! -name "$(basename "$APK_DEST")" -delete

SIZE=$(du -h "$APK_DEST" | cut -f1)
echo "==> wrote $APK_DEST ($SIZE)"
