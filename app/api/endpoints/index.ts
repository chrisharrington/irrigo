/**
 * Typed wrappers over the Irrigo api routes. Each function targets exactly
 * one route, takes only the inputs the route requires, and returns the
 * "useful" DTO — server reply envelopes like `{ zones: ZoneSummary[] }` or
 * `{ status: 'open', since: ... }` are unwrapped here so consumers see the
 * inner data directly.
 *
 * Hooks in `app/hooks/*` call these via `useQuery` / `useMutation` and apply
 * the appropriate cache invalidations.
 */
import { apiFetch } from '@/api/client';
import type {
    ActivityListResult,
    AckResult,
    AlertDto,
    PushRegistration,
    ReplanResponse,
    ScheduleListItem,
    ScheduleMutationResponse,
    SystemStateDto,
    TonightDto,
    ZoneCloseResponse,
    ZoneOpenResponse,
    ZoneRunResponse,
    ZoneSummary,
} from '@/api/types';

/* ----- system --------------------------------------------------------- */

export function getSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system');
}

export function enableSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system/enable', { method: 'POST' });
}

export function disableSystem(): Promise<SystemStateDto> {
    return apiFetch<SystemStateDto>('/system/disable', { method: 'POST' });
}

/* ----- zones ---------------------------------------------------------- */

export async function getZones(): Promise<ZoneSummary[]> {
    const body = await apiFetch<{ zones: ZoneSummary[] }>('/zones');
    return body.zones;
}

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

/* ----- tonight -------------------------------------------------------- */

export function getTonight(): Promise<TonightDto> {
    return apiFetch<TonightDto>('/tonight');
}

/* ----- schedules ------------------------------------------------------ */

export function getSchedules(): Promise<ScheduleListItem[]> {
    return apiFetch<ScheduleListItem[]>('/schedules');
}

export function enableSchedule(slug: string): Promise<ScheduleMutationResponse> {
    return apiFetch<ScheduleMutationResponse>(`/schedule/enable/${encodeURIComponent(slug)}`, { method: 'POST' });
}

export function disableSchedule(slug: string): Promise<ScheduleMutationResponse> {
    return apiFetch<ScheduleMutationResponse>(`/schedule/disable/${encodeURIComponent(slug)}`, { method: 'POST' });
}

export function skipScheduleTonight(): Promise<ScheduleMutationResponse> {
    return apiFetch<ScheduleMutationResponse>('/schedule/skip-tonight', { method: 'POST' });
}

export function resumeScheduleTonight(): Promise<ScheduleMutationResponse> {
    return apiFetch<ScheduleMutationResponse>('/schedule/resume-tonight', { method: 'POST' });
}

/* ----- alerts --------------------------------------------------------- */

export async function getAlerts(): Promise<AlertDto[]> {
    const body = await apiFetch<{ alerts: AlertDto[] }>('/alerts');
    return body.alerts;
}

export async function ackAlert(alertId: string): Promise<AckResult> {
    const body = await apiFetch<{ status: AckResult }>(`/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: 'POST',
    });
    return body.status;
}

/* ----- activity ------------------------------------------------------- */

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

/* ----- replan --------------------------------------------------------- */

export function replan(): Promise<ReplanResponse> {
    return apiFetch<ReplanResponse>('/replan', { method: 'POST' });
}

/* ----- push registration --------------------------------------------- */

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
