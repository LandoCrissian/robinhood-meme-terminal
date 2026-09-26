const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

/** Returns only controls that can actually receive focus in the rendered dialog. */
export function dialogFocusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)].filter((element) => {
    const closedDetails = element.closest("details:not([open])");
    if (closedDetails && element.tagName !== "SUMMARY") return false;
    return !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.getClientRects().length > 0;
  });
}
