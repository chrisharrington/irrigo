import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import {
    disableSchedule,
    enableSchedule,
    getSchedules,
    resumeScheduleTonight,
    skipScheduleTonight,
} from '@/api/endpoints';
import { keys } from '@/api/query-keys';
import type { ScheduleListItem, ScheduleMutationResponse } from '@/api/types';

/**
 * Returns the list of every schedule for the Schedules screen, drawer
 * footer, and the active-schedule chip on Home. The active row carries
 * `nextRun` and `skippedTonight`.
 */
export function useSchedules(): UseQueryResult<ScheduleListItem[], ApiError> {
    return useQuery<ScheduleListItem[], ApiError>({
        queryKey: keys.schedules.list(),
        queryFn: getSchedules,
    });
}

function buildScheduleInvalidator(queryClient: ReturnType<typeof useQueryClient>) {
    return () => {
        queryClient.invalidateQueries({ queryKey: keys.schedules.all() });
        queryClient.invalidateQueries({ queryKey: keys.tonight.all() });
        queryClient.invalidateQueries({ queryKey: keys.zones.all() });
    };
}

/**
 * Activates the named schedule. The api atomically deactivates any
 * currently-active schedule on the same site and triggers a re-plan, so
 * this invalidates schedules, tonight, and zones.
 */
export function useEnableSchedule(): UseMutationResult<ScheduleMutationResponse, ApiError, string> {
    const queryClient = useQueryClient();
    return useMutation<ScheduleMutationResponse, ApiError, string>({
        mutationFn: (slug: string) => enableSchedule(slug),
        onSuccess: buildScheduleInvalidator(queryClient),
    });
}

/**
 * Deactivates the named schedule. Triggers a re-plan, so invalidates the
 * same set as `useEnableSchedule`.
 */
export function useDisableSchedule(): UseMutationResult<ScheduleMutationResponse, ApiError, string> {
    const queryClient = useQueryClient();
    return useMutation<ScheduleMutationResponse, ApiError, string>({
        mutationFn: (slug: string) => disableSchedule(slug),
        onSuccess: buildScheduleInvalidator(queryClient),
    });
}

/**
 * Sets the active schedule's one-night skip marker for tonight.
 */
export function useSkipScheduleTonight(): UseMutationResult<ScheduleMutationResponse, ApiError, void> {
    const queryClient = useQueryClient();
    return useMutation<ScheduleMutationResponse, ApiError, void>({
        mutationFn: () => skipScheduleTonight(),
        onSuccess: buildScheduleInvalidator(queryClient),
    });
}

/**
 * Clears the active schedule's skip-tonight marker.
 */
export function useResumeScheduleTonight(): UseMutationResult<ScheduleMutationResponse, ApiError, void> {
    const queryClient = useQueryClient();
    return useMutation<ScheduleMutationResponse, ApiError, void>({
        mutationFn: () => resumeScheduleTonight(),
        onSuccess: buildScheduleInvalidator(queryClient),
    });
}
