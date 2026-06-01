/**
 * Returns the device's short timezone abbreviation (e.g. `'MDT'`, `'EST'`) for
 * the given instant. Unlike a named-zone conversion, this works on
 * Hermes-on-Android: the engine returns the abbreviation for *its own* offset,
 * so no IANA tzdata lookup (and no Intl polyfill) is needed. We render it
 * alongside device-local times so the operator knows which clock they're
 * reading. APP-88.
 *
 * Returns the empty string in the unlikely event the runtime omits the
 * `timeZoneName` part — callers render the time without a suffix.
 *
 * @param now - The instant whose offset determines DST (e.g. MDT vs MST).
 *   Defaults to the current time.
 */
export function getDeviceTimezoneAbbreviation(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(now)
        .find(part => part.type === 'timeZoneName')?.value ?? '';
}
