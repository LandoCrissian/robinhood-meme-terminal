export const RETIRED_TRANSACTION_PREPARATION_MESSAGE =
  "Legacy transaction preparation is retired. RMT execution will be available through the verified V2 Terminal path.";

export const RETIRED_TRANSACTION_PREPARATION_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
} as const;

export function retiredTransactionPreparationResponse() {
  return Response.json(
    { error: RETIRED_TRANSACTION_PREPARATION_MESSAGE },
    { status: 410, headers: RETIRED_TRANSACTION_PREPARATION_HEADERS }
  );
}
