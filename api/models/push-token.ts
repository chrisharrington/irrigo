/**
 * Operator device platforms registered for Expo Push. The push_tokens table's
 * check constraint mirrors this union — widening here requires a migration.
 */
export type PushPlatform = 'ios' | 'android';

/**
 * Wire shape accepted by `POST /push/register`. `userAgent` is opaque
 * diagnostic context — the server stores it verbatim and never parses it.
 * `null` is the normalised form for "device sent no userAgent."
 */
export type PushRegistration = {
    token: string;
    platform: PushPlatform;
    userAgent: string | null;
};

/**
 * Alert classes that can trigger a push. Mirrors `AlertClass` from `@/alerts`
 * — duplicated as a literal union here to avoid a circular import between
 * `@/alerts` and `@/service/push-tokens` (the dispatcher lives in the push
 * service, which is itself wired into the alerter).
 */
export type PushAlertClass = 'weather-stale' | 'ha-call-failed' | 'missed-close' | 'actuation-stale';

/**
 * Visual severity carried alongside the push. `danger` maps to Expo
 * `priority: 'high'` so iOS / Android surface the notification immediately;
 * `warn` uses the default priority.
 */
export type PushAlertTone = 'warn' | 'danger';

/**
 * Payload the alerter hands to the push dispatcher on insert of a new alert.
 * All fields normalise to non-undefined (nullable strings instead of optional
 * keys) so the dispatcher doesn't need to discriminate "missing" vs "null."
 */
export type PushAlertEvent = {
    alertId: string;
    class: PushAlertClass;
    tone: PushAlertTone;
    title: string;
    sub: string | null;
    zoneId: string | null;
};

/**
 * The closure shape that the alerter calls after persisting a brand-new
 * alert. Implementations are expected to be best-effort — they should swallow
 * their own errors so the alert write isn't disrupted by transport failures.
 */
export type PushDispatcher = (event: PushAlertEvent) => Promise<void>;
