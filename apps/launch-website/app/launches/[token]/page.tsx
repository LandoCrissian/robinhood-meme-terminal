import { notFound } from "next/navigation";
import { launchExample } from "../../../lib/curve-showcase";
import { ShowcaseToken } from "../../_components/launch-showcase";

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const example = launchExample(token);
  if (!example) notFound();
  return <ShowcaseToken example={example} />;
}
