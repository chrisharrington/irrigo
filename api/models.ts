import type dayjs from 'dayjs';

export type DailyWeather = {
    /** Required. The date of the weather record. */
    date: dayjs.Dayjs;

    /** Optional. The reference evapotranspiration. */
    evapotranspirationMmPerDay?: number;

    /** Optional. The total daily precipitation (rain + showers + snow water-equivalent), per Open-Meteo's `precipitation_sum`. */
    rainfallMm?: number;

    /** Optional. The local sunrise time as Dayjs object. */
    sunrise?: dayjs.Dayjs;

    /** Optional. The local sunset time as Dayjs object. */
    sunset?: dayjs.Dayjs;
}

/**
 * One hour of observed/forecast weather. Open-Meteo emits one row per hour
 * over the requested past + forecast window. `time` is the start instant of
 * the hour, anchored to the requested timezone. The reconciler sums
 * `precipitationMm` and `evapotranspirationMm` over the window between the
 * last reconciled-at timestamp and now to advance depletion against reality.
 */
export type HourlyWeather = {
    /** Required. Start of the hour, anchored to the request timezone. */
    time: dayjs.Dayjs;

    /** Required. Total precipitation during the hour. */
    precipitationMm: number;

    /** Required. Reference evapotranspiration (ET₀) during the hour. */
    evapotranspirationMm: number;
}

/**
 * Composite weather response returned by `getWeatherData`. `daily` continues
 * to feed the planner's multi-day forecast; `hourly` is consumed by the
 * morning/evening depletion reconcilers for sub-daily window math.
 */
export type WeatherData = {
    daily: DailyWeather[];
    hourly: HourlyWeather[];
}

export type GrassType = {
    /** Required. The name of the grass. */
    name: string;

    /** Required. The crop coefficient (Kc) for this grass type. Bigger means more water use. */
    cropCoefficient: number;
}

export type SoilType = {
    /** Required. The name of the soil type. */
    name: string;

    /** Required. Available Water Holding Capacity. The amount of water in the soil per metre of depth. */
    availableWaterHoldingCapacityMmPerM: number;

    /** Required. Max infiltration rate. The maximum rate at which water can enter the soil. */
    infiltrationRateMmPerHr: number;
}

export type Site = {
    /** Required. The name of the site. */
    name: string;

    /** Required. The list of irrigation zones at this site. */
    zones: Zone[];

    /** Required. The site's local timezone (IANA format). */
    timezone: string;

    /** Required. The site's geographic coordinates. */
    latitude: number;

    /** Required. The site's longitude coordinate. */
    longitude: number;

    /** Optional. The physical address of the site. */
    address?: string;
}

export type Zone = {
    /** Required. The ID of the zone. */
    id: string;

    /** Required. The name of the zone. */
    name: string;

    /** Required. The grass type planted in the zone. */
    grassType: GrassType;

    /** Required. The soil specifications for the zone. */
    soil: SoilType;

    /** Required. The active root depth. */
    rootDepthM: number;

    /** Required. The allowable depletion fraction. */
    allowableDepletionFraction: number;

    /** Required. The irrigation efficiency (fraction). */
    irrigationEfficiency: number;

    /** Required. The flow rate. */
    flowRateLPerMin: number;

    /** Required. The irrigated area. */
    areaM2: number;

    /** Optional. The measured precipitation rate. */
    precipitationRateMmPerHr?: number;

    /** Required. The current soil moisture deficit (0 = full). */
    currentDepletionMm: number;

    /** Optional. Timestamp of the last reconciliation write to `currentDepletionMm`. Anchors the [since, now) window used by the morning/evening reconcilers to sum weather and actuation history. Null for freshly-seeded zones; the first reconciler tick stamps it and skips the math. */
    currentDepletionReconciledAt?: Date;

    /** Required. The ID of the site this zone belongs to. */
    siteId: string;

    /** Required. The IANA timezone of the site this zone belongs to. */
    siteTimezone: string;

    /** Optional. Whether the zone is enabled for irrigation. Default true. */
    isEnabled?: boolean;

    /** Optional. Geographic location of the zone. */
    location?: { lat: number; lon: number };

    /** Optional. The Home Assistant entity ID controlling the zone's relay (e.g. `switch.sonoff_4chpro_relay_1`). */
    homeAssistantEntityId?: string;

    /** Optional. Multiplier applied to crop ET to account for microclimate differences (sun exposure, aspect). Default 1.0. */
    microclimateFactor?: number;
}

export type IrrigationCycle = {
    /** Required. The start time of the irrigation cycle. */
    startTime: dayjs.Dayjs;

    /** Required. The duration of this cycle. */
    durationMin: number;
}

export type IrrigationScheduleEntry = {
    /** Required. The date for the scheduled irrigation day. */
    date: dayjs.Dayjs;

    /** Required. The ID of the zone being irrigated. */
    zoneId: string;

    /** Required. The list of irrigation cycles for this day. */
    cycles: IrrigationCycle[];

    /** Required. The total gross depth of water applied. */
    appliedDepthMm: number;

    /** Required. The soil moisture depletion before irrigation. */
    depletionBeforeMm: number;

    /** Required. The soil moisture depletion after irrigation. */
    depletionAfterMm: number;

    /**
     * Optional. Sunrise of `date`, anchored to the site timezone. The planner
     * captures it at planning time so consumers (e.g. GET /tonight) can render
     * day/night shading without re-fetching weather.
     */
    sunriseAt?: dayjs.Dayjs;
}