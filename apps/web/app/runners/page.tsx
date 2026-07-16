import { ExternalMarketFeed } from "../external-market-feed";
import { SiteFooter } from "../site-footer";

export default function RunnersPage() {
  return (
    <main className="directoryPage focusedDirectory">
      <ExternalMarketFeed />
      <SiteFooter />
    </main>
  );
}
