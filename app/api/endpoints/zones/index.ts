import { apiFetch } from '@/api/client';
import type { ZoneSummary } from '@/api/types/zones';

export async function getZones(): Promise<ZoneSummary[]> {
    const body = await apiFetch<{ zones: ZoneSummary[] }>('/zones');
    return body.zones;
}
