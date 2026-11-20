"""Repeat exactly three ordinary public GETs; never sends an authentication header."""
import datetime
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None

READS = [
    ("website-history", "https://www.rmtlaunch.fun/api/launchpad/launches"),
    ("website-new-engine", "https://www.rmtlaunch.fun/api/launchpad/new-engine"),
    ("railway-health", "https://robinhood-meme-terminal-production.up.railway.app/health"),
]
HEADER_NAMES = {"x-nf-request-id", "cache-control", "netlify-cdn-cache-control",
                "cache-status", "content-type", "age", "x-railway-request-id"}

def clock():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def point(value):
    return {key: value.get(key) for key in ("blockNumber", "blockHash", "timestamp")}

def capture(output):
    if output.exists():
        raise RuntimeError("Refuse to overwrite an earlier observation")
    opener, rows = urllib.request.build_opener(NoRedirect), []
    for label, url in READS:
        started, timer = clock(), time.monotonic()
        request = urllib.request.Request(url, headers={
            "Accept": "application/json", "Cache-Control": "no-cache",
            "User-Agent": "RMT-Task089-read-only-correlation"})
        try:
            response = opener.open(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(131_073)
            if len(raw) > 131_072:
                raise RuntimeError("Response exceeds the read-only capture bound")
            data = json.loads(raw)
            summary = {key: data[key] for key in
                       ("coverage", "status", "observedAt", "chainId", "finality",
                        "indexedThrough", "latestBlock") if key in data}
            if data.get("checkpoint") is not None:
                summary["checkpoint"] = point(data["checkpoint"])
            if label == "railway-health":
                curve = data["curveLaunchpad"]
                summary.update(ok=data["ok"], lagBlocks=data["lagBlocks"],
                               initialSyncComplete=data["initialSyncComplete"],
                               lastSyncAt=data["lastSyncAt"],
                               errorPresent=data["error"] is not None,
                               curveLaunchpad={"status": curve["status"],
                                               "checkpoint": point(curve["checkpoint"]),
                                               "revision": curve["revision"],
                                               "verifiedAt": curve["verifiedAt"],
                                               "caughtUp": curve["caughtUp"]})
            rows.append({
                "label": label, "startedAt": started, "finishedAt": clock(),
                "path": urllib.parse.urlsplit(url).path, "method": "GET",
                "status": response.status,
                "durationMs": round((time.monotonic() - timer) * 1000),
                "bodySha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
                "headers": {key.lower(): value for key, value in response.headers.items()
                            if key.lower() in HEADER_NAMES},
                "bodySummary": summary,
            })
    output.write_text(json.dumps({
        "schemaVersion": 1, "noAuthenticationHeaders": True,
        "redirectsFollowed": False, "productionMutations": False,
        "requests": rows}, indent=2) + "\n")

if __name__ == "__main__":
    import sys
    capture(Path(sys.argv[1]))
