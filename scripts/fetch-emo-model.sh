#!/usr/bin/env bash
# Download the Emo model for scripts/upload-emo-assets.mjs. The app loads the
# published copy from R2 at runtime (src/lib/emo-suggest.js). Downloads stay in
# gitignored vendor/emo/<tag>/ (~16MB). LFS files are checked against the Hub's
# sha256 before upload.
#
#   scripts/fetch-emo-model.sh            # tag the installed SDK pins (v0.7.0)
#   scripts/fetch-emo-model.sh v0.8.0
set -euo pipefail

TAG="${1:-v0.7.0}"
REPO="desert-ant-labs/emo"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/emo/$TAG"
mkdir -p "$DEST"

curl -fsSL "https://huggingface.co/api/models/$REPO/tree/$TAG?recursive=true" |
python3 -c '
import json, sys
for f in json.load(sys.stdin):
    if f["type"] == "file":
        print(f["path"], (f.get("lfs") or {}).get("oid", "-"))
' |
while read -r path oid; do
	out="$DEST/$path"
	mkdir -p "$(dirname "$out")"
	curl -fsSL "https://huggingface.co/$REPO/resolve/$TAG/$path" -o "$out"
	if [ "$oid" != "-" ]; then
		got="$(shasum -a 256 "$out" | cut -d' ' -f1)"
		[ "$got" = "$oid" ] || { echo "sha256 mismatch: $path" >&2; exit 1; }
	fi
	echo "$path"
done

echo "saved to vendor/emo/$TAG"
