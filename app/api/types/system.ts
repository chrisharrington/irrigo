/**
 * Wire-format snapshot of the master irrigation kill switch returned by
 * `GET /system`, `POST /system/enable`, and `POST /system/disable`. `since`
 * is the ISO-8601 UTC instant the system entered its current state.
 */
export type SystemStateDto = {
    irrigationEnabled: boolean;
    since: string;
};
