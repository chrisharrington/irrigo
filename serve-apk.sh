#!/usr/bin/env bash
#
# Serve the most recent irrigo APK over the LAN and print a scannable QR
# pointing at it. Scan with the phone camera, Chrome downloads the APK, tap
# to install. The server exits after one successful download — re-run for
# another install.
#
# Usage:
#   ./serve-apk.sh              # serve the newest debug APK (default)
#   ./serve-apk.sh --release    # serve the newest release APK
#
# Override the port if 8000 is busy:  PORT=8765 ./serve-apk.sh

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8000}"

BUILD_TYPE='debug'
for arg in "$@"; do
    case "$arg" in
        -r|--release) BUILD_TYPE='release' ;;
        -d|--debug)   BUILD_TYPE='debug' ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "error: unknown argument: $arg" >&2
            echo "usage: $0 [--release|--debug]" >&2
            exit 1
            ;;
    esac
done

# build-apk.sh writes ./irrigo-<type>-YYYYMMDD-HHMMSS.apk and deletes older
# matches of the same type, so the newest entry by mtime is the freshly
# built APK for that build type.
APK=$(ls -1t "irrigo-${BUILD_TYPE}-"*.apk 2>/dev/null | head -n1 || true)
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
    echo "error: no irrigo-${BUILD_TYPE}-*.apk found at repo root. Run ./build-apk.sh${BUILD_TYPE:+ --$BUILD_TYPE} first." >&2
    exit 1
fi
APK="./$APK"

LAN_IP=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}')
if [[ -z "${LAN_IP:-}" ]]; then
    echo 'error: could not determine LAN IP from default route.' >&2
    exit 1
fi

APK_NAME=$(basename "$APK")
URL="http://${LAN_IP}:${PORT}/${APK_NAME}"

echo
echo "Serving $APK at $URL"
echo 'Scan the QR with your phone camera. Server exits after one download.'
echo

# qrcode-terminal's CLI has no small-mode flag — small rendering is only
# exposed via the library API. The package is installed under
# app/node_modules (transitive), so invoke the library through `bun -e`
# from that directory.
(cd app && URL="$URL" bun -e 'require("qrcode-terminal").generate(process.env.URL, { small: true });')

APK="$APK" APK_NAME="$APK_NAME" PORT="$PORT" LAN_IP="$LAN_IP" bun -e '
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
            const interval = setInterval(() => {
                if (server.pendingRequests === 0) {
                    clearInterval(interval);
                    server.stop();
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
