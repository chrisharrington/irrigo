import { apiFetch } from '@/api/client';
import type { PushRegistration } from '@/api/types/push-registration';

export function registerPushToken(input: PushRegistration): Promise<void> {
    return apiFetch<void>('/push/register', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function unregisterPushToken(token: string): Promise<void> {
    return apiFetch<void>('/push/unregister', {
        method: 'POST',
        body: JSON.stringify({ token }),
    });
}
