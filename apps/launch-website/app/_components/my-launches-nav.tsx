import Link from "next/link";

const views = [["projects", "/my-launches", "Projects"], ["earnings", "/my-launches/earnings", "Earnings"],
  ["treasury", "/my-launches/treasury", "Treasury"]] as const;

export function MyLaunchesNav({ active }: { active: typeof views[number][0] }) {
  return <nav className="lpEarningsTabs" aria-label="My Launches views">{views.map(([id, href, label]) =>
    <Link href={href} key={id} className="lpBack" prefetch={false} aria-current={active === id ? "page" : undefined}>{label}</Link>)}</nav>;
}
