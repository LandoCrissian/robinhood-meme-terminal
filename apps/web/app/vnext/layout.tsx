import "./vnext-terminal.css";
import LegacyRuntime from "../legacy-runtime";

export default function VNextLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LegacyRuntime>{children}</LegacyRuntime>;
}
