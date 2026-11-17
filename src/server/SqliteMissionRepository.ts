import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  LunarSiteId,
  MissionConfig,
  MissionEvaluation,
  MissionPlan,
  RuleVerdict,
  Waypoint,
} from '../models/lunar.types.js';

interface MissionRow {
  id: string;
  name: string;
  site_id: string;
  start_utc: string;
  duration_hours: number;
  battery_capacity_kwh: number;
  base_consumption_kw: number;
  solar_panel_max_kw: number;
  has_relay_satellite: number;
  terrain_slope_deg: number | null;
  eva_speed_kmh: number | null;
  max_eva_range_km: number | null;
  verdict: RuleVerdict;
  viability_score: number;
  evaluation_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface WaypointRow {
  mission_id: string;
  sequence_order: number;
  latitude_deg: number;
  longitude_deg: number;
  elevation_m: number | null;
}

/**
 * Repositorio SQLite para planes de misión y rutas EVA.
 * Todas las consultas utilizan prepared statements parametrizados (`?`).
 */
export class SqliteMissionRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        site_id TEXT NOT NULL,
        start_utc TEXT NOT NULL,
        duration_hours INTEGER NOT NULL,
        battery_capacity_kwh REAL NOT NULL,
        base_consumption_kw REAL NOT NULL,
        solar_panel_max_kw REAL NOT NULL,
        has_relay_satellite INTEGER NOT NULL CHECK (has_relay_satellite IN (0, 1)),
        terrain_slope_deg REAL,
        eva_speed_kmh REAL,
        max_eva_range_km REAL,
        verdict TEXT NOT NULL CHECK (verdict IN ('GO', 'CAUTION', 'NO-GO')),
        viability_score REAL NOT NULL,
        evaluation_json TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eva_waypoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL,
        sequence_order INTEGER NOT NULL,
        latitude_deg REAL NOT NULL,
        longitude_deg REAL NOT NULL,
        elevation_m REAL,
        FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_eva_waypoints_mission_order
        ON eva_waypoints (mission_id, sequence_order);
    `);
  }

  private mapWaypointRow(row: WaypointRow): Waypoint {
    return {
      latitudeDeg: row.latitude_deg,
      longitudeDeg: row.longitude_deg,
      ...(row.elevation_m !== null ? { elevationM: row.elevation_m } : {}),
    };
  }

  private mapMissionRow(row: MissionRow, waypoints: Waypoint[]): MissionPlan {
    const config: MissionConfig = {
      siteId: row.site_id as LunarSiteId,
      startUtc: row.start_utc,
      durationHours: row.duration_hours,
      batteryCapacityKwh: row.battery_capacity_kwh,
      baseConsumptionKw: row.base_consumption_kw,
      solarPanelMaxKw: row.solar_panel_max_kw,
      hasRelaySatellite: row.has_relay_satellite === 1,
      ...(row.terrain_slope_deg !== null ? { terrainSlopeDeg: row.terrain_slope_deg } : {}),
      ...(row.eva_speed_kmh !== null ? { evaSpeedKmh: row.eva_speed_kmh } : {}),
      ...(row.max_eva_range_km !== null ? { maxEvaRangeKm: row.max_eva_range_km } : {}),
      waypoints,
    };

    const evaluation = JSON.parse(row.evaluation_json) as MissionEvaluation;

    return {
      id: row.id,
      name: row.name,
      config,
      evaluation,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getWaypointsByMissionId(missionId: string): Waypoint[] {
    const stmt = this.db.prepare<[string], WaypointRow>(`
      SELECT mission_id, sequence_order, latitude_deg, longitude_deg, elevation_m
      FROM eva_waypoints
      WHERE mission_id = ?
      ORDER BY sequence_order ASC
    `);
    return stmt.all(missionId).map((row) => this.mapWaypointRow(row));
  }

  private insertWaypoints(missionId: string, waypoints: readonly Waypoint[]): void {
    const insertWp = this.db.prepare<
      [string, number, number, number, number | null]
    >(`
      INSERT INTO eva_waypoints (
        mission_id,
        sequence_order,
        latitude_deg,
        longitude_deg,
        elevation_m
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      insertWp.run(
        missionId,
        i,
        wp.latitudeDeg,
        wp.longitudeDeg,
        wp.elevationM ?? null,
      );
    }
  }

  listAll(): MissionPlan[] {
    const listStmt = this.db.prepare<[], MissionRow>(`
      SELECT *
      FROM missions
      ORDER BY updated_at DESC, rowid DESC
    `);
    const wpStmt = this.db.prepare<[], WaypointRow>(`
      SELECT mission_id, sequence_order, latitude_deg, longitude_deg, elevation_m
      FROM eva_waypoints
      ORDER BY mission_id ASC, sequence_order ASC
    `);

    const missionRows = listStmt.all();
    const wpRows = wpStmt.all();

    const wpMap = new Map<string, Waypoint[]>();
    for (const wpRow of wpRows) {
      const list = wpMap.get(wpRow.mission_id) ?? [];
      list.push(this.mapWaypointRow(wpRow));
      wpMap.set(wpRow.mission_id, list);
    }

    return missionRows.map((row) =>
      this.mapMissionRow(row, wpMap.get(row.id) ?? []),
    );
  }

  findById(id: string): MissionPlan | undefined {
    const stmt = this.db.prepare<[string], MissionRow>(`
      SELECT *
      FROM missions
      WHERE id = ?
    `);
    const row = stmt.get(id);
    if (!row) {
      return undefined;
    }
    const waypoints = this.getWaypointsByMissionId(id);
    return this.mapMissionRow(row, waypoints);
  }

  create(plan: MissionPlan): MissionPlan {
    const runCreate = this.db.transaction((newPlan: MissionPlan) => {
      const insertMission = this.db.prepare(`
        INSERT INTO missions (
          id,
          name,
          site_id,
          start_utc,
          duration_hours,
          battery_capacity_kwh,
          base_consumption_kw,
          solar_panel_max_kw,
          has_relay_satellite,
          terrain_slope_deg,
          eva_speed_kmh,
          max_eva_range_km,
          verdict,
          viability_score,
          evaluation_json,
          notes,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertMission.run(
        newPlan.id,
        newPlan.name,
        newPlan.config.siteId,
        newPlan.config.startUtc,
        newPlan.config.durationHours,
        newPlan.config.batteryCapacityKwh,
        newPlan.config.baseConsumptionKw,
        newPlan.config.solarPanelMaxKw,
        newPlan.config.hasRelaySatellite ? 1 : 0,
        newPlan.config.terrainSlopeDeg ?? null,
        newPlan.config.evaSpeedKmh ?? null,
        newPlan.config.maxEvaRangeKm ?? null,
        newPlan.evaluation.verdict,
        newPlan.evaluation.viabilityScore,
        JSON.stringify(newPlan.evaluation),
        newPlan.notes,
        newPlan.createdAt,
        newPlan.updatedAt,
      );

      this.insertWaypoints(newPlan.id, newPlan.config.waypoints ?? []);
    });

    runCreate.immediate(plan);
    return this.findById(plan.id)!;
  }

  update(plan: MissionPlan): MissionPlan | undefined {
    const runUpdate = this.db.transaction((updatedPlan: MissionPlan): boolean => {
      const updateMission = this.db.prepare(`
        UPDATE missions
        SET
          name = ?,
          site_id = ?,
          start_utc = ?,
          duration_hours = ?,
          battery_capacity_kwh = ?,
          base_consumption_kw = ?,
          solar_panel_max_kw = ?,
          has_relay_satellite = ?,
          terrain_slope_deg = ?,
          eva_speed_kmh = ?,
          max_eva_range_km = ?,
          verdict = ?,
          viability_score = ?,
          evaluation_json = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `);

      const result = updateMission.run(
        updatedPlan.name,
        updatedPlan.config.siteId,
        updatedPlan.config.startUtc,
        updatedPlan.config.durationHours,
        updatedPlan.config.batteryCapacityKwh,
        updatedPlan.config.baseConsumptionKw,
        updatedPlan.config.solarPanelMaxKw,
        updatedPlan.config.hasRelaySatellite ? 1 : 0,
        updatedPlan.config.terrainSlopeDeg ?? null,
        updatedPlan.config.evaSpeedKmh ?? null,
        updatedPlan.config.maxEvaRangeKm ?? null,
        updatedPlan.evaluation.verdict,
        updatedPlan.evaluation.viabilityScore,
        JSON.stringify(updatedPlan.evaluation),
        updatedPlan.notes,
        updatedPlan.updatedAt,
        updatedPlan.id,
      );

      if (result.changes === 0) {
        return false;
      }

      const deleteWp = this.db.prepare<[string]>(`
        DELETE FROM eva_waypoints
        WHERE mission_id = ?
      `);
      deleteWp.run(updatedPlan.id);

      this.insertWaypoints(updatedPlan.id, updatedPlan.config.waypoints ?? []);
      return true;
    });

    const existed = runUpdate.immediate(plan);
    if (!existed) {
      return undefined;
    }
    return this.findById(plan.id);
  }

  deleteById(id: string): boolean {
    const stmt = this.db.prepare<[string]>(`
      DELETE FROM missions
      WHERE id = ?
    `);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
