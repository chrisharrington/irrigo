import { apiFetch } from '@/api/client';
import type { ScheduleListItem, ScheduleMutationResponse } from '@/api/types/schedules';

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
