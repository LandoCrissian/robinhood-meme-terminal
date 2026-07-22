import { sharedCacheHeaders } from "../../../../lib/server/cache-headers";
import {
  readConsentRehearsalStatus,
  unavailableConsentRehearsalStatus
} from "../../../../lib/server/consent-rehearsal-status";

export const dynamic = "force-dynamic";

const SUCCESS_HEADERS = sharedCacheHeaders({
  browserMaxAgeSeconds: 2,
  sharedMaxAgeSeconds: 10,
  staleWhileRevalidateSeconds: 20
});

export async function GET() {
  try {
    const status = await readConsentRehearsalStatus();
    if (!status.ok) {
      return Response.json(status, {
        status: 503,
        headers: { "Cache-Control": "no-store", "X-RMT-Integrity": status.integrity }
      });
    }
    return Response.json(status, {
      headers: { ...SUCCESS_HEADERS, "X-RMT-Integrity": status.integrity }
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "consent_rehearsal_status_error",
      errorType: error instanceof Error ? error.name : "UnknownError"
    }));
    return Response.json(unavailableConsentRehearsalStatus(), {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "10", "X-RMT-Integrity": "unavailable" }
    });
  }
}
