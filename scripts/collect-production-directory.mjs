import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirectoryMonitor, MAX_DIRECTORY_MONITOR_PAGES } from "./verify-production-health.mjs";

// Only public directory reads. No auth, enrichment, execution or environment lookup.
export async function collectProductionDirectory({
  first, fetchPage = async cursor => {
    const url = new URL("https://www.rmtlaunch.fun/api/vnext/market-directory");
    url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2_000_000) throw new Error("Directory response exceeds monitor byte budget.");
      chunks.push(chunk);
    }
    return { status: response.status, headers: [...response.headers].map(([key, value]) => `${key}: ${value}`).join("\n"),
      page: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  }, record = () => {}, now = Date.now
}) {
  const deadline = now() + 90_000;
  const monitor = createDirectoryMonitor();
  const observations = [{ ...first, requestCursor: null }];
  record(observations);
  monitor.accept(observations[0]);
  let cursor = first.page.nextCursor;
  while (cursor !== null) {
    if (observations.length >= MAX_DIRECTORY_MONITOR_PAGES || now() >= deadline) throw new Error("Directory collection budget exhausted; pagination incomplete.");
    const response = await fetchPage(cursor);
    const observation = { ...response, requestCursor: cursor };
    observations.push(observation);
    record(observations);
    if (now() >= deadline) throw new Error("Directory collection time budget exhausted.");
    monitor.accept(observation);
    cursor = response.page.nextCursor;
  }
  return monitor.finish();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const directory = process.argv[2] ?? "health-artifacts";
  const headers = fs.readFileSync(path.join(directory, "directory.headers"), "utf8");
  const status = Number([...headers.matchAll(/^HTTP\/\S+\s+(\d{3})/gm)].at(-1)?.[1]);
  const result = await collectProductionDirectory({
    first: { status, headers, page: JSON.parse(fs.readFileSync(path.join(directory, "directory.json"), "utf8")) },
    record: observations => fs.writeFileSync(path.join(directory, "directory-pages.json"), JSON.stringify(observations, null, 2))
  });
  console.info(JSON.stringify(result));
}
