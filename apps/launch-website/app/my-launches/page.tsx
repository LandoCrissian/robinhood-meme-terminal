import type { Metadata } from "next";
import { MyLaunches } from "../_components/my-launches";

export const metadata: Metadata = { title: "My Launches | RMT Launch" };

export default function MyLaunchesPage() {
  return <MyLaunches />;
}
