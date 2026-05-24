import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { closeZone, openZone, runZone } from '@/api/endpoints/zone-control';
import { keys } from '@/api/query-keys';
import type { ZoneCloseResponse, ZoneOpenResponse, ZoneRunResponse } from '@/api/types/zone-control';

function buildZoneInvalidator(queryClient: ReturnType<typeof useQueryClient>) {
    return () => {
        queryClient.invalidateQueries({ queryKey: keys.zones.all() });
        queryClient.invalidateQueries({ queryKey: keys.nextRun.all() });
    };
}

/**
 * Opens a zone's relay via Home Assistant. Backs the manual-fire flow on
 * Zone detail. Invalidates zones (state changed) and the next-run plan
 * (in-flight status changed).
 */
export function useOpenZone(): UseMutationResult<ZoneOpenResponse, ApiError, string> {
    const queryClient = useQueryClient();
    return useMutation<ZoneOpenResponse, ApiError, string>({
        mutationFn: (zoneId: string) => openZone(zoneId),
        onSuccess: buildZoneInvalidator(queryClient),
    });
}

/**
 * Closes a zone's relay. Idempotent at the api layer.
 */
export function useCloseZone(): UseMutationResult<ZoneCloseResponse, ApiError, string> {
    const queryClient = useQueryClient();
    return useMutation<ZoneCloseResponse, ApiError, string>({
        mutationFn: (zoneId: string) => closeZone(zoneId),
        onSuccess: buildZoneInvalidator(queryClient),
    });
}

/**
 * Opens a zone and schedules an automatic close after `durationMin` minutes.
 */
export function useRunZone(): UseMutationResult<ZoneRunResponse, ApiError, { zoneId: string; durationMin: number }> {
    const queryClient = useQueryClient();
    return useMutation<ZoneRunResponse, ApiError, { zoneId: string; durationMin: number }>({
        mutationFn: ({ zoneId, durationMin }) => runZone(zoneId, durationMin),
        onSuccess: buildZoneInvalidator(queryClient),
    });
}
