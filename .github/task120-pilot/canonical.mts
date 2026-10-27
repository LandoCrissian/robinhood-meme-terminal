import { handleCannaCatEmbedRequest } from '../../apps/web/lib/server/cannacat-embed-boundary';
import { POST as quotes } from '../../apps/web/app/api/vnext/quotes/route';
import { POST as verify } from '../../apps/web/app/api/vnext/verify/route';
import { POST as authorize } from '../../apps/web/app/api/vnext/authorize/route';
import { POST as nativeSettlementTrace } from '../../apps/web/app/api/vnext/native-settlement-trace/route';

export function handle(request: Request, operation: string) {
  return handleCannaCatEmbedRequest(request, operation, {
    handlers: { quotes, verify, authorize, 'native-settlement-trace': nativeSettlementTrace },
  });
}
