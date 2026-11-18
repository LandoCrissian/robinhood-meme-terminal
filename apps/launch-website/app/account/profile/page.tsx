import type { Metadata } from "next";
import { ProfileEditor } from "../../_components/profile-editor";

export const metadata: Metadata = { title: "Edit profile | RMT Launch" };
export default function AccountProfilePage() { return <ProfileEditor />; }
