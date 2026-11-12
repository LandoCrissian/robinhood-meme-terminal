import LegacyRuntime from "../legacy-runtime";
import "./protection-center.css";
import "./protection-recovery.css";

export default function ProtectionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LegacyRuntime>{children}</LegacyRuntime>;
}
