import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findBestLandingWindows } from '../domain/MissionEvaluator.js';
import type {
  HourlyTelemetry,
  LolaDemSample,
  LunarSite,
  LunarSiteId,
  OptimalWindowRecommendation,
} from '../models/lunar.types.js';
import { LUNAR_SITES } from '../models/lunarSites.catalog.js';
import { mergeSolarAndEarthTelemetry } from '../services/HorizonsParser.js';
import { NotFoundError, ValidationError, normalizeUtcIso } from './validators.js';

export interface MonthlySiteStats {
  readonly month: string;
  readonly totalHours: number;
  readonly daylightHours: number;
  readonly optimalLightingHours: number;
  readonly lowShadowHours: number;
  readonly directEarthLinkHours: number;
  readonly directEarthLinkPct: number;
}

export interface SiteComparisonSummary {
  readonly site: LunarSite;
  readonly totalHours: number;
  readonly daylightHours: number;
  readonly optimalLightingHours: number;
  readonly lowShadowHours: number;
  readonly directEarthLinkHours: number;
  readonly directEarthLinkPct: number;
  readonly monthly: readonly MonthlySiteStats[];
}

export interface SiteComparisonResponse {
  readonly year: number;
  readonly siteA: SiteComparisonSummary;
  readonly siteB: SiteComparisonSummary;
}

function parseIntRange(
  raw: unknown,
  defaultValue: number,
  min: number,
  max: number,
  fieldName: string,
): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new ValidationError(
      `El parámetro "${fieldName}" debe ser un entero entre ${min} y ${max}.`,
    );
  }
  return num;
}

function parseBooleanFlag(
  raw: unknown,
  defaultValue: boolean,
  fieldName: string,
): boolean {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new ValidationError(
    `El parámetro "${fieldName}" debe ser "true" o "false".`,
  );
}

function parsePositiveNumber(
  raw: unknown,
  defaultValue: number,
  maxAllowed: number,
  fieldName: string,
): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num <= 0 || num > maxAllowed) {
    throw new ValidationError(
      `El parámetro "${fieldName}" debe ser un número positivo <= ${maxAllowed}.`,
    );
  }
  return num;
}

function computeSiteSummary(
  site: LunarSite,
  telemetry: readonly HourlyTelemetry[],
): SiteComparisonSummary {
  let daylightHours = 0;
  let optimalLightingHours = 0;
  let lowShadowHours = 0;
  let directEarthLinkHours = 0;

  const monthlyMap = new Map<
    string,
    {
      totalHours: number;
      daylightHours: number;
      optimalLightingHours: number;
      lowShadowHours: number;
      directEarthLinkHours: number;
    }
  >();

  for (const row of telemetry) {
    const monthKey = row.utcIso.slice(0, 7);
    const bucket = monthlyMap.get(monthKey) ?? {
      totalHours: 0,
      daylightHours: 0,
      optimalLightingHours: 0,
      lowShadowHours: 0,
      directEarthLinkHours: 0,
    };

    bucket.totalHours++;

    if (row.solarElevationDeg > 0) {
      daylightHours++;
      bucket.daylightHours++;
      if (row.solarElevationDeg >= 3) {
        optimalLightingHours++;
        bucket.optimalLightingHours++;
      } else {
        lowShadowHours++;
        bucket.lowShadowHours++;
      }
    }

    if (row.earthElevationDeg >= 5) {
      directEarthLinkHours++;
      bucket.directEarthLinkHours++;
    }

    monthlyMap.set(monthKey, bucket);
  }

  const totalHours = telemetry.length;
  const directEarthLinkPct =
    totalHours > 0 ? Number(((directEarthLinkHours / totalHours) * 100).toFixed(2)) : 0;

  const monthly: MonthlySiteStats[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      totalHours: bucket.totalHours,
      daylightHours: bucket.daylightHours,
      optimalLightingHours: bucket.optimalLightingHours,
      lowShadowHours: bucket.lowShadowHours,
      directEarthLinkHours: bucket.directEarthLinkHours,
      directEarthLinkPct:
        bucket.totalHours > 0
          ? Number(((bucket.directEarthLinkHours / bucket.totalHours) * 100).toFixed(2))
          : 0,
    }));

  return {
    site,
    totalHours,
    daylightHours,
    optimalLightingHours,
    lowShadowHours,
    directEarthLinkHours,
    directEarthLinkPct,
    monthly,
  };
}

/**
 * Servicio encargado de cargar, cachear y consultar las efemérides NASA JPL Horizons
 * y el recorte topográfico real LOLA DEM del Polo Sur.
 */
export class TelemetryCatalogService {
  private readonly dataDir: string;
  private readonly telemetryCache = new Map<LunarSiteId, readonly HourlyTelemetry[]>();
  private lolaDemCache: LolaDemSample | null = null;

  constructor(dataDir = path.resolve(process.cwd(), 'data')) {
    this.dataDir = dataDir;
  }

  getSites(): readonly LunarSite[] {
    return LUNAR_SITES;
  }

  getSiteById(siteId: string): LunarSite {
    const site = LUNAR_SITES.find((entry) => entry.id === siteId);
    if (!site) {
      throw new NotFoundError(`Sitio lunar no encontrado: "${siteId}".`);
    }
    return site;
  }

  async getAnnualTelemetry(siteId: LunarSiteId): Promise<readonly HourlyTelemetry[]> {
    const cached = this.telemetryCache.get(siteId);
    if (cached) {
      return cached;
    }

    const site = this.getSiteById(siteId);
    const horizonsDir = path.join(this.dataDir, 'horizons');
    const [sunText, earthText] = await Promise.all([
      readFile(path.join(horizonsDir, site.solarFileName), 'utf8'),
      readFile(path.join(horizonsDir, site.earthFileName), 'utf8'),
    ]);

    const merged = mergeSolarAndEarthTelemetry(sunText, earthText);
    this.telemetryCache.set(siteId, merged);
    return merged;
  }

  async getTelemetryWindow(
    siteId: string,
    startUtc?: unknown,
    hoursParam?: unknown,
  ): Promise<{
    readonly site: LunarSite;
    readonly startUtc: string;
    readonly hours: number;
    readonly telemetry: readonly HourlyTelemetry[];
  }> {
    const site = this.getSiteById(siteId);
    const hours = parseIntRange(hoursParam, 168, 1, 720, 'hours');
    const annual = await this.getAnnualTelemetry(site.id);

    let startIndex = 0;
    if (startUtc !== undefined && String(startUtc).trim().length > 0) {
      const normalizedStart = normalizeUtcIso(startUtc, 'start');
      const startMs = Date.parse(normalizedStart);
      startIndex = annual.findIndex((row) => Date.parse(row.utcIso) === startMs);
      if (startIndex === -1) {
        throw new ValidationError(
          `No hay telemetría disponible para la fecha UTC solicitada: ${normalizedStart}.`,
        );
      }
    }

    const telemetry = annual.slice(startIndex, startIndex + hours);
    return {
      site,
      startUtc: telemetry[0]?.utcIso ?? annual[0].utcIso,
      hours: telemetry.length,
      telemetry,
    };
  }

  async getBestWindows(
    siteId: string,
    query: {
      readonly durationHours?: unknown;
      readonly hasRelaySatellite?: unknown;
      readonly batteryCapacityKwh?: unknown;
      readonly baseConsumptionKw?: unknown;
      readonly solarPanelMaxKw?: unknown;
    },
  ): Promise<{
    readonly site: LunarSite;
    readonly durationHours: number;
    readonly hasRelaySatellite: boolean;
    readonly windows: readonly OptimalWindowRecommendation[];
  }> {
    const site = this.getSiteById(siteId);
    const durationHours = parseIntRange(
      query.durationHours,
      72,
      1,
      720,
      'durationHours',
    );
    const hasRelaySatellite = parseBooleanFlag(
      query.hasRelaySatellite,
      false,
      'hasRelaySatellite',
    );
    const batteryCapacityKwh = parsePositiveNumber(
      query.batteryCapacityKwh,
      120,
      10000,
      'batteryCapacityKwh',
    );
    const baseConsumptionKw = parsePositiveNumber(
      query.baseConsumptionKw,
      1.5,
      1000,
      'baseConsumptionKw',
    );
    const solarPanelMaxKw = parsePositiveNumber(
      query.solarPanelMaxKw,
      3.5,
      1000,
      'solarPanelMaxKw',
    );

    const annual = await this.getAnnualTelemetry(site.id);
    const windows = findBestLandingWindows(
      annual,
      {
        siteId: site.id,
        durationHours,
        batteryCapacityKwh,
        baseConsumptionKw,
        solarPanelMaxKw,
        hasRelaySatellite,
      },
      3,
    );

    return {
      site,
      durationHours,
      hasRelaySatellite,
      windows,
    };
  }

  async getLolaDemSample(): Promise<LolaDemSample> {
    if (this.lolaDemCache) {
      return this.lolaDemCache;
    }

    const samplePath = path.join(this.dataDir, 'lola', 'south_pole_dem_sample.json');
    const rawJson = await readFile(samplePath, 'utf8');
    const parsed = JSON.parse(rawJson) as LolaDemSample;
    this.lolaDemCache = parsed;
    return parsed;
  }

  async compareSites(
    siteAId: unknown,
    siteBId: unknown,
  ): Promise<SiteComparisonResponse> {
    if (typeof siteAId !== 'string' || siteAId.trim().length === 0) {
      throw new ValidationError('El parámetro de consulta "siteA" es obligatorio.');
    }
    if (typeof siteBId !== 'string' || siteBId.trim().length === 0) {
      throw new ValidationError('El parámetro de consulta "siteB" es obligatorio.');
    }

    const siteA = this.getSiteById(siteAId.trim());
    const siteB = this.getSiteById(siteBId.trim());

    const [telemetryA, telemetryB] = await Promise.all([
      this.getAnnualTelemetry(siteA.id),
      this.getAnnualTelemetry(siteB.id),
    ]);

    return {
      year: 2027,
      siteA: computeSiteSummary(siteA, telemetryA),
      siteB: computeSiteSummary(siteB, telemetryB),
    };
  }
}
