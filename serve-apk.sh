#!/usr/bin/env bash
#
# Serve irrigo.apk over the LAN and print a scannable QR pointing at it. Scan
# with the phone camera, Chrome downloads the APK, tap to install. The server
# exits after one successful download — re-run for another install.
#
# Override the port if 8000 is busy:  PORT=8765 ./serve-apk.sh

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# build-apk.sh writes ./irrigo-YYYYMMDD-HHMMSS.apk and deletes older matches,
# so the newest entry by mtime is the freshly built APK.
APK=$(ls -1t irrigo-*.apk 2>/dev/null | head -n1 || true)
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
    echo 'error: no irrigo-*.apk found at repo root. Run ./build-apk.sh first.' >&2
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

bunx qrcode-terminal "$URL"

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
