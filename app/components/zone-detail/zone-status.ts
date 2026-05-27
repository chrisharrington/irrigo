import type { ZoneSummary } from '@/api/types/zones';
import type { NextRunDto } from '@/api/types/next-run';
import { computeBatteryGeometry } from '@/components/battery';

const BASE_COPY = {
    ok: 'Within tolerance',
    warn: 'Approaching RAW',
    danger: 'Past RAW',
} as const;

/**
 * Composes the tone-status line shown under the zone name on the Zone
 * detail screen. The base phrase comes from the same battery-tone bucket
 * the hero uses (`ok` / `warn` / `danger`); when `nextRun` reports cycles
 * for this zone, the helper appends ` · next run at HH:MM` using the first
 * cycle's site-local start time.
 *
 * @param zone - Zone summary providing depletion + RAW.
 * @param nextRun - Optional next-run DTO. When `undefined` (loading or
 *   unavailable) or when the zone has no cycles, the qualifier is omitted.
 * @returns The composed copy ready to render in a single `<Text>` element.
 */
export function computeZoneStatusCopy(zone: ZoneSummary, nextRun: NextRunDto | undefined): string {
    const { tone } = computeBatteryGeometry(zone.currentDepletionMm, zone.rawMm);
    const base = BASE_COPY[tone];
    const cycleStart = nextRun?.zones.find(z => z.slug === zone.slug)?.cycles[0]?.start;
    if (cycleStart === undefined) return base;
    return `${base} · next run at ${cycleStart}`;
}
