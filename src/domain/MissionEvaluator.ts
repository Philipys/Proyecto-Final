import type {
  CommunicationsRuleResult,
  EnergyRuleResult,
  EvaRuleResult,
  HourlyTelemetry,
  LightingRuleResult,
  LightingState,
  MissionConfig,
  MissionEvaluation,
  OptimalWindowRecommendation,
  RuleVerdict,
  TerrainRuleResult,
} from '../models/lunar.types.js';
import { getLunarSiteById } from '../models/lunarSites.catalog.js';
import { calculateEvaRouteMetrics } from './LunarGeometryService.js';

const DEG_TO_RAD = Math.PI / 180;
const SIN_15_DEG = Math.sin(15 * DEG_TO_RAD);

const CRITICAL_BATTERY_PCT = 20;
const CAUTION_BATTERY_PCT = 35;
const MIN_OPTIMAL_SOLAR_DEG = 3;
const MIN_DTE_EARTH_DEG = 5;
const MAX_SAFE_SLOPE_DEG = 10;
const MAX_CAUTION_SLOPE_DEG = 15;
const DEFAULT_EVA_SPEED_KMH = 3.0;
const DEFAULT_MAX_EVA_RANGE_KM = 10.0;
const MIN_EVA_RETURN_MARGIN_HOURS = 2.0;

/** Regla 1: Clasifica una elevación solar individual en NIGHT, LOW_SHADOWS u OPTIMAL. */
export function classifySolarLighting(solarElevationDeg: number): LightingState {
  if (solarElevationDeg <= 0) {
    return 'NIGHT';
  }
  if (solarElevationDeg < MIN_OPTIMAL_SOLAR_DEG) {
    return 'LOW_SHADOWS';
  }
  return 'OPTIMAL';
}

/** Regla 1: Evalúa las condiciones de iluminación y sombras topográficas en la ventana. */
export function evaluateLighting(
  windowTelemetry: readonly HourlyTelemetry[],
): LightingRuleResult {
  const landingSolarElevationDeg = windowTelemetry[0].solarElevationDeg;
  const landingState = classifySolarLighting(landingSolarElevationDeg);

  let minSolarElevationDeg = Infinity;
  let maxSolarElevationDeg = -Infinity;
  let daylightHours = 0;
  let lowShadowHours = 0;

  for (const row of windowTelemetry) {
    const el = row.solarElevationDeg;
    if (el < minSolarElevationDeg) minSolarElevationDeg = el;
    if (el > maxSolarElevationDeg) maxSolarElevationDeg = el;
    if (el > 0) {
      daylightHours++;
      if (el < MIN_OPTIMAL_SOLAR_DEG) {
        lowShadowHours++;
      }
    }
  }

  if (landingState === 'NIGHT') {
    return {
      status: 'NO-GO',
      landingState,
      landingSolarElevationDeg,
      minSolarElevationDeg,
      maxSolarElevationDeg,
      daylightHours,
      lowShadowHours,
      reason: `Noche lunar al momento del alunizaje (${landingSolarElevationDeg.toFixed(2)}°): descenso visual inseguro.`,
    };
  }

  if (landingState === 'LOW_SHADOWS') {
    return {
      status: 'CAUTION',
      landingState,
      landingSolarElevationDeg,
      minSolarElevationDeg,
      maxSolarElevationDeg,
      daylightHours,
      lowShadowHours,
      reason: `Iluminación rasante (${landingSolarElevationDeg.toFixed(2)}° < 3°): proyecta sombras largas peligrosas.`,
    };
  }

  return {
    status: 'GO',
    landingState,
    landingSolarElevationDeg,
    minSolarElevationDeg,
    maxSolarElevationDeg,
    daylightHours,
    lowShadowHours,
    reason: `Iluminación óptima al alunizar (${landingSolarElevationDeg.toFixed(2)}°).`,
  };
}

/** Regla 2: Simula el balance energético horario de batería vs. generación solar. */
export function simulateEnergyBalance(
  windowTelemetry: readonly HourlyTelemetry[],
  batteryCapacityKwh: number,
  baseConsumptionKw: number,
  solarPanelMaxKw: number,
): EnergyRuleResult {
  let socKwh = batteryCapacityKwh;
  let minBatteryPct = 100;
  let firstCriticalHour: number | null = null;
  let blackoutHours = 0;
  const hourlySocPct: number[] = [];

  for (let i = 0; i < windowTelemetry.length; i++) {
    const el = windowTelemetry[i].solarElevationDeg;
    let pGenKw = 0;

    if (el > 0) {
      const efficiency = Math.min(1, Math.sin(el * DEG_TO_RAD) / SIN_15_DEG);
      pGenKw = solarPanelMaxKw * efficiency;
    } else {
      blackoutHours++;
    }

    const deltaKwh = pGenKw - baseConsumptionKw;
    socKwh = Math.max(0, Math.min(batteryCapacityKwh, socKwh + deltaKwh));
    const socPct = (socKwh / batteryCapacityKwh) * 100;
    hourlySocPct.push(Number(socPct.toFixed(2)));

    if (socPct < minBatteryPct) {
      minBatteryPct = socPct;
    }
    if (socPct < CRITICAL_BATTERY_PCT && firstCriticalHour === null) {
      firstCriticalHour = i + 1;
    }
  }

  const finalBatteryPct = hourlySocPct[hourlySocPct.length - 1] ?? 100;
  const roundedMinPct = Number(minBatteryPct.toFixed(2));

  if (minBatteryPct < CRITICAL_BATTERY_PCT) {
    return {
      status: 'NO-GO',
      minBatteryPct: roundedMinPct,
      finalBatteryPct,
      firstCriticalHour,
      blackoutHours,
      hourlySocPct,
      reason: `Batería cae a ${roundedMinPct.toFixed(1)}% (< 20% reserva crítica) en la hora ${firstCriticalHour}.`,
    };
  }

  if (minBatteryPct < CAUTION_BATTERY_PCT) {
    return {
      status: 'CAUTION',
      minBatteryPct: roundedMinPct,
      finalBatteryPct,
      firstCriticalHour,
      blackoutHours,
      hourlySocPct,
      reason: `Margen energético ajustado: batería mínima en ${roundedMinPct.toFixed(1)}% (entre 20% y 35%).`,
    };
  }

  return {
    status: 'GO',
    minBatteryPct: roundedMinPct,
    finalBatteryPct,
    firstCriticalHour,
    blackoutHours,
    hourlySocPct,
    reason: `Balance energético estable (mínimo ${roundedMinPct.toFixed(1)}%).`,
  };
}

/** Regla 3: Evalúa enlace directo a Tierra (>= 5°) o cobertura por Satélite Relay. */
export function evaluateCommunications(
  windowTelemetry: readonly HourlyTelemetry[],
  hasRelaySatellite: boolean,
): CommunicationsRuleResult {
  let directLinkHours = 0;
  for (const row of windowTelemetry) {
    if (row.earthElevationDeg >= MIN_DTE_EARTH_DEG) {
      directLinkHours++;
    }
  }

  const directLinkPct = Number(
    ((directLinkHours / windowTelemetry.length) * 100).toFixed(2),
  );
  const lossPct = 100 - directLinkPct;

  if (hasRelaySatellite) {
    return {
      status: 'GO',
      directLinkHours,
      directLinkPct,
      relayActive: true,
      reason:
        directLinkHours === 0
          ? 'Cara oculta/sin vista directa: cobertura asegurada mediante Satélite Relay.'
          : `Enlace asegurado con Satélite Relay (DTE directo ${directLinkPct.toFixed(1)}%).`,
    };
  }

  if (lossPct > 50) {
    return {
      status: 'NO-GO',
      directLinkHours,
      directLinkPct,
      relayActive: false,
      reason:
        directLinkHours === 0
          ? 'Pérdida total de telemetría (El_Tierra < 5°): se requiere habilitar Satélite Relay.'
          : `Pérdida crítica de enlace directo (${lossPct.toFixed(1)}% > 50% sin Satélite Relay).`,
    };
  }

  if (lossPct > 0) {
    return {
      status: 'CAUTION',
      directLinkHours,
      directLinkPct,
      relayActive: false,
      reason: `Cortes intermitentes de enlace directo a Tierra (${directLinkPct.toFixed(1)}% disponible).`,
    };
  }

  return {
    status: 'GO',
    directLinkHours,
    directLinkPct,
    relayActive: false,
    reason: 'Enlace directo con la Tierra (DTE >= 5°) continuo al 100%.',
  };
}

/** Regla 4: Evalúa la pendiente topográfica derivada de LOLA frente al riesgo de vuelco. */
export function evaluateTerrainSlope(slopeDeg: number): TerrainRuleResult {
  const roundedSlope = Number(slopeDeg.toFixed(2));
  if (slopeDeg > MAX_CAUTION_SLOPE_DEG) {
    return {
      status: 'NO-GO',
      slopeDeg: roundedSlope,
      reason: `Pendiente crítica de ${roundedSlope.toFixed(1)}° (> 15°): alto riesgo de vuelco del módulo.`,
    };
  }

  if (slopeDeg > MAX_SAFE_SLOPE_DEG) {
    return {
      status: 'CAUTION',
      slopeDeg: roundedSlope,
      reason: `Pendiente moderada de ${roundedSlope.toFixed(1)}° (10°–15°): precaución de inclinación al alunizar.`,
    };
  }

  return {
    status: 'GO',
    slopeDeg: roundedSlope,
    reason: `Terreno estable (${roundedSlope.toFixed(1)}° <= 10°).`,
  };
}

/** Regla 5: Evalúa distancia EVA (Haversine lunar) y margen de retorno antes del ocaso. */
export function evaluateEvaRoute(
  windowTelemetry: readonly HourlyTelemetry[],
  config: MissionConfig,
): EvaRuleResult {
  const waypoints = config.waypoints ?? [];
  const evaSpeedKmh = config.evaSpeedKmh ?? DEFAULT_EVA_SPEED_KMH;
  const maxEvaRangeKm = config.maxEvaRangeKm ?? DEFAULT_MAX_EVA_RANGE_KM;

  let safeWindowHours = 0;
  for (const row of windowTelemetry) {
    const hasLight = row.solarElevationDeg > 0;
    const hasComms =
      config.hasRelaySatellite || row.earthElevationDeg >= MIN_DTE_EARTH_DEG;
    if (!hasLight || !hasComms) {
      break;
    }
    safeWindowHours++;
  }

  if (waypoints.length < 2) {
    return {
      status: 'GO',
      waypointCount: waypoints.length,
      oneWayKm: 0,
      roundTripKm: 0,
      estimatedHours: 0,
      safeWindowHours,
      marginBeforeNightHours: safeWindowHours,
      reason: 'Sin ruta EVA trazada (actividad estacionaria en módulo).',
    };
  }

  const metrics = calculateEvaRouteMetrics(waypoints, evaSpeedKmh);
  const roundTripKm = Number(metrics.roundTripKm.toFixed(3));
  const oneWayKm = Number(metrics.oneWayKm.toFixed(3));
  const estimatedHours = Number(metrics.estimatedHours.toFixed(2));
  const marginBeforeNightHours = Number(
    (safeWindowHours - metrics.estimatedHours).toFixed(2),
  );

  if (metrics.roundTripKm > maxEvaRangeKm) {
    return {
      status: 'NO-GO',
      waypointCount: metrics.waypointCount,
      oneWayKm,
      roundTripKm,
      estimatedHours,
      safeWindowHours,
      marginBeforeNightHours,
      reason: `Ruta EVA de ${roundTripKm.toFixed(2)} km excede la autonomía máxima (${maxEvaRangeKm} km).`,
    };
  }

  if (marginBeforeNightHours < MIN_EVA_RETURN_MARGIN_HOURS) {
    return {
      status: 'NO-GO',
      waypointCount: metrics.waypointCount,
      oneWayKm,
      roundTripKm,
      estimatedHours,
      safeWindowHours,
      marginBeforeNightHours,
      reason: `Margen de retorno insuficiente (${marginBeforeNightHours.toFixed(1)} h < 2.0 h antes de noche o pérdida de enlace).`,
    };
  }

  return {
    status: 'GO',
    waypointCount: metrics.waypointCount,
    oneWayKm,
    roundTripKm,
    estimatedHours,
    safeWindowHours,
    marginBeforeNightHours,
    reason: `Ruta EVA segura (${roundTripKm.toFixed(2)} km, ${estimatedHours.toFixed(2)} h, margen ${marginBeforeNightHours.toFixed(1)} h).`,
  };
}

function validateMissionConfig(
  config: MissionConfig,
  windowTelemetry: readonly HourlyTelemetry[],
): void {
  if (!Number.isInteger(config.durationHours) || config.durationHours < 1 || config.durationHours > 720) {
    throw new RangeError('La duración de la misión debe ser un entero entre 1 y 720 horas.');
  }
  if (!Number.isFinite(config.batteryCapacityKwh) || config.batteryCapacityKwh <= 0) {
    throw new RangeError('La capacidad de batería debe ser mayor que cero.');
  }
  if (!Number.isFinite(config.baseConsumptionKw) || config.baseConsumptionKw <= 0) {
    throw new RangeError('El consumo base debe ser mayor que cero.');
  }
  if (!Number.isFinite(config.solarPanelMaxKw) || config.solarPanelMaxKw < 0) {
    throw new RangeError('La potencia solar máxima no puede ser negativa.');
  }
  if (windowTelemetry.length < config.durationHours) {
    throw new RangeError(
      `La ventana de telemetría tiene ${windowTelemetry.length} horas y se requieren ${config.durationHours}.`,
    );
  }
}

function computeViabilityScore(
  verdict: RuleVerdict,
  lighting: LightingRuleResult,
  energy: EnergyRuleResult,
  communications: CommunicationsRuleResult,
  terrain: TerrainRuleResult,
  eva: EvaRuleResult,
): number {
  let score = 100;

  if (lighting.status === 'NO-GO') score -= 35;
  else if (lighting.status === 'CAUTION') score -= 12;

  if (energy.status === 'NO-GO') score -= 35;
  else if (energy.status === 'CAUTION') score -= 12;
  else if (energy.minBatteryPct < 60) score -= 4;

  if (communications.status === 'NO-GO') score -= 30;
  else if (communications.status === 'CAUTION') score -= 10;

  if (terrain.status === 'NO-GO') score -= 30;
  else if (terrain.status === 'CAUTION') score -= 10;

  if (eva.status === 'NO-GO') score -= 25;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (verdict === 'NO-GO') return Math.min(45, clamped);
  if (verdict === 'CAUTION') return Math.max(50, Math.min(89, clamped));
  return Math.max(80, clamped);
}

/**
 * Ejecuta el motor completo de viabilidad sobre una ventana horaria ya recortada
 * (primer elemento = hora de alunizaje).
 */
export function evaluateMissionWindow(
  windowTelemetry: readonly HourlyTelemetry[],
  config: MissionConfig,
): MissionEvaluation {
  validateMissionConfig(config, windowTelemetry);

  const slice = windowTelemetry.slice(0, config.durationHours);
  const catalogSite = getLunarSiteById(config.siteId);
  const slopeDeg =
    config.terrainSlopeDeg ?? catalogSite?.terrainSlopeDeg ?? 5.0;

  const lighting = evaluateLighting(slice);
  const energy = simulateEnergyBalance(
    slice,
    config.batteryCapacityKwh,
    config.baseConsumptionKw,
    config.solarPanelMaxKw,
  );
  const communications = evaluateCommunications(slice, config.hasRelaySatellite);
  const terrain = evaluateTerrainSlope(slopeDeg);
  const eva = evaluateEvaRoute(slice, config);

  const allRules = [lighting, energy, communications, terrain, eva];
  const blockingReasons = allRules
    .filter((r) => r.status === 'NO-GO')
    .map((r) => r.reason);
  const warnings = allRules
    .filter((r) => r.status === 'CAUTION')
    .map((r) => r.reason);

  let verdict: RuleVerdict = 'GO';
  if (blockingReasons.length > 0) {
    verdict = 'NO-GO';
  } else if (warnings.length > 0) {
    verdict = 'CAUTION';
  }

  const viabilityScore = computeViabilityScore(
    verdict,
    lighting,
    energy,
    communications,
    terrain,
    eva,
  );

  return {
    verdict,
    viabilityScore,
    blockingReasons,
    warnings,
    rules: {
      lighting,
      energy,
      communications,
      terrain,
      eva,
    },
  };
}

/**
 * Busca una hora de inicio en la serie anual completa (8,760 h) y evalúa la misión.
 */
export function evaluateMissionAtStart(
  annualTelemetry: readonly HourlyTelemetry[],
  config: MissionConfig,
): MissionEvaluation {
  const startMs = Date.parse(config.startUtc);
  if (Number.isNaN(startMs)) {
    throw new RangeError(`Fecha UTC de inicio inválida: ${config.startUtc}`);
  }

  const startIndex = annualTelemetry.findIndex(
    (row) => Date.parse(row.utcIso) === startMs,
  );
  if (startIndex === -1) {
    throw new RangeError(
      `No existe telemetría para la fecha solicitada: ${config.startUtc}`,
    );
  }

  const slice = annualTelemetry.slice(
    startIndex,
    startIndex + config.durationHours,
  );
  return evaluateMissionWindow(slice, config);
}

const VERDICT_RANK: Record<RuleVerdict, number> = {
  GO: 3,
  CAUTION: 2,
  'NO-GO': 1,
};

/**
 * Recorre todo el año 2027 mediante ventana deslizante y retorna las mejores
 * ventanas de alunizaje no solapadas.
 */
export function findBestLandingWindows(
  annualTelemetry: readonly HourlyTelemetry[],
  baseConfig: Omit<MissionConfig, 'startUtc'>,
  topK = 3,
): OptimalWindowRecommendation[] {
  const { durationHours } = baseConfig;
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720) {
    throw new RangeError('La duración de ventana debe estar entre 1 y 720 horas.');
  }
  if (annualTelemetry.length < durationHours) {
    return [];
  }

  interface Candidate {
    index: number;
    evaluation: MissionEvaluation;
  }

  const candidates: Candidate[] = [];
  for (let i = 0; i <= annualTelemetry.length - durationHours; i++) {
    const slice = annualTelemetry.slice(i, i + durationHours);
    const evaluation = evaluateMissionWindow(slice, {
      ...baseConfig,
      startUtc: slice[0].utcIso,
    });
    candidates.push({ index: i, evaluation });
  }

  candidates.sort((a, b) => {
    const rankDiff =
      VERDICT_RANK[b.evaluation.verdict] - VERDICT_RANK[a.evaluation.verdict];
    if (rankDiff !== 0) return rankDiff;

    const scoreDiff = b.evaluation.viabilityScore - a.evaluation.viabilityScore;
    if (scoreDiff !== 0) return scoreDiff;

    const lightDiff =
      b.evaluation.rules.lighting.daylightHours -
      a.evaluation.rules.lighting.daylightHours;
    if (lightDiff !== 0) return lightDiff;

    return (
      b.evaluation.rules.energy.minBatteryPct -
      a.evaluation.rules.energy.minBatteryPct
    );
  });

  const selected: OptimalWindowRecommendation[] = [];
  const chosenIndices: number[] = [];

  for (const candidate of candidates) {
    const overlaps = chosenIndices.some(
      (idx) => Math.abs(idx - candidate.index) < durationHours,
    );
    if (overlaps) continue;

    const startRow = annualTelemetry[candidate.index];
    const endRow = annualTelemetry[candidate.index + durationHours - 1];
    selected.push({
      startUtc: startRow.utcIso,
      endUtc: endRow.utcIso,
      verdict: candidate.evaluation.verdict,
      viabilityScore: candidate.evaluation.viabilityScore,
      daylightHours: candidate.evaluation.rules.lighting.daylightHours,
      minBatteryPct: candidate.evaluation.rules.energy.minBatteryPct,
      directLinkPct: candidate.evaluation.rules.communications.directLinkPct,
    });
    chosenIndices.push(candidate.index);

    if (selected.length >= topK) break;
  }

  return selected;
}
