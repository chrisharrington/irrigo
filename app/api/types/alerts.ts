export type AlertClass = 'weather-stale' | 'ha-call-failed' | 'missed-close';

export type AlertTone = 'warn' | 'danger';

/**
 * Wire shape served by `GET /alerts`. The api wraps the array in
 * `{ alerts: AlertDto[] }` — the endpoint wrapper unwraps for consumers.
 * `when` is ISO-8601 UTC.
 */
export type AlertDto = {
    id: string;
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub: string | null;
    when: string;
    zoneId: string | null;
    ack: boolean;
};

/** Outcome of `POST /alerts/:id/ack`. */
export type AckResult = 'acked' | 'already-acked';
