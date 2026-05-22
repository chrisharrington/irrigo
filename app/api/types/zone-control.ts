/**
 * Reply shapes for the manual zone-control endpoints. `since` and
 * `willCloseAt` are ISO-8601 UTC instants.
 */

export type ZoneOpenResponse = { status: 'open'; since: string };

export type ZoneCloseResponse = { status: 'closed' };

export type ZoneRunResponse = { status: 'open'; since: string; willCloseAt: string };
