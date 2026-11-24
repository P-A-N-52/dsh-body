import { randomUUID } from 'node:crypto';

export function buildBodyMessage(notification, makeId) {
  return {
    id: makeId(),
    role: 'user',
    content: [{ type: 'text', text: notification.text }],
    source: { kind: 'body-notify' },
  };
}

export function createNotificationPump({ gateway, agentFor, makeId = randomUUID, logger = console }) {
  const delivered = new Set();
  let activeRun = null;

  async function acknowledge(id) {
    try {
      await gateway.ackNotification(id);
      delivered.delete(id);
      return true;
    } catch (error) {
      logger.error?.(`Failed to acknowledge body notification ${id}`, error);
      return false;
    }
  }

  async function runOnce() {
    let notifications;
    try {
      notifications = gateway.getNotifications();
    } catch (error) {
      logger.error?.('Failed to read body notifications', error);
      return [];
    }

    const results = [];
    for (const notification of notifications) {
      const { id, sessionId } = notification;

      if (delivered.has(id)) {
        results.push({ id, status: (await acknowledge(id)) ? 'delivered' : 'failed' });
        continue;
      }

      try {
        const agent = agentFor(sessionId);
        if (!agent) {
          results.push({ id, status: 'waiting' });
          continue;
        }
        const message = buildBodyMessage(notification, makeId);
        if (notification.mode === 'wake') await agent.followup(message);
        else await agent.inject(message);
      } catch (error) {
        logger.error?.(`Failed to deliver body notification ${id} to session ${sessionId}`, error);
        results.push({ id, status: 'failed' });
        continue;
      }

      delivered.add(id);
      results.push({ id, status: (await acknowledge(id)) ? 'delivered' : 'failed' });
    }
    return results;
  }

  function run() {
    if (activeRun) return activeRun;
    activeRun = runOnce().finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  return { run };
}
