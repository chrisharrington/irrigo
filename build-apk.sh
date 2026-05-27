#!/usr/bin/env bash
#
# Build an APK inside the dev container, then serve it over the LAN with a
# scannable QR code. Scan with the phone camera, Chrome downloads the APK,
# tap to install. The APK file is deleted after one successful download.
#
# Usage:
#   ./build-apk.sh              # debug build (default, fastest)
#   ./build-apk.sh --release    # release build (bundled JS, minified, no Metro)
#
# Override the serve port if 8000 is busy:  PORT=8765 ./build-apk.sh
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

PORT="${PORT:-8000}"

BUILD_TYPE='debug'
for arg in "$@"; do
    case "$arg" in
        -r|--release) BUILD_TYPE='release' ;;
        -d|--debug)   BUILD_TYPE='debug' ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
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

LAN_IP=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}')
if [[ -z "${LAN_IP:-}" ]]; then
    echo 'error: could not determine LAN IP from default route. APK is on disk; not served.' >&2
    exit 1
fi

APK_NAME=$(basename "$APK_DEST")
URL="http://${LAN_IP}:${PORT}/${APK_NAME}"

echo
echo "Serving $APK_DEST at $URL"
echo 'Scan the QR with your phone camera. APK is deleted after one download.'
echo

# qrcode-terminal's CLI has no small-mode flag — small rendering is only
# exposed via the library API. The package is installed under
# app/node_modules (transitive), so invoke the library through `bun -e`
# from that directory.
(cd app && URL="$URL" bun -e 'require("qrcode-terminal").generate(process.env.URL, { small: true });')

APK="$APK_DEST" APK_NAME="$APK_NAME" PORT="$PORT" LAN_IP="$LAN_IP" bun -e '
const fs = require("fs");
const file = Bun.file(process.env.APK);
const size = file.size;
const apkName = process.env.APK_NAME;
const apkPath = `/${apkName}`;

const server = Bun.serve({
    port: Number(process.env.PORT),
    hostname: process.env.LAN_IP,
    fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== apkPath) return new Response("not found", { status: 404 });

        console.log(`-> ${req.method} ${url.pathname} (${(size / 1024 / 1024).toFixed(1)} MB)`);

        // Stop only after the GET response has fully drained — calling
        // server.stop() too early truncates the stream. Poll pendingRequests
        // and shut down once the in-flight transfer settles. HEAD requests
        // (Android download manager, curl -I) are ignored so they cannot
        // shut the server down before the real download starts.
        if (req.method === "GET") {
            const interval = setInterval(async () => {
                if (server.pendingRequests === 0) {
                    clearInterval(interval);
                    await server.stop();
                    fs.unlinkSync(process.env.APK);
                    console.log(`-> deleted ${process.env.APK}`);
                }
            }, 250);
        }

        return new Response(file, {
            headers: {
                "Content-Type": "application/vnd.android.package-archive",
                "Content-Disposition": `attachment; filename=${apkName}`,
                "Content-Length": String(size),
            },
        });
    },
});

console.log(`Listening on ${server.url.href}`);
'
