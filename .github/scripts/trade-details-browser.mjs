// User-facing terms stay at Level 1. Tests of full payload/fee evidence deliberately
// expand Level 2 instead of requiring the technical dossier on every ticket.
export async function openExecutionEvidence(page) {
  const details = page.locator('.vnRouteCard');
  if (!await details.count() || !await details.evaluate(node => node.open)) return;
  const evidence = page.locator('.vnExecutionEvidence');
  if (await evidence.count() && !await evidence.evaluate(node => node.open)) {
    await evidence.locator(':scope > summary').click();
  }
}
