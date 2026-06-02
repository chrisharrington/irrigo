import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { NotificationSettingsRepository, NotificationSettingsRow } from '@/repositories/notification-settings';
import { NOTIFICATION_SETTINGS_DEFAULTS } from '@/models/notification-settings';
import { bootNotificationSettingsService, getNotificationSettings, updateNotificationSettings } from '.';

const ALL_ON: NotificationSettingsRow = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: true,
    wateringEnd: true,
    error: true,
};

function fakeRepo(overrides?: Partial<NotificationSettingsRepository>): NotificationSettingsRepository {
    return {
        findSingleton: async () => null,
        upsertSingleton: async () => {},
        ...overrides,
    };
}

describe('getNotificationSettings', () => {
    it('returns the stored row as the DTO', async () => {
        const row: NotificationSettingsRow = { ...NOTIFICATION_SETTINGS_DEFAULTS, wateringStart: true };
        bootNotificationSettingsService({ repo: fakeRepo({ findSingleton: async () => row }) });

        const result = await getNotificationSettings();

        expect(result).toEqual({
            scheduleStart: true,
            scheduleEnd: true,
            wateringStart: true,
            wateringEnd: false,
            error: true,
        });
    });

    describe('defensive fallback when the row is missing', () => {
        let warnSpy: ReturnType<typeof spyOn>;

        beforeEach(() => {
            warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('returns the defaults and warns', async () => {
            bootNotificationSettingsService({ repo: fakeRepo({ findSingleton: async () => null }) });

            const result = await getNotificationSettings();

            expect(result).toEqual(NOTIFICATION_SETTINGS_DEFAULTS);
            const messages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
            expect(messages.some(m => m.includes('singleton row missing'))).toBe(true);
        });
    });
});

describe('updateNotificationSettings', () => {
    it('merges the partial onto the current row and returns the full DTO', async () => {
        const upsertCalls: NotificationSettingsRow[] = [];
        bootNotificationSettingsService({
            repo: fakeRepo({
                findSingleton: async () => ({ ...ALL_ON }),
                upsertSingleton: async (row) => { upsertCalls.push(row); },
            }),
        });

        const result = await updateNotificationSettings({ wateringStart: false, error: false });

        expect(result).toEqual({
            scheduleStart: true,
            scheduleEnd: true,
            wateringStart: false,
            wateringEnd: true,
            error: false,
        });
        expect(upsertCalls).toEqual([result]);
    });

    it('merges onto the defaults when the row is missing', async () => {
        let warnSpy: ReturnType<typeof spyOn> | null = spyOn(console, 'warn').mockImplementation(() => {});
        bootNotificationSettingsService({ repo: fakeRepo({ findSingleton: async () => null }) });

        const result = await updateNotificationSettings({ scheduleStart: false });

        expect(result).toEqual({ ...NOTIFICATION_SETTINGS_DEFAULTS, scheduleStart: false });
        warnSpy.mockRestore();
        warnSpy = null;
    });

    it('round-trips through a paired repository (get-after-update sees the new state)', async () => {
        let stored: NotificationSettingsRow = { ...NOTIFICATION_SETTINGS_DEFAULTS };
        bootNotificationSettingsService({
            repo: {
                findSingleton: async () => stored,
                upsertSingleton: async (row) => { stored = row; },
            },
        });

        const post = await updateNotificationSettings({ wateringEnd: true });
        const read = await getNotificationSettings();

        expect(post.wateringEnd).toBe(true);
        expect(read).toEqual(post);
    });
});

describe('bootNotificationSettingsService', () => {
    it('accepts a pre-built repo for testing', async () => {
        bootNotificationSettingsService({
            repo: fakeRepo({ findSingleton: async () => ({ ...ALL_ON }) }),
        });

        const result = await getNotificationSettings();

        expect(result.wateringStart).toBe(true);
    });
});
