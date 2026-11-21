// The search and market strokes come from the existing RMT terminal icon set.
const icons = {
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  market: <path d="M4 20V10m8 10V4m8 16V7M2 20h20" />,
};

export function ShowcaseIcon({ name }: { name: keyof typeof icons }) {
  return <svg className="rmtIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}
