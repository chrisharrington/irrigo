import { test, expect } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { grassTypes, irrigationCycles, pushTokens, scheduleEntries, sites, soilTypes, weatherDailySnapshots, weatherHourlySnapshots, weatherSnapshots, zones } from '.';

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

test('schedule_entries table has the expected columns and constraints', () => {
    const config = getTableConfig(scheduleEntries);
    const columns = columnsByName(scheduleEntries);

    expect(config.name).toBe('schedule_entries');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['id']?.hasDefault).toBe(true);
    expect(columns['zone_id']?.notNull).toBe(true);
    expect(columns['date']?.notNull).toBe(true);
    expect(columns['date']?.columnType).toBe('PgDateString');
    expect(columns['applied_depth_mm']?.notNull).toBe(true);
    expect(columns['applied_depth_mm']?.columnType).toBe('PgReal');
    expect(columns['depletion_before_mm']?.notNull).toBe(true);
    expect(columns['depletion_after_mm']?.notNull).toBe(true);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('schedule_entries foreign key references zones', () => {
    const config = getTableConfig(scheduleEntries);
    const fkTargets = config.foreignKeys.map(fk => {
        const reference = fk.reference();
        return {
            from: reference.columns.map(c => c.name),
            to: reference.foreignTable,
        };
    });

    const zoneFk = fkTargets.find(fk => fk.from.includes('zone_id'));
    expect(zoneFk?.to).toBe(zones);
});

test('irrigation_cycles table has the expected columns and constraints', () => {
    const config = getTableConfig(irrigationCycles);
    const columns = columnsByName(irrigationCycles);

    expect(config.name).toBe('irrigation_cycles');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['id']?.hasDefault).toBe(true);
    expect(columns['schedule_entry_id']?.notNull).toBe(true);
    expect(columns['start_time']?.notNull).toBe(true);
    expect(columns['start_time']?.columnType).toBe('PgTimestamp');
    expect(columns['duration_min']?.notNull).toBe(true);
    expect(columns['duration_min']?.columnType).toBe('PgReal');
    expect(columns['fired_at']?.notNull).toBe(false);
    expect(columns['closed_at']?.notNull).toBe(false);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('irrigation_cycles foreign key cascades on schedule_entry delete', () => {
    const config = getTableConfig(irrigationCycles);
    const fk = config.foreignKeys[0];

    expect(fk).toBeDefined();
    const reference = fk!.reference();
    expect(reference.columns.map(c => c.name)).toContain('schedule_entry_id');
    expect(reference.foreignTable).toBe(scheduleEntries);
    expect(fk!.onDelete).toBe('cascade');
});

test('push_tokens table has the expected columns and constraints', () => {
    const config = getTableConfig(pushTokens);
    const columns = columnsByName(pushTokens);

    expect(config.name).toBe('push_tokens');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['id']?.hasDefault).toBe(true);
    expect(columns['token']?.notNull).toBe(true);
    expect(columns['token']?.isUnique).toBe(true);
    expect(columns['platform']?.notNull).toBe(true);
    expect(columns['user_agent']?.notNull).toBe(false);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('weather_snapshots table has the expected columns and constraints', () => {
    const config = getTableConfig(weatherSnapshots);
    const columns = columnsByName(weatherSnapshots);

    expect(config.name).toBe('weather_snapshots');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['id']?.hasDefault).toBe(true);
    expect(columns['zone_id']?.notNull).toBe(true);
    expect(columns['latitude']?.notNull).toBe(true);
    expect(columns['latitude']?.columnType).toBe('PgReal');
    expect(columns['longitude']?.notNull).toBe(true);
    expect(columns['timezone']?.notNull).toBe(true);
    expect(columns['fetched_at']?.notNull).toBe(true);
    expect(columns['fetched_at']?.columnType).toBe('PgTimestamp');
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('weather_snapshots foreign key references zones', () => {
    const config = getTableConfig(weatherSnapshots);
    const fk = config.foreignKeys[0];

    expect(fk).toBeDefined();
    const reference = fk!.reference();
    expect(reference.columns.map(c => c.name)).toContain('zone_id');
    expect(reference.foreignTable).toBe(zones);
});

test('weather_daily_snapshots table has the expected columns and constraints', () => {
    const config = getTableConfig(weatherDailySnapshots);
    const columns = columnsByName(weatherDailySnapshots);

    expect(config.name).toBe('weather_daily_snapshots');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['snapshot_id']?.notNull).toBe(true);
    expect(columns['date']?.notNull).toBe(true);
    // Forecast quantities are nullable — DailyWeather's fields are optional.
    expect(columns['sunrise_at']?.notNull).toBe(false);
    expect(columns['sunset_at']?.notNull).toBe(false);
    expect(columns['precipitation_mm']?.notNull).toBe(false);
    expect(columns['precipitation_mm']?.columnType).toBe('PgReal');
    expect(columns['et0_mm_per_day']?.notNull).toBe(false);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('weather_daily_snapshots foreign key cascades on snapshot delete', () => {
    const config = getTableConfig(weatherDailySnapshots);
    const fk = config.foreignKeys[0];

    expect(fk).toBeDefined();
    const reference = fk!.reference();
    expect(reference.columns.map(c => c.name)).toContain('snapshot_id');
    expect(reference.foreignTable).toBe(weatherSnapshots);
    expect(fk!.onDelete).toBe('cascade');
});

test('weather_hourly_snapshots table has the expected columns and constraints', () => {
    const config = getTableConfig(weatherHourlySnapshots);
    const columns = columnsByName(weatherHourlySnapshots);

    expect(config.name).toBe('weather_hourly_snapshots');
    expect(columns['id']?.primary).toBe(true);
    expect(columns['snapshot_id']?.notNull).toBe(true);
    expect(columns['time']?.notNull).toBe(true);
    expect(columns['time']?.columnType).toBe('PgTimestamp');
    // Hourly quantities are required — HourlyWeather's fields are non-optional.
    expect(columns['precipitation_mm']?.notNull).toBe(true);
    expect(columns['precipitation_mm']?.columnType).toBe('PgReal');
    expect(columns['et0_mm']?.notNull).toBe(true);
    expect(columns['created_at']?.notNull).toBe(true);
    expect(columns['updated_at']?.notNull).toBe(true);
});

test('weather_hourly_snapshots foreign key cascades on snapshot delete', () => {
    const config = getTableConfig(weatherHourlySnapshots);
    const fk = config.foreignKeys[0];

    expect(fk).toBeDefined();
    const reference = fk!.reference();
    expect(reference.columns.map(c => c.name)).toContain('snapshot_id');
    expect(reference.foreignTable).toBe(weatherSnapshots);
    expect(fk!.onDelete).toBe('cascade');
});
