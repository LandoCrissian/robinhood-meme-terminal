import { redirect } from "next/navigation";

export default function PausedProfileLayout({ children: _children }: Readonly<{ children: React.ReactNode }>) {
  redirect("/");
}
