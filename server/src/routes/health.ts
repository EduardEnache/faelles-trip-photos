import type { FastifyInstance } from 'fastify';
import type { HealthDTO } from '@shared/api';
import type { AppCtx } from '../context';
import { toHealthTools } from '../media/tools';

export function registerHealthRoute(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/health', async (): Promise<HealthDTO> => ({
    ok: true,
    version: ctx.config.buildVersion,
    tools: toHealthTools(ctx.tools),
  }));
}
