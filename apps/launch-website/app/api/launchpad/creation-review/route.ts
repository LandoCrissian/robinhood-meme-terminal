import { reviewLaunchDraft } from "../../../../lib/server/launch-draft";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return reviewLaunchDraft(request);
}
