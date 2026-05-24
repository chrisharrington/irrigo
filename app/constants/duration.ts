/**
 * Shared duration constants for time math. Centralised so that the cycle
 * strip's minute-of-day calculations, the relative-time formatters, and
 * any future timer / animation helpers all use the same values.
 */

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Milliseconds in one day. */
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Minutes in one hour. */
export const MINUTES_PER_HOUR = 60;

/** Minutes in one day. */
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
