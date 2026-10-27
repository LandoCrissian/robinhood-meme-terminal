import { handleCannaCatSessionRequest } from '../../apps/web/lib/server/cannacat-session-boundary';
import { handleWalletAuth } from '../../apps/web/lib/server/wallet-session';
import { POST as quotes } from '../../apps/web/app/api/vnext/quotes/route';
import { POST as verify } from '../../apps/web/app/api/vnext/verify/route';
import { POST as authorize } from '../../apps/web/app/api/vnext/authorize/route';
import { POST as nativeSettlementTrace } from '../../apps/web/app/api/vnext/native-settlement-trace/route';

export function handle(request: Request, operation: string) {
  if (operation.startsWith('auth-')) return handleWalletAuth(request, operation.slice(5));
  return handleCannaCatSessionRequest(request, operation, { quotes, verify, authorize, 'native-settlement-trace': nativeSettlementTrace });
}
