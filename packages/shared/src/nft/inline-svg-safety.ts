const MAX_SVG_NUMBER = 1_000_000_000;
const NUMBER = "-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUMBER_PATTERN = new RegExp(`^${NUMBER}$`);
const VIEW_BOX_PATTERN = new RegExp(`^${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}$`);
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

type ParsedTag = {
  attributes: Map<string, string>;
  next: number;
};

function skipWhitespace(svg: string, from: number): number {
  let cursor = from;
  while (cursor < svg.length && /\s/.test(svg[cursor]!)) cursor += 1;
  return cursor;
}

function parseTag(svg: string, from: number, name: "svg" | "rect", closing: ">" | "/>"): ParsedTag | null {
  if (!svg.startsWith(`<${name}`, from)) return null;
  let cursor = from + name.length + 1;
  if (cursor >= svg.length || (!/\s/.test(svg[cursor]!) && !svg.startsWith(closing, cursor))) return null;
  const attributes = new Map<string, string>();

  while (cursor < svg.length) {
    cursor = skipWhitespace(svg, cursor);
    if (svg.startsWith(closing, cursor)) return { attributes, next: cursor + closing.length };
    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(svg.slice(cursor));
    if (!nameMatch) return null;
    const attributeName = nameMatch[0];
    if (attributes.has(attributeName)) return null;
    cursor += attributeName.length;
    cursor = skipWhitespace(svg, cursor);
    if (svg[cursor] !== "=") return null;
    cursor = skipWhitespace(svg, cursor + 1);
    const quote = svg[cursor];
    if (quote !== "\"" && quote !== "'") return null;
    const valueStart = cursor + 1;
    const valueEnd = svg.indexOf(quote, valueStart);
    if (valueEnd < 0) return null;
    attributes.set(attributeName, svg.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
    if (!/\s/.test(svg[cursor] ?? "") && !svg.startsWith(closing, cursor)) return null;
  }
  return null;
}

function isBoundedNumber(value: string, nonnegative: boolean): boolean {
  if (!NUMBER_PATTERN.test(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= MAX_SVG_NUMBER && (!nonnegative || number >= 0);
}

function validSvgAttributes(attributes: Map<string, string>): boolean {
  const allowed = new Set(["xmlns", "width", "height", "viewBox"]);
  if ([...attributes.keys()].some((name) => !allowed.has(name))) return false;
  if (attributes.get("xmlns") !== "http://www.w3.org/2000/svg") return false;
  for (const name of ["width", "height"] as const) {
    const value = attributes.get(name);
    if (value !== undefined && !isBoundedNumber(value, true)) return false;
  }
  const viewBox = attributes.get("viewBox");
  if (viewBox !== undefined) {
    if (!VIEW_BOX_PATTERN.test(viewBox)) return false;
    if (viewBox.split(/\s+/).some((component) => !isBoundedNumber(component, false))) return false;
  }
  return true;
}

function validRectAttributes(attributes: Map<string, string>): boolean {
  const allowed = new Set(["x", "y", "width", "height", "rx", "ry", "fill"]);
  if ([...attributes.keys()].some((name) => !allowed.has(name))) return false;
  for (const name of ["x", "y", "width", "height", "rx", "ry"] as const) {
    const value = attributes.get(name);
    if (value !== undefined && !isBoundedNumber(value, true)) return false;
  }
  const fill = attributes.get("fill");
  return fill === undefined || HEX_COLOR_PATTERN.test(fill);
}

/** Validates the complete, intentionally tiny inline-SVG grammar admitted for RMT NFT media V1. */
export function isSafeRmtNftInlineSvg(svg: string): boolean {
  if (svg.includes("&") || svg.includes("<!--") || svg.includes("<!") || svg.includes("<?")) return false;
  let cursor = skipWhitespace(svg, 0);
  const root = parseTag(svg, cursor, "svg", ">");
  if (!root || !validSvgAttributes(root.attributes)) return false;
  cursor = root.next;
  let rectCount = 0;
  while (true) {
    cursor = skipWhitespace(svg, cursor);
    if (svg.startsWith("</svg>", cursor)) {
      cursor = skipWhitespace(svg, cursor + "</svg>".length);
      return rectCount > 0 && cursor === svg.length;
    }
    const rect = parseTag(svg, cursor, "rect", "/>");
    if (!rect || !validRectAttributes(rect.attributes)) return false;
    rectCount += 1;
    cursor = rect.next;
  }
}
