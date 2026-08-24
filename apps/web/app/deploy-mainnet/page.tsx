import { redirect } from "next/navigation";
import { TERMINAL_ROOT_PATH } from "../../lib/vnext/legacy-terminal-routes";

export const metadata = { robots: { index: false, follow: false } };

export default function RetiredMainnetConsoleCompatibilityPage() {
  redirect(TERMINAL_ROOT_PATH);
}
