const utc = new Intl.DateTimeFormat("en", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
});

export function ChainTime({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? <time dateTime={value}>{utc.format(date)} UTC</time> : <>Unavailable</>;
}
