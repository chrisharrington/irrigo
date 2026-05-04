import { z } from 'zod';

/**
 * Schemas describing the shape of each seed JSON file. Property names are
 * lowerCamelCase to align with the rest of the TS code (and Drizzle's TS layer)
 * — see `api/db/schema/` for the camelCase ↔ snake_case mapping at the SQL
 * boundary.
 */

export const GrassTypeSeedSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    cropCoefficient: z.number(),
});

export const SoilTypeSeedSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    availableWaterHoldingCapacityMmPerM: z.number(),
    infiltrationRateMmPerHr: z.number(),
});

export const SiteSeedSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    timezone: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().optional(),
});

export const ZoneSeedSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    site: z.string().min(1),
    grassType: z.string().min(1),
    soilType: z.string().min(1),
    rootDepthM: z.number(),
    allowableDepletionFraction: z.number(),
    irrigationEfficiency: z.number(),
    flowRateLPerMin: z.number(),
    areaM2: z.number(),
    precipitationRateMmPerHr: z.number().optional(),
    currentDepletionMm: z.number().optional(),
    isEnabled: z.boolean().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    homeAssistantEntityId: z.string().optional(),
});

export type GrassTypeSeed = z.infer<typeof GrassTypeSeedSchema>;
export type SoilTypeSeed = z.infer<typeof SoilTypeSeedSchema>;
export type SiteSeed = z.infer<typeof SiteSeedSchema>;
export type ZoneSeed = z.infer<typeof ZoneSeedSchema>;

const GrassTypesArraySchema = z.array(GrassTypeSeedSchema);
const SoilTypesArraySchema = z.array(SoilTypeSeedSchema);
const SitesArraySchema = z.array(SiteSeedSchema);
const ZonesArraySchema = z.array(ZoneSeedSchema);

/**
 * Parses the contents of `grass-types.json` into typed seed rows.
 *
 * @param input - Raw parsed JSON (typically from `Bun.file().json()`).
 * @returns Validated grass-type seed rows.
 * @throws ZodError when the input doesn't match the schema.
 */
export function parseGrassTypes(input: unknown): GrassTypeSeed[] {
    return GrassTypesArraySchema.parse(input);
}

/**
 * Parses the contents of `soil-types.json` into typed seed rows.
 *
 * @param input - Raw parsed JSON.
 * @returns Validated soil-type seed rows.
 * @throws ZodError when the input doesn't match the schema.
 */
export function parseSoilTypes(input: unknown): SoilTypeSeed[] {
    return SoilTypesArraySchema.parse(input);
}

/**
 * Parses the contents of `sites.json` into typed seed rows.
 *
 * @param input - Raw parsed JSON.
 * @returns Validated site seed rows.
 * @throws ZodError when the input doesn't match the schema.
 */
export function parseSites(input: unknown): SiteSeed[] {
    return SitesArraySchema.parse(input);
}

/**
 * Parses the contents of `zones.json` into typed seed rows. Slug references
 * (`site`, `grassType`, `soilType`) are validated as non-empty strings here;
 * resolution against the actual ID maps happens in the seed orchestrator.
 *
 * @param input - Raw parsed JSON.
 * @returns Validated zone seed rows.
 * @throws ZodError when the input doesn't match the schema.
 */
export function parseZones(input: unknown): ZoneSeed[] {
    return ZonesArraySchema.parse(input);
}
