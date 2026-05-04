import { test, expect } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { grassTypes, sites, soilTypes, zones } from '.';

function columnsByName(table: Parameters<typeof getTableConfig>[0]) {
    const config = getTableConfig(table);
    return Object.fromEntries(config.columns.map(column => [column.name, column]));
}

test('grass_types table has the expected columns and constraints', () => {
    const config = getTableConfig(grassTypes);
    const columns = columnsByName(grassTypes);

    expect(config.name).toBe('grass_types');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['id']?.hasDefault).toBe(true);
    expect(columns['slug']?.notNull).toBe(true);
    expect(columns['slug']?.isUnique).toBe(true);
    expect(columns['name']?.notNull).toBe(true);
    expect(columns['crop_coefficient']?.notNull).toBe(true);
    expect(columns['crop_coefficient']?.columnType).toBe('PgReal');
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('soil_types table has the expected columns and constraints', () => {
    const config = getTableConfig(soilTypes);
    const columns = columnsByName(soilTypes);

    expect(config.name).toBe('soil_types');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['slug']?.isUnique).toBe(true);
    expect(columns['slug']?.notNull).toBe(true);
    expect(columns['name']?.notNull).toBe(true);
    expect(columns['available_water_holding_capacity_mm_per_m']?.notNull).toBe(true);
    expect(columns['infiltration_rate_mm_per_hr']?.notNull).toBe(true);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('sites table has the expected columns and constraints', () => {
    const config = getTableConfig(sites);
    const columns = columnsByName(sites);

    expect(config.name).toBe('sites');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['slug']?.isUnique).toBe(true);
    expect(columns['slug']?.notNull).toBe(true);
    expect(columns['name']?.notNull).toBe(true);
    expect(columns['timezone']?.notNull).toBe(true);
    expect(columns['latitude']?.notNull).toBe(true);
    expect(columns['latitude']?.columnType).toBe('PgDoublePrecision');
    expect(columns['longitude']?.notNull).toBe(true);
    expect(columns['longitude']?.columnType).toBe('PgDoublePrecision');
    expect(columns['address']?.notNull).toBe(false);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('zones table has the expected columns and constraints', () => {
    const config = getTableConfig(zones);
    const columns = columnsByName(zones);

    expect(config.name).toBe('zones');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['slug']?.isUnique).toBe(true);
    expect(columns['slug']?.notNull).toBe(true);
    expect(columns['site_id']?.notNull).toBe(true);
    expect(columns['grass_type_id']?.notNull).toBe(true);
    expect(columns['soil_type_id']?.notNull).toBe(true);
    expect(columns['name']?.notNull).toBe(true);
    expect(columns['root_depth_m']?.notNull).toBe(true);
    expect(columns['allowable_depletion_fraction']?.notNull).toBe(true);
    expect(columns['irrigation_efficiency']?.notNull).toBe(true);
    expect(columns['flow_rate_l_per_min']?.notNull).toBe(true);
    expect(columns['area_m2']?.notNull).toBe(true);
    expect(columns['precipitation_rate_mm_per_hr']?.notNull).toBe(false);
    expect(columns['current_depletion_mm']?.notNull).toBe(true);
    expect(columns['current_depletion_mm']?.hasDefault).toBe(true);
    expect(columns['is_enabled']?.notNull).toBe(true);
    expect(columns['is_enabled']?.hasDefault).toBe(true);
    expect(columns['latitude']?.notNull).toBe(false);
    expect(columns['longitude']?.notNull).toBe(false);
    expect(columns['home_assistant_entity_id']?.notNull).toBe(false);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('zones foreign keys reference the right parent tables', () => {
    const config = getTableConfig(zones);
    const fkTargets = config.foreignKeys
        .map(fk => {
            const reference = fk.reference();
            return {
                from: reference.columns.map(c => c.name),
                to: reference.foreignTable,
            };
        });

    const siteFk = fkTargets.find(fk => fk.from.includes('site_id'));
    const grassFk = fkTargets.find(fk => fk.from.includes('grass_type_id'));
    const soilFk = fkTargets.find(fk => fk.from.includes('soil_type_id'));

    expect(siteFk?.to).toBe(sites);
    expect(grassFk?.to).toBe(grassTypes);
    expect(soilFk?.to).toBe(soilTypes);
});
