import { useEffect } from 'react';
import { View } from 'react-native';

import { AlertRow } from '@/components/alert-row';
import { useAlerts } from '@/hooks/alerts';
import type { AlertDto } from '@/api/types/alerts';

/**
 * Props for the persistent alert region.
 */
export type AlertRegionProps = {
    /**
     * Optional. When provided, the region filters to alerts whose
     * `dto.zoneId === zoneId`. Global alerts (`zoneId: null` — e.g.
     * `weather-stale`) are excluded. Omit to surface every active alert
     * (the Home-view case).
     */
    zoneId?: string;

    /**
     * Optional. Reference time used to compute the relative-time label on
     * each row (e.g. `now`, `12m`, `2h`, `3d`). Defaults to the current
     * wall clock; tests inject a fixed value so assertions are stable.
     */
    now?: Date;
};

/**
 * The persistent alert region — surfaces every active failure (or zone-
 * scoped subset) as a vertical stack of `AlertRow`s. Reads `useAlerts()`,
 * which polls /alerts on a 30 s interval. Collapses to `null` when the
 * filtered list is empty so the surrounding layout doesn't reserve space:
 * *loud when present, gone when not*.
 *
 * Pass `zoneId` to scope the region to a single zone (Zone-detail view);
 * omit the prop to show everything on Home.
 */
export function AlertRegion({ zoneId, now }: AlertRegionProps) {
    const { data, isError, error } = useAlerts();

    useEffect(() => {
        if (isError) {
            const detail = error instanceof Error ? error.message : String(error);
            console.warn(`alerts: region failed to load /alerts: ${detail}`);
        }
    }, [isError, error]);

    const filtered = filterAlerts(data ?? [], zoneId);
    if (filtered.length === 0) return null;

    return (
        <View style={{ gap: 10 }}>
            {filtered.map(alert => (
                <AlertRow
                    key={alert.id}
                    tone={alert.tone}
                    title={alert.title}
                    {...(alert.sub !== null ? { sub: alert.sub } : {})}
                    when={formatRelativeTime(alert.when, now)}
                />
            ))}
        </View>
    );
}

function filterAlerts(alerts: readonly AlertDto[], zoneId: string | undefined): AlertDto[] {
    if (zoneId === undefined) return [...alerts];
    return alerts.filter(a => a.zoneId === zoneId);
}

/**
 * Formats an ISO-8601 timestamp into a short relative-age label:
 * `now` (< 60 s or future), `Nm` (< 60 min), `Nh` (< 24 h), `Nd` (≥ 24 h).
 * Exported for testing; the component calls it with the row's `dto.when`.
 */
export function formatRelativeTime(iso: string, reference: Date = new Date()): string {
    const ageMs = reference.getTime() - new Date(iso).getTime();
    if (ageMs < 60_000) return 'now';

    const ageMinutes = Math.floor(ageMs / 60_000);
    if (ageMinutes < 60) return `${ageMinutes}m`;

    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h`;

    const ageDays = Math.floor(ageHours / 24);
    return `${ageDays}d`;
}
