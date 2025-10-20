/**
 * Soil Type Data Sources
 * 
 * This file documents the authoritative sources for the soil physical properties
 * stored in the adjacent lookup.json file.
 * 
 * SOURCES FOR AVAILABLE WATER HOLDING CAPACITY (AWHC):
 * 
 * 1. USDA Natural Resources Conservation Service (NRCS)
 *    "Soil Water Characteristics"
 *    https://www.nrcs.usda.gov/wps/portal/nrcs/detail/soils/survey/
 *    - Primary source for AWHC values by soil texture class
 *    - Values represent available water between field capacity and permanent wilting point
 *    - Measured in mm of water per meter of soil depth (mm/m)
 * 
 * 2. USDA-NRCS National Soil Survey Handbook
 *    Part 618 - Soil Properties and Qualities
 *    https://www.nrcs.usda.gov/wps/portal/nrcs/detail/soils/ref/
 *    - Standard reference for soil physical properties
 *    - Table 618.44: Available Water Capacity by Texture Class
 * 
 * 3. FAO Irrigation and Drainage Paper No. 56
 *    "Crop Evapotransporation - Guidelines for Computing Crop Water Requirements"
 *    http://www.fao.org/3/x0490e/x0490e0b.htm
 *    Chapter 8, Table 19: Typical soil water characteristics
 *    - International standard for irrigation calculations
 * 
 * 4. University Extension Publications:
 *    - University of California ANR Publication 8044
 *      "Soil Water Movement and Monitoring"
 *      https://anrcatalog.ucanr.edu/
 *    - Penn State Extension: Soil Quality - Water Holding Capacity
 *      https://extension.psu.edu/soil-quality-water-holding-capacity
 * 
 * SOURCES FOR INFILTRATION RATES:
 * 
 * 1. USDA-NRCS National Engineering Handbook
 *    Part 623, Chapter 7: Hydrologic Soil Groups
 *    https://directives.sc.egov.usda.gov/OpenNonWebContent.aspx?content=17758.wba
 *    - Standard infiltration rate ranges by texture
 *    - Used for irrigation system design
 * 
 * 2. American Society of Agricultural and Biological Engineers (ASABE)
 *    ASABE Standards D384.2: "Terminology and Definitions for Soil Tillage and
 *    Soil-Tool Relationships"
 *    - Engineering standards for soil infiltration
 * 
 * 3. Irrigation Association
 *    "Landscape Irrigation Design Manual" (2014)
 *    https://www.irrigation.org/
 *    - Practical infiltration rates for landscape irrigation design
 *    - Accounts for surface conditions and compaction
 * 
 * 4. USDA Agricultural Handbook No. 667
 *    "Urban Hydrology for Small Watersheds" (TR-55)
 *    - Infiltration rates for urban soils with typical compaction
 * 
 * SOIL TEXTURE CLASSIFICATION:
 * 
 * USDA Soil Texture Triangle
 * https://www.nrcs.usda.gov/wps/portal/nrcs/detail/soils/survey/?cid=nrcs142p2_054167
 * - Standard classification system based on percentages of sand, silt, and clay
 * - 12 basic textural classes used in lookup.json
 * 
 * NOTES ON DATA VALUES:
 * 
 * 1. AWHC Values (mm/m):
 *    - Represent typical mid-range values for each texture class
 *    - Actual values can vary ±20% based on:
 *      * Organic matter content (higher = more water retention)
 *      * Soil structure and aggregation
 *      * Bulk density
 *      * Presence of rocks or hardpan layers
 * 
 * 2. Infiltration Rates (mm/hr):
 *    - Values represent "basic intake rate" after prolonged wetting
 *    - Initial infiltration rates are typically 2-3x higher
 *    - These are conservative values accounting for:
 *      * Surface sealing and crusting
 *      * Typical urban lawn compaction
 *      * Thatch layer effects
 *      * Slope considerations
 * 
 * 3. Field Adjustments:
 *    Applications should allow users to adjust these values based on:
 *    - Local soil testing results
 *    - Observed infiltration performance
 *    - Site-specific conditions (slope, compaction, amendments)
 *    - Seasonal variations (frozen soil, extremely dry soil)
 * 
 * LAST UPDATED: October 2025
 * USDA NRCS data current as of 2024
 * FAO-56 published 1998 (still current standard)
 */

import soilData from './lookup.json';

export type SoilCharacteristics = {
    drainage: string;
    waterRetention: string;
    workability: string;
    compaction: string;
};

export type Soil = {
    name: string;
    label: string;
    description: string;
    texture: string;
    availableWaterHoldingCapacityMmPerM: number;
    infiltrationRateMmPerHr: number;
    characteristics: SoilCharacteristics;
    irrigationNotes: string;
};

/**
 * Find a soil object by its name identifier.
 * 
 * @param name - The name identifier of the soil type (e.g., "loam", "sandy-clay-loam")
 * @returns The matching Soil object
 * @throws Error if soil type is not found
 */
export function findSoilByName(name: string): Soil {
    const soil = soilData.find((soil) => soil.name === name);
    if (!soil) throw new Error(`Soil type "${name}" not found.`);
    return soil;
}
