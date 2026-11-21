import { join } from 'node:path';
import { startGateway } from './gateway.js';
import { createNotificationPump } from './notifications.js';
import { registerBodyTools } from './tools.js';

export const name = 'dsh-body';
export const inject = ['profileContext', 'tools', 'agents'];

const notificationIntervalMs = 1000;

function reportDeliveryError(error) {
  console.error('Failed to deliver body notifications', error);
}

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

  registerBodyTools(ctx, gateway);

  const agents = ctx.get('agents');
  const pump = createNotificationPump({
    gateway,
    agentFor: (sessionId) => agents.get(sessionId),
  });
  const timer = setInterval(() => {
    pump.run().catch(reportDeliveryError);
  }, notificationIntervalMs);
  timer.unref?.();
  ctx.effect(() => () => clearInterval(timer));

  await pump.run().catch(reportDeliveryError);
}
