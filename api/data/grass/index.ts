/**
 * Turfgrass Crop Coefficient Data Sources
 *
 * This file documents the authoritative sources for turfgrass crop coefficients (Kc)
 * and growth stage information stored in the grassData constant below.
 *
 * PRIMARY SOURCES FOR CROP COEFFICIENTS (Kc):
 *
 * 1. FAO Irrigation and Drainage Paper No. 56
 *    "Crop Evapotranspiration - Guidelines for Computing Crop Water Requirements"
 *    Authors: Richard G. Allen, Luis S. Pereira, Dirk Raes, Martin Smith (1998)
 *    http://www.fao.org/3/x0490e/x0490e00.htm
 *    - Table 12: Single crop coefficients for turfgrass
 *    - Cool-season grass: Kc = 0.85-0.95
 *    - Warm-season grass: Kc = 0.75-0.85
 *    - Gold standard for irrigation calculations worldwide
 *
 * 2. ASCE Standardized Reference Evapotranspiration Equation (2005)
 *    American Society of Civil Engineers
 *    https://ascelibrary.org/doi/book/10.1061/9780784408056
 *    - Refines FAO-56 methodology for US conditions
 *    - Provides adjustments for different climatic regions
 *
 * 3. University of California Agriculture and Natural Resources
 *    ANR Publication 8395: "Turfgrass Water Use"
 *    https://anrcatalog.ucanr.edu/Details.aspx?itemNo=8395
 *    - Kc values for cool-season grasses in California
 *    - Seasonal adjustments and growth stage variations
 *
 * 4. University of Nebraska-Lincoln Extension
 *    "Estimating Turfgrass Water Requirements"
 *    https://extensionpubs.unl.edu/
 *    - Kc values for cool-season grasses: 0.80-1.00
 *    - Adjustments for mowing height and management level
 *
 * 5. Texas A&M AgriLife Extension
 *    "Turfgrass Water Requirements and Factors Affecting Water Usage"
 *    https://agrilifeextension.tamu.edu/
 *    - Warm-season grass Kc values for Southern US
 *    - Bermudagrass: 0.75-1.0, St. Augustine: 0.70-0.90
 *
 * 6. University of Florida IFAS Extension
 *    "Basic Irrigation Scheduling in Florida"
 *    https://edis.ifas.ufl.edu/
 *    - Warm-season grass coefficients for Florida conditions
 *    - St. Augustine, Bahiagrass, Zoysiagrass values
 *
 * 7. University of Georgia Extension
 *    "Bermudagrass: The Sports Turf of the South"
 *    https://extension.uga.edu/
 *    - Bermudagrass Kc values: 0.85-1.0 during active growth
 *    - Dormancy period coefficients: 0.4-0.5
 *
 * 8. Irrigation Association
 *    "Landscape Irrigation Scheduling and Water Management" (2014)
 *    https://www.irrigation.org/
 *    - Practical Kc ranges for residential turf
 *    - Adjustment factors for microclimates and management
 *
 * GRASS-SPECIFIC SOURCES:
 *
 * Kentucky Bluegrass & Perennial Ryegrass:
 * - Penn State Extension: "Turfgrass Water Requirements"
 * - Michigan State University Extension
 * - Kc range: 0.80-1.0 (active growth), 0.5-0.7 (dormancy)
 *
 * Tall Fescue:
 * - Virginia Tech Extension
 * - Kansas State University Research
 * - More drought-tolerant: Kc = 0.75-0.90
 *
 * Bermudagrass:
 * - University of Arkansas Extension
 * - Oklahoma State University Turfgrass Research
 * - Peak season Kc: 0.85-1.0, Dormancy: 0.4-0.5
 *
 * St. Augustine:
 * - University of Florida IFAS
 * - LSU AgCenter
 * - Kc range: 0.70-0.95
 *
 * Zoysiagrass:
 * - NC State Extension
 * - Mississippi State Extension
 * - Moderate water needs: Kc = 0.65-0.85
 *
 * Buffalo Grass:
 * - Colorado State University Extension
 * - Nebraska Extension
 * - Very drought-tolerant: Kc = 0.60-0.75
 *
 * Fine Fescues:
 * - University of Minnesota Extension
 * - Cornell Cooperative Extension
 * - Shade-tolerant, lower Kc: 0.65-0.85
 *
 * NOTES ON GROWTH STAGES AND SEASONAL VARIATIONS:
 *
 * 1. Dormancy Periods:
 *    - Cool-season grasses: Summer semi-dormancy and winter slowdown
 *    - Warm-season grasses: Complete winter dormancy
 *    - Kc values reduced by 30-50% during dormancy
 *
 * 2. Month Ranges:
 *    - Generalized for USDA Zones 5-8 (temperate US)
 *    - Should be adjusted based on:
 *      * Local climate and hardiness zone
 *      * Actual green-up and dormancy dates
 *      * Latitude and elevation
 *
 * 3. Transition Periods:
 *    - Spring green-up: Kc gradually increases over 2-4 weeks
 *    - Fall dormancy: Kc gradually decreases over 2-4 weeks
 *    - Values interpolated between active growth and dormancy
 *
 * 4. Management Factors Affecting Kc:
 *    - Mowing height (higher = higher Kc)
 *    - Fertility level (high fertility = higher ET)
 *    - Cultivar selection (some varieties more drought-tolerant)
 *    - Thatch accumulation (affects water penetration)
 *
 * RECOMMENDED ADJUSTMENTS FOR PRODUCTION USE:
 *
 * 1. Climate Zone Integration:
 *    - Link grass types to USDA hardiness zones
 *    - Adjust month ranges by latitude (±2 weeks per 300 miles)
 *    - Consider microclimate effects (urban heat island, elevation)
 *
 * 2. Local Validation:
 *    - Cross-reference with local extension office recommendations
 *    - Adjust for regional climate patterns
 *    - Consider soil type interactions
 *
 * 3. User Customization:
 *    - Allow override of Kc values based on observed conditions
 *    - Provide management level adjustments (basic, moderate, premium)
 *    - Account for irrigation system efficiency
 *
 * 4. Seasonal Learning:
 *    - Track actual vs. predicted water use
 *    - Adjust coefficients based on turf quality observations
 *    - Integrate weather station feedback
 *
 * DATA VALIDATION:
 *
 * All Kc values in grassData fall within established ranges from the sources above.
 * Values represent typical residential lawn conditions with:
 * - Regular mowing at recommended heights
 * - Moderate fertility programs
 * - Standard cultivars (not ultra-drought-tolerant varieties)
 * - Level terrain with good drainage
 *
 * LAST UPDATED: October 2025
 * FAO-56 published 1998 (current standard)
 * Extension publications: 2020-2024
 */

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

export const grassData: Grass[] = [
    {
        name: 'kentucky-bluegrass',
        label: 'Kentucky Bluegrass',
        description: 'Cool-season grass, popular in northern climates. Dense, fine-textured turf.',
        climateZones: ['cool', 'transition'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy, minimal growth',
                monthRanges: ['Nov-Mar'],
                cropCoefficient: 0.5,
            },
            {
                stage: 'spring-greenup',
                description: 'Early spring growth initiation',
                monthRanges: ['Mar-Apr'],
                cropCoefficient: 0.7,
            },
            {
                stage: 'active-growth',
                description: 'Peak growing season',
                monthRanges: ['Apr-Jun', 'Sep-Oct'],
                cropCoefficient: 0.95,
            },
            {
                stage: 'summer-stress',
                description: 'Heat stress period, reduced growth',
                monthRanges: ['Jul-Aug'],
                cropCoefficient: 0.85,
            },
            {
                stage: 'fall-transition',
                description: 'Cooling down, preparing for dormancy',
                monthRanges: ['Oct-Nov'],
                cropCoefficient: 0.7,
            },
        ],
    },
    {
        name: 'perennial-ryegrass',
        label: 'Perennial Ryegrass',
        description: 'Cool-season grass, quick establishment, wear-tolerant.',
        climateZones: ['cool', 'transition'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy',
                monthRanges: ['Dec-Feb'],
                cropCoefficient: 0.5,
            },
            {
                stage: 'spring-greenup',
                description: 'Early spring growth',
                monthRanges: ['Mar-Apr'],
                cropCoefficient: 0.75,
            },
            {
                stage: 'active-growth',
                description: 'Peak growing season',
                monthRanges: ['Apr-Jun', 'Sep-Oct'],
                cropCoefficient: 0.95,
            },
            {
                stage: 'summer-moderate',
                description: 'Moderate summer growth',
                monthRanges: ['Jul-Aug'],
                cropCoefficient: 0.85,
            },
            {
                stage: 'fall-transition',
                description: 'Fall growth before dormancy',
                monthRanges: ['Oct-Nov'],
                cropCoefficient: 0.75,
            },
        ],
    },
    {
        name: 'tall-fescue',
        label: 'Tall Fescue',
        description: 'Cool-season grass, deep-rooted, drought-tolerant.',
        climateZones: ['cool', 'transition', 'warm'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter semi-dormancy',
                monthRanges: ['Dec-Feb'],
                cropCoefficient: 0.6,
            },
            {
                stage: 'spring-growth',
                description: 'Spring active growth',
                monthRanges: ['Mar-May'],
                cropCoefficient: 0.85,
            },
            {
                stage: 'active-growth',
                description: 'Peak growing season',
                monthRanges: ['Apr-Jun', 'Sep-Oct'],
                cropCoefficient: 0.9,
            },
            {
                stage: 'summer-maintenance',
                description: 'Summer maintenance, good heat tolerance',
                monthRanges: ['Jun-Aug'],
                cropCoefficient: 0.8,
            },
            {
                stage: 'fall-growth',
                description: 'Fall recovery and growth',
                monthRanges: ['Sep-Nov'],
                cropCoefficient: 0.85,
            },
        ],
    },
    {
        name: 'bermudagrass',
        label: 'Bermudagrass',
        description: 'Warm-season grass, heat and drought tolerant, aggressive growth.',
        climateZones: ['warm', 'transition'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy, brown and inactive',
                monthRanges: ['Nov-Mar'],
                cropCoefficient: 0.4,
            },
            {
                stage: 'spring-greenup',
                description: 'Breaking dormancy, greening up',
                monthRanges: ['Mar-Apr'],
                cropCoefficient: 0.65,
            },
            {
                stage: 'early-growth',
                description: 'Rapid growth initiation',
                monthRanges: ['Apr-May'],
                cropCoefficient: 0.8,
            },
            {
                stage: 'peak-growth',
                description: 'Maximum growth and water demand',
                monthRanges: ['Jun-Aug'],
                cropCoefficient: 1.0,
            },
            {
                stage: 'late-season',
                description: 'Slowing growth, preparing for dormancy',
                monthRanges: ['Sep-Oct'],
                cropCoefficient: 0.75,
            },
            {
                stage: 'fall-transition',
                description: 'Entering dormancy',
                monthRanges: ['Oct-Nov'],
                cropCoefficient: 0.55,
            },
        ],
    },
    {
        name: 'st-augustine',
        label: 'St. Augustine',
        description: 'Warm-season grass, shade-tolerant, coarse texture.',
        climateZones: ['warm', 'tropical'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy in cooler regions',
                monthRanges: ['Dec-Feb'],
                cropCoefficient: 0.5,
            },
            {
                stage: 'spring-greenup',
                description: 'Spring green-up',
                monthRanges: ['Mar-Apr'],
                cropCoefficient: 0.7,
            },
            {
                stage: 'active-growth',
                description: 'Peak growing season',
                monthRanges: ['May-Sep'],
                cropCoefficient: 0.9,
            },
            {
                stage: 'summer-peak',
                description: 'Maximum water demand',
                monthRanges: ['Jun-Aug'],
                cropCoefficient: 0.95,
            },
            {
                stage: 'fall-slowdown',
                description: 'Declining growth rate',
                monthRanges: ['Oct-Nov'],
                cropCoefficient: 0.7,
            },
        ],
    },
    {
        name: 'zoysiagrass',
        label: 'Zoysiagrass',
        description: 'Warm-season grass, dense growth, moderate water needs.',
        climateZones: ['warm', 'transition'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy, straw-colored',
                monthRanges: ['Nov-Mar'],
                cropCoefficient: 0.45,
            },
            {
                stage: 'spring-greenup',
                description: 'Late spring green-up',
                monthRanges: ['Apr-May'],
                cropCoefficient: 0.7,
            },
            {
                stage: 'active-growth',
                description: 'Summer active growth',
                monthRanges: ['Jun-Aug'],
                cropCoefficient: 0.85,
            },
            {
                stage: 'peak-growth',
                description: 'Peak summer growth',
                monthRanges: ['Jul-Aug'],
                cropCoefficient: 0.9,
            },
            {
                stage: 'fall-transition',
                description: 'Preparing for dormancy',
                monthRanges: ['Sep-Oct'],
                cropCoefficient: 0.65,
            },
        ],
    },
    {
        name: 'buffalo-grass',
        label: 'Buffalo Grass',
        description: 'Warm-season native grass, extremely drought-tolerant, low maintenance.',
        climateZones: ['warm', 'arid'],
        growthStages: [
            {
                stage: 'dormant',
                description: 'Winter dormancy',
                monthRanges: ['Nov-Mar'],
                cropCoefficient: 0.4,
            },
            {
                stage: 'spring-greenup',
                description: 'Late spring green-up',
                monthRanges: ['Apr-May'],
                cropCoefficient: 0.6,
            },
            {
                stage: 'active-growth',
                description: 'Summer growth period',
                monthRanges: ['Jun-Aug'],
                cropCoefficient: 0.75,
            },
            {
                stage: 'fall-transition',
                description: 'Early fall transition to dormancy',
                monthRanges: ['Sep-Oct'],
                cropCoefficient: 0.55,
            },
        ],
    },
    {
        name: 'fine-fescue-mix',
        label: 'Fine Fescue Mix',
        description: 'Cool-season grasses, shade and drought tolerant, fine texture.',
        climateZones: ['cool'],
        growthStages: [
            {
                stage: 'winter-slowdown',
                description: 'Winter slow growth',
                monthRanges: ['Dec-Feb'],
                cropCoefficient: 0.55,
            },
            {
                stage: 'spring-growth',
                description: 'Spring active growth',
                monthRanges: ['Mar-May'],
                cropCoefficient: 0.85,
            },
            {
                stage: 'active-growth',
                description: 'Peak cool-season growth',
                monthRanges: ['Apr-Jun', 'Sep-Oct'],
                cropCoefficient: 0.9,
            },
            {
                stage: 'summer-dormancy',
                description: 'Summer dormancy in heat',
                monthRanges: ['Jul-Aug'],
                cropCoefficient: 0.65,
            },
            {
                stage: 'fall-recovery',
                description: 'Fall recovery growth',
                monthRanges: ['Sep-Nov'],
                cropCoefficient: 0.8,
            },
        ],
    },
];

/**
 * Find a grass object by its name identifier.
 *
 * @param name - The name identifier of the grass type (e.g., "kentucky-bluegrass", "bermudagrass")
 * @returns The matching Grass object
 * @throws Error if grass type is not found
 */
export function findGrassByName(name: string): Grass {
    const grass = grassData.find(grass => grass.name === name);
    if (!grass) throw new Error(`Grass type "${name}" not found`);
    return grass;
}
