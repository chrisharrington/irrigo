import { apiFetch } from '@/api/client';
import type { SystemStateDto } from '@/api/types/system';

export function getSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system');
}

export function enableSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system/enable', { method: 'POST' });
}

export function disableSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system/disable', { method: 'POST' });
}
