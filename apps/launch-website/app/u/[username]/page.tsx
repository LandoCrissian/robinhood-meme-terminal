import { notFound } from "next/navigation";
import { CreatorProfile } from "../../_components/creator-profile";

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) notFound();
  return <CreatorProfile username={username} />;
}
