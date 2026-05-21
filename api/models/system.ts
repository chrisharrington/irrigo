/**
 * Wire-format snapshot of the master irrigation kill switch. Served by
 * `GET /system`, also used by the daemon's kill-switch gates and the manual
 * controller's `isIrrigationEnabled` predicate.
 *
 * `since` is the ISO-8601 UTC instant the system entered its current state
 * — bumped on every flip — so the mobile UI can render "off since 2:34 PM"
 * labels without parsing a Date.
 */
export type SystemStateDto = {
    irrigationEnabled: boolean;
    since: string;
};
