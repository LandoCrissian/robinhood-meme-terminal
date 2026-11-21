import { notFound } from "next/navigation";
import { CreatorProfile } from "../../_components/creator-profile";
import { creatorMetadata, readCreator } from "../../../lib/server/social-pages";

type Props = { params: Promise<{ username: string }> };
export async function generateMetadata({ params }: Props) {
  const { username } = await params;
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) notFound();
  return creatorMetadata("u", username);
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) notFound();
  const found = await readCreator("u", username);
  if (found.status === "missing") notFound();
  return <CreatorProfile key={username} username={username} initialProfile={found.status === "ready" ? found.profile : undefined} />;
}
