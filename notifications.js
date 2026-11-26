import { randomUUID } from 'node:crypto';

const maxTrackedReceiptMessages = 500;

export function buildBodyMessage(notification, makeId) {
  return {
    id: makeId(),
    role: 'user',
    content: [{ type: 'text', text: notification.text }],
    source: { kind: 'body-notify' },
  };
}

export function createNotificationPump({
  gateway,
  agentFor,
  makeId = randomUUID,
  now = Date.now,
  logger = console,
}) {
  const delivered = new Map();
  const inFlightMessages = new Map();
  const insertedTimestamps = new Map();
  const ackedMessages = new Map();
  let activeRun = null;

  function rememberAckedMessage(messageId, notificationId) {
    if (ackedMessages.has(messageId)) ackedMessages.delete(messageId);
    ackedMessages.set(messageId, notificationId);
    while (ackedMessages.size > maxTrackedReceiptMessages) {
      const oldest = ackedMessages.keys().next().value;
      ackedMessages.delete(oldest);
    }
  }

  function rememberInsertedTimestamp(messageId, timestamp) {
    if (insertedTimestamps.has(messageId)) insertedTimestamps.delete(messageId);
    insertedTimestamps.set(messageId, timestamp);
    while (insertedTimestamps.size > maxTrackedReceiptMessages) {
      const oldest = insertedTimestamps.keys().next().value;
      insertedTimestamps.delete(oldest);
    }
  }

  async function acknowledge(id) {
    const messageId = delivered.get(id) ?? null;
    const insertedAtWallTimeMs = messageId ? (insertedTimestamps.get(messageId) ?? null) : null;
    const meta = {
      ...(messageId ? { messageId } : {}),
      ...(insertedAtWallTimeMs !== null ? { insertedAtWallTimeMs } : {}),
    };
    try {
      if (Object.keys(meta).length > 0) await gateway.ackNotification(id, meta);
      else await gateway.ackNotification(id);
      delivered.delete(id);
      if (messageId) {
        inFlightMessages.delete(messageId);
        insertedTimestamps.delete(messageId);
        rememberAckedMessage(messageId, id);
      }
      return true;
    } catch (error) {
      logger.error?.(`Failed to acknowledge body notification ${id}`, error);
      return false;
    }
  }

  function handleInboxInserted(payload) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? payload.message
      : payload;
    if (!message || typeof message !== 'object' || typeof message.id !== 'string' || !message.id) {
      return { matched: false };
    }
    const isBodyNotify = message.source?.kind === 'body-notify';
    const knownNotificationId = inFlightMessages.get(message.id) ?? ackedMessages.get(message.id) ?? null;
    if (!isBodyNotify && !knownNotificationId) {
      return { matched: false };
    }

    const insertedAtWallTimeMs = now();
    if (inFlightMessages.has(message.id)) {
      rememberInsertedTimestamp(message.id, insertedAtWallTimeMs);
      return {
        matched: true,
        pendingAck: true,
        messageId: message.id,
        notificationId: knownNotificationId,
        insertedAtWallTimeMs,
      };
    }

    if (typeof gateway.confirmNotificationInserted === 'function') {
      return gateway.confirmNotificationInserted({
        messageId: message.id,
        notificationId: knownNotificationId,
        insertedAtWallTimeMs,
      });
    }

    return {
      matched: Boolean(knownNotificationId),
      messageId: message.id,
      notificationId: knownNotificationId,
      insertedAtWallTimeMs,
    };
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

      let message;
      try {
        const agent = agentFor(sessionId);
        if (!agent) {
          results.push({ id, status: 'waiting' });
          continue;
        }
        message = buildBodyMessage(notification, makeId);
        inFlightMessages.set(message.id, id);
        if (notification.mode === 'wake') await agent.followup(message);
        else await agent.inject(message);
      } catch (error) {
        if (message?.id) {
          inFlightMessages.delete(message.id);
          insertedTimestamps.delete(message.id);
        }
        logger.error?.(`Failed to deliver body notification ${id} to session ${sessionId}`, error);
        results.push({ id, status: 'failed' });
        continue;
      }

      delivered.set(id, message.id);
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

  return { run, handleInboxInserted };
}
