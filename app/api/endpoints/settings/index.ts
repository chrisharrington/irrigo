import { apiFetch } from '@/api/client';
import type { NotificationSettingsDto, NotificationSettingsPatch } from '@/api/types/settings';

export function getNotificationSettings(): Promise<NotificationSettingsDto> {
    return apiFetch<NotificationSettingsDto>('/settings/notifications');
}

export function patchNotificationSettings(patch: NotificationSettingsPatch): Promise<NotificationSettingsDto> {
    return apiFetch<NotificationSettingsDto>('/settings/notifications', {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
}
