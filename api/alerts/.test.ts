import { describe, it, expect } from 'bun:test';
import { alerts } from '@/db/schema';
import {
    acknowledgeAlert,
    clearAlertsByClass,
    createAlertRecorder,
    listActiveAlerts,
    noopAlertRecorder,
    type AlertEvent,
    type AlertsDb,
} from '.';

type AlertRow = typeof alerts.$inferSelect;

const NOW = new Date('2026-05-20T12:00:00.000Z');

function buildRow(overrides?: Partial<AlertRow>): AlertRow {
    return {
        id: 'alert-001',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'HA close failed',
        sub: 'North · ECONNREFUSED',
        whenAt: NOW,
        zoneId: 'zone-001',
        ack: false,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

type RecorderCalls = {
    selects: Array<{ table: unknown; cond: unknown; limit: number }>;
    inserts: Array<{ table: unknown; values: Record<string, unknown> }>;
    updates: Array<{ table: unknown; set: Record<string, unknown>; cond: unknown }>;
};

function createRecorderStub(existingMatches: ReadonlyArray<{ id: string }>): {
    db: AlertsDb;
    calls: RecorderCalls;
} {
    const calls: RecorderCalls = { selects: [], inserts: [], updates: [] };

    const db: AlertsDb = {
        select: (..._args) => ({
            from: (table: unknown) => ({
                where: (cond: unknown) => ({
                    limit: (n: number) => {
                        calls.selects.push({ table, cond, limit: n });
                        return Promise.resolve(existingMatches);
                    },
                }),
            }),
        }) as unknown as ReturnType<AlertsDb['select']>,
        insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => {
                calls.inserts.push({ table, values });
                return Promise.resolve(undefined);
            },
        }) as unknown as ReturnType<AlertsDb['insert']>,
        update: (table: unknown) => ({
            set: (set: Record<string, unknown>) => ({
                where: (cond: unknown) => {
                    calls.updates.push({ table, set, cond });
                    return Promise.resolve(undefined);
                },
            }),
        }) as unknown as ReturnType<AlertsDb['update']>,
    };

    return { db, calls };
}

describe('noopAlertRecorder', () => {
    it('resolves without doing anything', async () => {
        await expect(noopAlertRecorder({ class: 'ha-call-failed', tone: 'danger', title: 'x' })).resolves.toBeUndefined();
    });
});

describe('createAlertRecorder', () => {
    function event(overrides?: Partial<AlertEvent>): AlertEvent {
        return {
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            zoneId: 'zone-001',
            ...overrides,
        };
    }

    it('inserts a new row when no matching unacked alert exists', async () => {
        const { db, calls } = createRecorderStub([]);

        await createAlertRecorder(db)(event());

        expect(calls.inserts).toHaveLength(1);
        expect(calls.inserts[0]!.values).toMatchObject({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            zoneId: 'zone-001',
        });
        expect(calls.updates).toHaveLength(0);
    });

    it('coerces an undefined sub to null on insert', async () => {
        const { db, calls } = createRecorderStub([]);

        await createAlertRecorder(db)(event({ sub: undefined }));

        expect(calls.inserts[0]!.values['sub']).toBeNull();
    });

    it('coerces an undefined zoneId to null on insert (global alert)', async () => {
        const { db, calls } = createRecorderStub([]);

        await createAlertRecorder(db)(event({ zoneId: undefined }));

        expect(calls.inserts[0]!.values['zoneId']).toBeNull();
    });

    it('updates the existing row when a matching unacked alert is found', async () => {
        const { db, calls } = createRecorderStub([{ id: 'existing-001' }]);

        await createAlertRecorder(db)(event({ title: 'HA close failed (retry exhausted)' }));

        expect(calls.inserts).toHaveLength(0);
        expect(calls.updates).toHaveLength(1);
        expect(calls.updates[0]!.set).toMatchObject({
            title: 'HA close failed (retry exhausted)',
            sub: 'North · ECONNREFUSED',
            tone: 'danger',
        });
        // whenAt is set via sql`now()` — assert the key is present without
        // depending on Drizzle's internal SQL representation.
        expect('whenAt' in calls.updates[0]!.set).toBe(true);
    });

    it('issues exactly one SELECT per recorded event', async () => {
        const { db, calls } = createRecorderStub([]);

        await createAlertRecorder(db)(event());
        await createAlertRecorder(db)(event());

        expect(calls.selects).toHaveLength(2);
    });
});

type ReaderCalls = {
    selects: number;
    where: Array<unknown>;
    orderBy: Array<ReadonlyArray<unknown>>;
};

function createReaderStub(rows: AlertRow[]): { db: AlertsDb; calls: ReaderCalls } {
    const calls: ReaderCalls = { selects: 0, where: [], orderBy: [] };

    const db: AlertsDb = {
        select: (..._args) => {
            calls.selects += 1;
            return {
                from: (_table: unknown) => ({
                    where: (cond: unknown) => {
                        calls.where.push(cond);
                        return {
                            orderBy: (...exprs: unknown[]) => {
                                calls.orderBy.push(exprs);
                                return Promise.resolve(rows);
                            },
                            limit: (_n: number) => Promise.resolve(rows.map(r => ({ id: r.id }))),
                        };
                    },
                }),
            } as unknown as ReturnType<AlertsDb['select']>;
        },
        insert: (..._args) => ({ values: async () => undefined }) as unknown as ReturnType<AlertsDb['insert']>,
        update: (..._args) => ({
            set: () => ({ where: async () => undefined }),
        }) as unknown as ReturnType<AlertsDb['update']>,
    };

    return { db, calls };
}

describe('listActiveAlerts', () => {
    it('maps every row to its DTO and preserves the input order', async () => {
        const a = buildRow({ id: 'a', whenAt: new Date('2026-05-20T13:00:00.000Z') });
        const b = buildRow({ id: 'b', whenAt: new Date('2026-05-20T11:00:00.000Z'), class: 'weather-stale', tone: 'warn', title: 'Weather API stale', sub: null, zoneId: null });
        const { db } = createReaderStub([a, b]);

        const result = await listActiveAlerts(db);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            id: 'a',
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            when: '2026-05-20T13:00:00.000Z',
            zoneId: 'zone-001',
            ack: false,
        });
        expect(result[1]).toEqual({
            id: 'b',
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            when: '2026-05-20T11:00:00.000Z',
            zoneId: null,
            ack: false,
        });
    });

    it('returns an empty array when there are no unacked alerts', async () => {
        const { db } = createReaderStub([]);

        const result = await listActiveAlerts(db);

        expect(result).toEqual([]);
    });

    it('issues a single select with a where and an orderBy', async () => {
        const { db, calls } = createReaderStub([]);

        await listActiveAlerts(db);

        expect(calls.selects).toBe(1);
        expect(calls.where).toHaveLength(1);
        expect(calls.orderBy).toHaveLength(1);
        // orderBy receives the descending-whenAt expression.
        expect(calls.orderBy[0]).toHaveLength(1);
    });
});

type AckCalls = {
    updateReturning: Array<{ set: Record<string, unknown>; cond: unknown }>;
    selectExisting: Array<{ cond: unknown }>;
};

function createAckStub(opts: {
    updatedIds: ReadonlyArray<string>;
    existingIds: ReadonlyArray<string>;
}): { db: AlertsDb; calls: AckCalls } {
    const calls: AckCalls = { updateReturning: [], selectExisting: [] };

    const db: AlertsDb = {
        update: (_table: unknown) => ({
            set: (set: Record<string, unknown>) => ({
                where: (cond: unknown) => ({
                    returning: (_cols: unknown) => {
                        calls.updateReturning.push({ set, cond });
                        return Promise.resolve(opts.updatedIds.map(id => ({ id })));
                    },
                    then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
                }),
            }),
        }) as unknown as ReturnType<AlertsDb['update']>,
        select: (..._args) => ({
            from: (_table: unknown) => ({
                where: (cond: unknown) => ({
                    limit: (_n: number) => {
                        calls.selectExisting.push({ cond });
                        return Promise.resolve(opts.existingIds.map(id => ({ id })));
                    },
                }),
            }),
        }) as unknown as ReturnType<AlertsDb['select']>,
        insert: (..._args) => ({ values: async () => undefined }) as unknown as ReturnType<AlertsDb['insert']>,
    };

    return { db, calls };
}

describe('acknowledgeAlert', () => {
    it('returns "acked" when the row went from unacked to acked', async () => {
        const { db, calls } = createAckStub({ updatedIds: ['alert-001'], existingIds: [] });

        const result = await acknowledgeAlert(db, 'alert-001');

        expect(result).toBe('acked');
        expect(calls.updateReturning).toHaveLength(1);
        expect(calls.updateReturning[0]!.set).toEqual({ ack: true });
        // No fallback select needed when the update returned a row.
        expect(calls.selectExisting).toHaveLength(0);
    });

    it('returns "already-acked" when the row exists but was already acked', async () => {
        const { db, calls } = createAckStub({ updatedIds: [], existingIds: ['alert-001'] });

        const result = await acknowledgeAlert(db, 'alert-001');

        expect(result).toBe('already-acked');
        expect(calls.selectExisting).toHaveLength(1);
    });

    it('returns "not-found" when no row matches the id', async () => {
        const { db } = createAckStub({ updatedIds: [], existingIds: [] });

        const result = await acknowledgeAlert(db, 'alert-missing');

        expect(result).toBe('not-found');
    });
});

describe('clearAlertsByClass', () => {
    it('issues an update against the alerts table setting ack=true', async () => {
        const updates: Array<{ set: Record<string, unknown>; cond: unknown }> = [];
        const db: AlertsDb = {
            update: (_table: unknown) => ({
                set: (set: Record<string, unknown>) => ({
                    where: (cond: unknown) => {
                        updates.push({ set, cond });
                        return Promise.resolve(undefined);
                    },
                }),
            }) as unknown as ReturnType<AlertsDb['update']>,
            select: (..._args) => ({}) as unknown as ReturnType<AlertsDb['select']>,
            insert: (..._args) => ({}) as unknown as ReturnType<AlertsDb['insert']>,
        };

        await clearAlertsByClass(db, 'weather-stale');

        expect(updates).toHaveLength(1);
        expect(updates[0]!.set).toEqual({ ack: true });
    });

    it('is idempotent when no unacked rows of the class exist (update no-ops)', async () => {
        const db: AlertsDb = {
            update: (_table: unknown) => ({
                set: () => ({ where: () => Promise.resolve(undefined) }),
            }) as unknown as ReturnType<AlertsDb['update']>,
            select: (..._args) => ({}) as unknown as ReturnType<AlertsDb['select']>,
            insert: (..._args) => ({}) as unknown as ReturnType<AlertsDb['insert']>,
        };

        await expect(clearAlertsByClass(db, 'weather-stale')).resolves.toBeUndefined();
    });
});
