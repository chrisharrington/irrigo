import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { registerPushToken, unregisterPushToken } from '@/api/endpoints';
import type { PushRegistration } from '@/api/types';

/**
 * Registers (or refreshes) the device's Expo push token. No invalidations
 * — the api doesn't expose a "registered tokens" query, so the local cache
 * has nothing to revalidate after a successful call.
 */
export function useRegisterPushToken(): UseMutationResult<void, ApiError, PushRegistration> {
    return useMutation<void, ApiError, PushRegistration>({
        mutationFn: (input: PushRegistration) => registerPushToken(input),
    });
}

/**
 * Removes the device's Expo push token. Idempotent at the api layer.
 */
export function useUnregisterPushToken(): UseMutationResult<void, ApiError, string> {
    return useMutation<void, ApiError, string>({
        mutationFn: (token: string) => unregisterPushToken(token),
    });
}
