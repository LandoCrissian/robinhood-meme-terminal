import { redirect } from "next/navigation";

export default function PausedCreatorConsentLayout({ children: _children }: Readonly<{ children: React.ReactNode }>) {
  redirect("/");
}
