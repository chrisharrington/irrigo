import { apiFetch } from '@/api/client';
import type { ZoneCloseResponse, ZoneOpenResponse, ZoneRunResponse } from '@/api/types/zone-control';

export function openZone(zoneId: string): Promise<ZoneOpenResponse> {
    return apiFetch<ZoneOpenResponse>(`/zones/${encodeURIComponent(zoneId)}/open`, { method: 'POST' });
}

export function closeZone(zoneId: string): Promise<ZoneCloseResponse> {
    return apiFetch<ZoneCloseResponse>(`/zones/${encodeURIComponent(zoneId)}/close`, { method: 'POST' });
}

export function runZone(zoneId: string, durationMin: number): Promise<ZoneRunResponse> {
    return apiFetch<ZoneRunResponse>(`/zones/${encodeURIComponent(zoneId)}/run`, {
        method: 'POST',
        body: JSON.stringify({ durationMin }),
    });
}
