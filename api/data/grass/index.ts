import grassData from './lookup.json';

export type GrowthStage = {
    stage: string;
    description: string;
    monthRanges: string[];
    cropCoefficient: number;
};

export type Grass = {
    name: string;
    label: string;
    description: string;
    climateZones: string[];
    growthStages: GrowthStage[];
};

/**
 * Find a grass object by its name identifier.
 * 
 * @param name - The name identifier of the grass type (e.g., "kentucky-bluegrass", "bermudagrass")
 * @returns The matching Grass object
 * @throws Error if grass type is not found
 */
export function findGrassByName(name: string): Grass {
    const grass = grassData.find((grass) => grass.name === name);
    if (!grass) throw new Error(`Grass type "${name}" not found`);
    return grass;
}
