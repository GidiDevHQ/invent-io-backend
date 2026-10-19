import { OutboxPublisher } from './outbox.publisher';

function makePublisher(
  pending: { id: string; type: string; payload: unknown; attempts?: number }[],
) {
  const store = pending.map((event) => ({
    ...event,
    attempts: event.attempts ?? 0,
    lastError: null as string | null,
    lockToken: null as string | null,
    lockedUntil: null as Date | null,
  }));
  const add = jest.fn().mockResolvedValue(undefined);
  const update = jest
    .fn()
    .mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const i = store.findIndex((e) => e.id === where.id);
        if (i >= 0) {
          if ('processedAt' in data) {
            store.splice(i, 1);
          } else {
            if (typeof data.attempts === 'object' && data.attempts !== null) {
              store[i].attempts++;
            }
            Object.assign(store[i], {
              ...data,
              attempts:
                typeof data.attempts === 'number'
                  ? data.attempts
                  : store[i].attempts,
            });
          }
        }
        return {};
      },
    );
  const updateMany = jest
    .fn()
    .mockImplementation(
      async ({
        where,
        data,
      }: {
        where: {
          id?: string | { in: string[] };
          attempts?: { lt?: number; gte?: number };
          OR?: unknown[];
        };
        data: Record<string, unknown>;
      }) => {
        const ids = typeof where.id === 'string' ? [where.id] : where.id?.in;
        const records = store.filter((event) => {
          if (ids && !ids.includes(event.id)) return false;
          if (
            where.attempts?.lt !== undefined &&
            event.attempts >= where.attempts.lt
          )
            return false;
          if (
            where.attempts?.gte !== undefined &&
            event.attempts < where.attempts.gte
          )
            return false;
          if (where.OR && event.lockedUntil && event.lockedUntil > new Date())
            return false;
          return true;
        });
        for (const event of records) {
          Object.assign(event, data);
          if (typeof data.attempts === 'number') event.attempts = data.attempts;
        }
        return { count: records.length };
      },
    );
  const prisma = {
    outboxEvent: {
      findMany: jest
        .fn()
        .mockImplementation(
          async ({
            where,
            take,
          }: {
            where: { lockToken?: string };
            take?: number;
          }) => {
            const results = where.lockToken
              ? store.filter((event) => event.lockToken === where.lockToken)
              : store;
            return take === undefined ? results : results.slice(0, take);
          },
        ),
      update,
      updateMany,
    },
  };
  const queue = { add };
  return {
    publisher: new OutboxPublisher(prisma as never, queue as never),
    add,
    update,
    updateMany,
    store,
  };
}

describe('OutboxPublisher', () => {
  it('publishes each pending event with jobId = event id, then marks processed', async () => {
    const { publisher, add, update, updateMany } = makePublisher([
      { id: 'e1', type: 'payment.received', payload: { a: 1 } },
      { id: 'e2', type: 'sale.created', payload: { b: 2 } },
    ]);

    const count = await publisher.publishPending();

    expect(count).toBe(2);
    expect(add).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ id: 'e1' }),
      { jobId: 'e1' },
    );
    expect(add).toHaveBeenCalledWith(
      'sale.created',
      expect.objectContaining({ id: 'e2' }),
      { jobId: 'e2' },
    );
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there is nothing pending (re-run after processing)', async () => {
    const { publisher, add } = makePublisher([]);
    const count = await publisher.publishPending();
    expect(count).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('records failures for retry and releases the claim', async () => {
    const { publisher, add, store } = makePublisher([
      { id: 'e1', type: 'payment.received', payload: {}, attempts: 2 },
    ]);
    add.mockRejectedValueOnce(new Error('queue unavailable'));

    const count = await publisher.publishPending();

    expect(count).toBe(0);
    expect(store[0].attempts).toBe(3);
    expect(store[0].lockToken).toBeNull();
  });

  it('does not publish events another worker claimed first', async () => {
    const { publisher, add, updateMany } = makePublisher([
      { id: 'e1', type: 'payment.received', payload: {} },
    ]);
    updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await publisher.publishPending();

    expect(count).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('allows an operator to re-enable a terminal failure', async () => {
    const { publisher, store } = makePublisher([
      { id: 'e1', type: 'payment.received', payload: {}, attempts: 10 },
    ]);

    await publisher.retryFailedEvent('e1');

    expect(store[0].attempts).toBe(0);
    expect(store[0].lastError).toBeNull();
  });
});
