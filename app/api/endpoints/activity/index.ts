import { apiFetch } from '@/api/client';
import type { ActivityListResult } from '@/api/types/activity';

export type GetActivityParams = {
    zoneId?: string;
    limit?: number;
    cursor?: string;
};

export function getActivity(params: GetActivityParams = {}): Promise<ActivityListResult> {
    const search = new URLSearchParams();
    if (params.zoneId !== undefined) search.set('zoneId', params.zoneId);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.cursor !== undefined) search.set('cursor', params.cursor);
    const qs = search.toString();
    return apiFetch<ActivityListResult>(`/activity${qs ? `?${qs}` : ''}`);
}
