import Link from "next/link";

const views = [["projects", "/my-launches", "Projects"], ["earnings", "/my-launches/earnings", "Earnings"]] as const;

export function MyLaunchesNav({ active }: { active: typeof views[number][0] | "treasury" | "reclaim" }) {
  return <nav className="lpEarningsTabs" aria-label="My Launches views">{views.map(([id, href, label]) =>
    <Link href={href} key={id} className="lpBack" prefetch={false} aria-current={active === id ? "page" : undefined}>{label}</Link>)}</nav>;
}
