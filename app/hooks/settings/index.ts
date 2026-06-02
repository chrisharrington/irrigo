import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { getNotificationSettings, patchNotificationSettings } from '@/api/endpoints/settings';
import { keys } from '@/api/query-keys';
import type { NotificationSettingsDto, NotificationSettingsPatch } from '@/api/types/settings';

/**
 * Returns the five notification toggles for the Settings screen.
 */
export function useNotificationSettings(): UseQueryResult<NotificationSettingsDto, ApiError> {
    return useQuery<NotificationSettingsDto, ApiError>({
        queryKey: keys.settings.notifications(),
        queryFn: getNotificationSettings,
    });
}

type OptimisticContext = { previous: NotificationSettingsDto | undefined };

/**
 * PATCHes one or more notification flags. The cache update is optimistic:
 * `onMutate` merges the requested partial into the cached DTO so the tapped
 * toggle flips the moment the user taps. If the server rejects the PATCH,
 * `onError` rolls the cache back to the snapshot. `onSettled` invalidates the
 * notification-settings query for both success and failure paths so the cache
 * reconciles with the authoritative server response.
 */
export function useUpdateNotificationSettings(): UseMutationResult<NotificationSettingsDto, ApiError, NotificationSettingsPatch, OptimisticContext> {
    const queryClient = useQueryClient();
    return useMutation<NotificationSettingsDto, ApiError, NotificationSettingsPatch, OptimisticContext>({
        mutationFn: (patch: NotificationSettingsPatch) => patchNotificationSettings(patch),
        onMutate: async patch => {
            // Cancel any in-flight refetch so it can't resolve after the
            // optimistic write and clobber it with stale server data.
            await queryClient.cancelQueries({ queryKey: keys.settings.notifications() });
            const previous = queryClient.getQueryData<NotificationSettingsDto>(keys.settings.notifications());
            if (previous !== undefined) {
                queryClient.setQueryData<NotificationSettingsDto>(keys.settings.notifications(), {
                    ...previous,
                    ...patch,
                });
            }
            return { previous };
        },
        onError: (_err, _patch, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(keys.settings.notifications(), context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: keys.settings.all() });
        },
    });
}
