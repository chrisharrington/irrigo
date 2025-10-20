import type dayjs from 'dayjs';

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

    /** Optional. Whether the zone is enabled for irrigation. Default true. */
    isEnabled?: boolean;

    /** Optional. Geographic location of the zone. */
    location?: { lat: number; lon: number };
}

export type DailyWeather = {
    /** Required. The date of the weather record. */
    date: dayjs.Dayjs;

    /** Optional. The reference evapotranspiration. */
    evapotranspirationMmPerDay?: number;

    /** Optional. The total daily rainfall. */
    rainfallMm?: number;

    /** Optional. The local sunrise time as Dayjs object. */
    sunrise?: dayjs.Dayjs;
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
}