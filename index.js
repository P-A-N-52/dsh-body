import { join } from 'node:path';
import { startGateway } from './gateway.js';

export const name = 'dsh-body';
export const inject = ['profileContext'];

export async function apply(ctx, { manifestPath, statePath, port } = {}) {
  const { home } = ctx.get('profileContext');
  const resolvedPort = port === undefined || port === '' ? undefined : Number(port);
  const gateway = startGateway({
    manifestPath,
    statePath: statePath ?? join(home, 'dsh-body', 'body-state.json'),
    port: resolvedPort,
  });
  ctx.effect(() => gateway.stop);
  await gateway.ready;
}
