import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LUNAR_RADIUS_KM,
  calculateHaversineLunarDistanceKm,
} from '../src/domain/LunarGeometryService.js';
import {
  evaluateMissionWindow,
  findBestLandingWindows,
} from '../src/domain/MissionEvaluator.js';
import type {
  HourlyTelemetry,
  MissionConfig,
  Waypoint,
} from '../src/models/lunar.types.js';
import { LUNAR_SITES } from '../src/models/lunarSites.catalog.js';
import { mergeSolarAndEarthTelemetry } from '../src/services/HorizonsParser.js';

function buildSyntheticWindow(
  hours: number,
  solarFn: (hourIdx: number) => number,
  earthFn: (hourIdx: number) => number = () => 30,
): HourlyTelemetry[] {
  const baseMs = Date.parse('2027-06-01T00:00:00Z');
  const rows: HourlyTelemetry[] = [];
  for (let i = 0; i < hours; i++) {
    rows.push({
      utcIso: new Date(baseMs + i * 3600_000).toISOString().replace('.000Z', 'Z'),
      solarAzimuthDeg: (i * 0.5) % 360,
      solarElevationDeg: solarFn(i),
      earthAzimuthDeg: 180,
      earthElevationDeg: earthFn(i),
    });
  }
  return rows;
}

function buildWaypointAtDistanceKm(origin: Waypoint, distanceKm: number): Waypoint {
  const deltaLonDeg =
    (distanceKm / (LUNAR_RADIUS_KM * Math.cos((origin.latitudeDeg * Math.PI) / 180))) *
    (180 / Math.PI);
  return {
    latitudeDeg: origin.latitudeDeg,
    longitudeDeg: origin.longitudeDeg + deltaLonDeg,
  };
}

describe('MissionEvaluator — 5 Reglas de Negocio (Escenarios BDD spec.md)', () => {
  it('Escenario 1 (Regla 1): detecta noche lunar (-12.4°) al alunizar y emite NO-GO', () => {
    const telemetry = buildSyntheticWindow(24, (h) => (h === 0 ? -12.4 : 10));
    const config: MissionConfig = {
      siteId: 'apollo-11',
      startUtc: telemetry[0].utcIso,
      durationHours: 24,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 4.0,
      hasRelaySatellite: false,
      terrainSlopeDeg: 2.0,
    };

    const result = evaluateMissionWindow(telemetry, config);
    expect(result.rules.lighting.landingState).toBe('NIGHT');
    expect(result.rules.lighting.status).toBe('NO-GO');
    expect(result.verdict).toBe('NO-GO');
  });

  it('Escenario 2 (Regla 1): emite LOW_SHADOWS y CAUTION en Shackleton con luz rasante (+1.5° / +2.1°)', () => {
    const telemetry = buildSyntheticWindow(24, (h) => (h === 0 ? 1.5 : 2.1));
    const config: MissionConfig = {
      siteId: 'shackleton-rim',
      startUtc: telemetry[0].utcIso,
      durationHours: 24,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.0,
      solarPanelMaxKw: 6.0,
      hasRelaySatellite: true,
      terrainSlopeDeg: 6.0,
    };

    const result = evaluateMissionWindow(telemetry, config);
    expect(result.rules.lighting.landingState).toBe('LOW_SHADOWS');
    expect(result.rules.lighting.status).toBe('CAUTION');
    expect(result.rules.energy.minBatteryPct).toBeGreaterThan(50);
    expect(result.verdict).toBe('CAUTION');
  });

  it('Escenario 3 (Regla 2): falla batería (< 20%) tras 36h de oscuridad con 100 kWh y 2.5 kW/h', () => {
    // Primeras 12h de día óptimo (>= 15°) para mantener 100%, seguidas de 36h de noche total (<= 0°)
    const telemetry = buildSyntheticWindow(48, (h) => (h < 12 ? 15 : -5));
    const config: MissionConfig = {
      siteId: 'apollo-11',
      startUtc: telemetry[0].utcIso,
      durationHours: 48,
      batteryCapacityKwh: 100,
      baseConsumptionKw: 2.5,
      solarPanelMaxKw: 3.0, // mantiene 100% durante las primeras 12h
      hasRelaySatellite: true,
      terrainSlopeDeg: 2.0,
    };

    const result = evaluateMissionWindow(telemetry, config);
    expect(result.rules.energy.minBatteryPct).toBeCloseTo(10, 1);
    expect(result.rules.energy.firstCriticalHour).toBe(45); // 12h luz + 33h noche (100 - 33*2.5 = 17.5% < 20%)
    expect(result.rules.energy.status).toBe('NO-GO');
    expect(result.verdict).toBe('NO-GO');
  });

  it('Escenario 4 (Regla 3): bloquea cara oculta sin Satélite Relay y aprueba cuando se activa', () => {
    const telemetry = buildSyntheticWindow(
      24,
      () => 15,
      () => -42, // Tierra bajo el horizonte todo el tiempo
    );

    const withoutRelay: MissionConfig = {
      siteId: 'change-4',
      startUtc: telemetry[0].utcIso,
      durationHours: 24,
      batteryCapacityKwh: 100,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: false,
      terrainSlopeDeg: 3.4,
    };
    const blocked = evaluateMissionWindow(telemetry, withoutRelay);
    expect(blocked.rules.communications.status).toBe('NO-GO');
    expect(blocked.verdict).toBe('NO-GO');

    const withRelay = evaluateMissionWindow(telemetry, {
      ...withoutRelay,
      hasRelaySatellite: true,
    });
    expect(withRelay.rules.communications.status).toBe('GO');
    expect(withRelay.verdict).toBe('GO');
  });

  it('Escenario 5 (Regla 4): clasifica pendiente estable (<=10°), moderada (10–15°) y crítica (>15°)', () => {
    const telemetry = buildSyntheticWindow(12, () => 20);
    const base: MissionConfig = {
      siteId: 'im1-odysseus',
      startUtc: telemetry[0].utcIso,
      durationHours: 12,
      batteryCapacityKwh: 100,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: true,
    };

    const goTerrain = evaluateMissionWindow(telemetry, {
      ...base,
      terrainSlopeDeg: 5.0,
    });
    expect(goTerrain.rules.terrain.status).toBe('GO');
    expect(goTerrain.verdict).toBe('GO');

    const cautionTerrain = evaluateMissionWindow(telemetry, {
      ...base,
      terrainSlopeDeg: 11.8,
    });
    expect(cautionTerrain.rules.terrain.status).toBe('CAUTION');
    expect(cautionTerrain.verdict).toBe('CAUTION');

    const noGoTerrain = evaluateMissionWindow(telemetry, {
      ...base,
      terrainSlopeDeg: 17.2,
    });
    expect(noGoTerrain.rules.terrain.status).toBe('NO-GO');
    expect(noGoTerrain.verdict).toBe('NO-GO');
  });

  it('Escenario 6 (Regla 5): valida ruta EVA de 1.8 km (3.6 km ida/vuelta) y rechaza exceso de rango o sin margen de retorno', () => {
    const origin: Waypoint = { latitudeDeg: 0.674, longitudeDeg: 23.473 };
    const safeTarget = buildWaypointAtDistanceKm(origin, 1.8);
    expect(calculateHaversineLunarDistanceKm(origin, safeTarget)).toBeCloseTo(
      1.8,
      2,
    );

    const tenHoursLight = buildSyntheticWindow(12, (h) => (h < 10 ? 18 : -5));
    const safeConfig: MissionConfig = {
      siteId: 'apollo-11',
      startUtc: tenHoursLight[0].utcIso,
      durationHours: 12,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: true,
      terrainSlopeDeg: 2.1,
      waypoints: [origin, safeTarget],
      evaSpeedKmh: 3.0,
      maxEvaRangeKm: 10.0,
    };

    const safeEval = evaluateMissionWindow(tenHoursLight, safeConfig);
    expect(safeEval.rules.eva.roundTripKm).toBeCloseTo(3.6, 1);
    expect(safeEval.rules.eva.estimatedHours).toBeCloseTo(1.2, 1);
    expect(safeEval.rules.eva.status).toBe('GO');

    // Exceso de rango (12.5 km totales -> 6.25 km ida)
    const farTarget = buildWaypointAtDistanceKm(origin, 6.25);
    const tooFar = evaluateMissionWindow(tenHoursLight, {
      ...safeConfig,
      waypoints: [origin, farTarget],
    });
    expect(tooFar.rules.eva.status).toBe('NO-GO');
    expect(tooFar.verdict).toBe('NO-GO');

    // Poco tiempo antes de noche (solo 2.5 h de luz; caminata 1.2 h deja 1.3 h < 2 h margen)
    const shortLight = buildSyntheticWindow(12, (h) => (h < 2.5 ? 18 : -5));
    const noMargin = evaluateMissionWindow(shortLight, safeConfig);
    expect(noMargin.rules.eva.status).toBe('NO-GO');
    expect(noMargin.verdict).toBe('NO-GO');
  });

  it('valida rangos de entrada (RNF-01) y rechaza duraciones inválidas', () => {
    const telemetry = buildSyntheticWindow(10, () => 15);
    const badDuration: MissionConfig = {
      siteId: 'apollo-11',
      startUtc: telemetry[0].utcIso,
      durationHours: 0,
      batteryCapacityKwh: 100,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: true,
    };
    expect(() => evaluateMissionWindow(telemetry, badDuration)).toThrow(RangeError);
    expect(() =>
      evaluateMissionWindow(telemetry, { ...badDuration, durationHours: 721 }),
    ).toThrow(RangeError);
  });

  it('encuentra las 3 mejores ventanas de 72h en 2027 sobre efemérides reales NASA de Apolo 11 y Shackleton', async () => {
    const horizonsDir = path.resolve(process.cwd(), 'data', 'horizons');
    const apollo = LUNAR_SITES.find((s) => s.id === 'apollo-11')!;
    const shackleton = LUNAR_SITES.find((s) => s.id === 'shackleton-rim')!;

    const [aSun, aEarth, sSun, sEarth] = await Promise.all([
      readFile(path.join(horizonsDir, apollo.solarFileName), 'utf8'),
      readFile(path.join(horizonsDir, apollo.earthFileName), 'utf8'),
      readFile(path.join(horizonsDir, shackleton.solarFileName), 'utf8'),
      readFile(path.join(horizonsDir, shackleton.earthFileName), 'utf8'),
    ]);

    const apolloTelemetry = mergeSolarAndEarthTelemetry(aSun, aEarth);
    const shackTelemetry = mergeSolarAndEarthTelemetry(sSun, sEarth);

    const apolloBest = findBestLandingWindows(
      apolloTelemetry,
      {
        siteId: 'apollo-11',
        durationHours: 72,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.5,
        solarPanelMaxKw: 3.5,
        hasRelaySatellite: false,
      },
      3,
    );

    expect(apolloBest).toHaveLength(3);
    expect(apolloBest[0].verdict).toBe('GO');
    expect(apolloBest[0].daylightHours).toBe(72);

    const t0 = performance.now();
    const shackBest = findBestLandingWindows(
      shackTelemetry,
      {
        siteId: 'shackleton-rim',
        durationHours: 72,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.2,
        solarPanelMaxKw: 4.5,
        hasRelaySatellite: true,
      },
      3,
    );
    const elapsedMs = performance.now() - t0;

    expect(shackBest).toHaveLength(3);
    // RNF-04: cálculo anual de 8,760 h por debajo de 200 ms
    expect(elapsedMs).toBeLessThan(200);
  });
});
