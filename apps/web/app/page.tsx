import "./vnext/vnext-terminal.css";
import "./vnext/vnext-terminal-reconstruction.css";
import { VNextTerminalShell } from "./vnext/vnext-terminal-shell";

export { metadata } from "./vnext/page";

export default function Home() {
  return <VNextTerminalShell />;
}
