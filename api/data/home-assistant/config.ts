export type SwitchService = 'turn_on' | 'turn_off';

type HomeAssistantConfig = {
    url: string;
    token: string;
};

type RetryConfig = {
    maxAttempts: number;
    baseMs: number;
};

const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MS = 1000;

export function readConfig(): HomeAssistantConfig {
    const url = process.env.HA_URL;
    const token = process.env.HA_TOKEN;
    if (!url) throw new Error('home-assistant: HA_URL environment variable is required.');
    if (!token) throw new Error('home-assistant: HA_TOKEN environment variable is required.');
    return { url, token };
}

export function readRetryConfig(): RetryConfig {
    return {
        maxAttempts: parsePositiveInt(process.env.HA_RETRY_MAX, DEFAULT_RETRY_MAX),
        baseMs: parseNonNegativeInt(process.env.HA_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
    };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
