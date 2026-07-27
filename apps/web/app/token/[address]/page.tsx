import { ProjectDetailPage } from "../../project/[address]/project-detail-page";

// Existing token URLs remain valid while Project becomes the canonical
// project-first surface for RMT-native launches.
export default function LegacyTokenProjectPage() {
  return <ProjectDetailPage />;
}
