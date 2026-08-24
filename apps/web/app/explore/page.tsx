import { redirect } from "next/navigation";
import { TERMINAL_ROOT_PATH } from "../../lib/vnext/legacy-terminal-routes";

export default function ExplorePage() {
  redirect(TERMINAL_ROOT_PATH);
}
