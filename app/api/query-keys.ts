/**
 * Hierarchical query key factory. Hooks use these instead of inline arrays
 * so the cache invalidation API stays type-safe and refactor-friendly.
 *
 * Pattern: `keys.<resource>.<view>(args?)` returns a readonly tuple that
 * starts with the resource name — this means `queryClient.invalidateQueries
 * ({ queryKey: keys.zones.all() })` invalidates every zone view.
 */

export const keys = {
    system: {
        all: () => ['system'] as const,
        state: () => ['system', 'state'] as const,
    },
    zones: {
        all: () => ['zones'] as const,
        list: () => ['zones', 'list'] as const,
    },
    nextRun: {
        all: () => ['next-run'] as const,
        summary: () => ['next-run', 'summary'] as const,
    },
    schedules: {
        all: () => ['schedules'] as const,
        list: () => ['schedules', 'list'] as const,
    },
    alerts: {
        all: () => ['alerts'] as const,
        list: () => ['alerts', 'list'] as const,
    },
    activity: {
        all: () => ['activity'] as const,
        list: (params: { zoneId?: string }) => ['activity', 'list', params] as const,
    },
    health: {
        all: () => ['health'] as const,
        status: () => ['health', 'status'] as const,
    },
    settings: {
        all: () => ['settings'] as const,
        notifications: () => ['settings', 'notifications'] as const,
    },
} as const;
