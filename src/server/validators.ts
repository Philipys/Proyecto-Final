import { validateLunarCoordinates } from '../domain/LunarGeometryService.js';
import type { LunarSiteId, MissionConfig, MissionPlan, Waypoint } from '../models/lunar.types.js';
import { LUNAR_SITES } from '../models/lunarSites.catalog.js';

const MAX_MISSION_NAME_LENGTH = 120;
const MAX_MISSION_NOTES_LENGTH = 2000;
const MAX_WAYPOINTS = 50;

/** Error controlado de validación de entrada HTTP (mapea a 400 Bad Request). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Error controlado para recursos inexistentes (mapea a 404 Not Found). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Elimina caracteres de control y etiquetas HTML/script para mitigar XSS,
 * validando además la longitud máxima permitida.
 */
export function sanitizeText(
  input: unknown,
  maxLength: number,
  fieldName = 'texto',
): string {
  if (typeof input !== 'string') {
    throw new ValidationError(`El campo "${fieldName}" debe ser una cadena de texto.`);
  }

  // eslint-disable-next-line no-control-regex
  const withoutControlChars = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const withoutScripts = withoutControlChars.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    '',
  );
  const withoutHtmlTags = withoutScripts.replace(/<[^>]*>/g, '');
  const sanitized = withoutHtmlTags
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();

  if (sanitized.length > maxLength) {
    throw new ValidationError(
      `El campo "${fieldName}" excede el máximo de ${maxLength} caracteres.`,
    );
  }

  return sanitized;
}

/** Normaliza y valida una fecha UTC ISO-8601 dentro del año 2027 (o ISO válido). */
export function normalizeUtcIso(rawUtc: unknown, fieldName = 'startUtc'): string {
  if (typeof rawUtc !== 'string' || rawUtc.trim().length === 0) {
    throw new ValidationError(`El campo "${fieldName}" es obligatorio y debe ser una fecha UTC válida.`);
  }

  const trimmed = rawUtc.trim();
  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    throw new ValidationError(`Formato de fecha UTC inválido en "${fieldName}".`);
  }

  return new Date(parsedMs).toISOString().replace('.000Z', 'Z');
}

function validateWaypoints(rawWaypoints: unknown): Waypoint[] {
  if (!Array.isArray(rawWaypoints)) {
    throw new ValidationError('El campo "waypoints" debe ser un arreglo.');
  }
  if (rawWaypoints.length > MAX_WAYPOINTS) {
    throw new ValidationError(`No se permiten más de ${MAX_WAYPOINTS} waypoints EVA por misión.`);
  }

  const waypoints: Waypoint[] = [];
  for (let i = 0; i < rawWaypoints.length; i++) {
    const wp = rawWaypoints[i];
    if (!isPlainObject(wp)) {
      throw new ValidationError(`El waypoint en posición ${i} debe ser un objeto.`);
    }

    const lat = wp.latitudeDeg;
    const lon = wp.longitudeDeg;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !validateLunarCoordinates(lat, lon)) {
      throw new ValidationError(
        `Waypoint ${i} fuera de rango lunar (latitud [-90, 90], longitud [-180, 180]).`,
      );
    }

    if (wp.elevationM !== undefined) {
      if (
        typeof wp.elevationM !== 'number' ||
        !Number.isFinite(wp.elevationM) ||
        wp.elevationM < -15000 ||
        wp.elevationM > 15000
      ) {
        throw new ValidationError(`Elevación inválida en waypoint ${i}.`);
      }
      waypoints.push({
        latitudeDeg: lat,
        longitudeDeg: lon,
        elevationM: wp.elevationM,
      });
    } else {
      waypoints.push({
        latitudeDeg: lat,
        longitudeDeg: lon,
      });
    }
  }

  return waypoints;
}

function validatePositiveFinite(
  value: unknown,
  fieldName: string,
  maxAllowed: number,
  allowZero = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`El campo "${fieldName}" debe ser un número finito.`);
  }
  if (allowZero ? value < 0 : value <= 0) {
    throw new ValidationError(
      allowZero
        ? `El campo "${fieldName}" no puede ser negativo.`
        : `El campo "${fieldName}" debe ser mayor que cero.`,
    );
  }
  if (value > maxAllowed) {
    throw new ValidationError(
      `El campo "${fieldName}" excede el límite operativo (${maxAllowed}).`,
    );
  }
  return value;
}

/** Valida que un identificador de sitio pertenezca al catálogo oficial de los 6 sitios. */
export function validateSiteId(rawSiteId: unknown): LunarSiteId {
  if (typeof rawSiteId !== 'string') {
    throw new ValidationError('El campo "siteId" es obligatorio.');
  }
  const match = LUNAR_SITES.find((site) => site.id === rawSiteId);
  if (!match) {
    throw new ValidationError(`Sitio lunar desconocido: "${rawSiteId}".`);
  }
  return match.id;
}

/** Valida una configuración completa de misión (`MissionConfig`) según RNF-01. */
export function validateMissionConfigInput(body: unknown): MissionConfig {
  if (!isPlainObject(body)) {
    throw new ValidationError('La configuración de la misión debe ser un objeto JSON.');
  }

  const siteId = validateSiteId(body.siteId);
  const startUtc = normalizeUtcIso(body.startUtc, 'startUtc');

  const durationHours = body.durationHours;
  if (
    typeof durationHours !== 'number' ||
    !Number.isInteger(durationHours) ||
    durationHours < 1 ||
    durationHours > 720
  ) {
    throw new ValidationError(
      'El campo "durationHours" debe ser un entero entre 1 y 720 horas.',
    );
  }

  const batteryCapacityKwh = validatePositiveFinite(
    body.batteryCapacityKwh,
    'batteryCapacityKwh',
    10000,
  );
  const baseConsumptionKw = validatePositiveFinite(
    body.baseConsumptionKw,
    'baseConsumptionKw',
    1000,
  );
  const solarPanelMaxKw = validatePositiveFinite(
    body.solarPanelMaxKw,
    'solarPanelMaxKw',
    1000,
    true,
  );

  if (typeof body.hasRelaySatellite !== 'boolean') {
    throw new ValidationError('El campo "hasRelaySatellite" debe ser booleano.');
  }

  let terrainSlopeDeg: number | undefined;
  if (body.terrainSlopeDeg !== undefined) {
    if (
      typeof body.terrainSlopeDeg !== 'number' ||
      !Number.isFinite(body.terrainSlopeDeg) ||
      body.terrainSlopeDeg < 0 ||
      body.terrainSlopeDeg > 90
    ) {
      throw new ValidationError(
        'El campo "terrainSlopeDeg" debe estar entre 0 y 90 grados.',
      );
    }
    terrainSlopeDeg = body.terrainSlopeDeg;
  }

  let evaSpeedKmh: number | undefined;
  if (body.evaSpeedKmh !== undefined) {
    evaSpeedKmh = validatePositiveFinite(body.evaSpeedKmh, 'evaSpeedKmh', 100);
  }

  let maxEvaRangeKm: number | undefined;
  if (body.maxEvaRangeKm !== undefined) {
    maxEvaRangeKm = validatePositiveFinite(body.maxEvaRangeKm, 'maxEvaRangeKm', 1000);
  }

  const waypoints =
    body.waypoints !== undefined ? validateWaypoints(body.waypoints) : undefined;

  return {
    siteId,
    startUtc,
    durationHours,
    batteryCapacityKwh,
    baseConsumptionKw,
    solarPanelMaxKw,
    hasRelaySatellite: body.hasRelaySatellite,
    ...(terrainSlopeDeg !== undefined ? { terrainSlopeDeg } : {}),
    ...(waypoints !== undefined ? { waypoints } : {}),
    ...(evaSpeedKmh !== undefined ? { evaSpeedKmh } : {}),
    ...(maxEvaRangeKm !== undefined ? { maxEvaRangeKm } : {}),
  };
}

export interface ValidatedMissionPayload {
  readonly name: string;
  readonly notes: string;
  readonly config: MissionConfig;
}

/** Valida el payload de creación (`POST /api/missions`) aceptando forma plana o `{ name, notes, config }`. */
export function validateCreateMissionInput(body: unknown): ValidatedMissionPayload {
  if (!isPlainObject(body)) {
    throw new ValidationError('El cuerpo de la petición debe ser un objeto JSON.');
  }

  const name = sanitizeText(body.name, MAX_MISSION_NAME_LENGTH, 'name');
  if (name.length === 0) {
    throw new ValidationError('El campo "name" es obligatorio y no puede quedar vacío.');
  }

  const notes =
    body.notes === undefined
      ? ''
      : sanitizeText(body.notes, MAX_MISSION_NOTES_LENGTH, 'notes');

  const rawConfig = isPlainObject(body.config) ? body.config : body;
  const config = validateMissionConfigInput(rawConfig);

  return { name, notes, config };
}

/**
 * Valida el payload de actualización (`PUT /api/missions/:id`), permitiendo tanto
 * envío completo como actualización parcial (p. ej. solo `notes` y `hasRelaySatellite`).
 */
export function validateUpdateMissionInput(
  body: unknown,
  existing: MissionPlan,
): ValidatedMissionPayload {
  if (!isPlainObject(body)) {
    throw new ValidationError('El cuerpo de la petición debe ser un objeto JSON.');
  }

  const name =
    body.name === undefined
      ? existing.name
      : sanitizeText(body.name, MAX_MISSION_NAME_LENGTH, 'name');
  if (name.length === 0) {
    throw new ValidationError('El campo "name" no puede quedar vacío.');
  }

  const notes =
    body.notes === undefined
      ? existing.notes
      : sanitizeText(body.notes, MAX_MISSION_NOTES_LENGTH, 'notes');

  const rawConfigSource = isPlainObject(body.config) ? body.config : body;
  const mergedRawConfig: Record<string, unknown> = {
    siteId: rawConfigSource.siteId ?? existing.config.siteId,
    startUtc: rawConfigSource.startUtc ?? existing.config.startUtc,
    durationHours: rawConfigSource.durationHours ?? existing.config.durationHours,
    batteryCapacityKwh:
      rawConfigSource.batteryCapacityKwh ?? existing.config.batteryCapacityKwh,
    baseConsumptionKw:
      rawConfigSource.baseConsumptionKw ?? existing.config.baseConsumptionKw,
    solarPanelMaxKw: rawConfigSource.solarPanelMaxKw ?? existing.config.solarPanelMaxKw,
    hasRelaySatellite:
      rawConfigSource.hasRelaySatellite ?? existing.config.hasRelaySatellite,
    terrainSlopeDeg:
      rawConfigSource.terrainSlopeDeg !== undefined
        ? rawConfigSource.terrainSlopeDeg
        : existing.config.terrainSlopeDeg,
    waypoints:
      rawConfigSource.waypoints !== undefined
        ? rawConfigSource.waypoints
        : existing.config.waypoints,
    evaSpeedKmh:
      rawConfigSource.evaSpeedKmh !== undefined
        ? rawConfigSource.evaSpeedKmh
        : existing.config.evaSpeedKmh,
    maxEvaRangeKm:
      rawConfigSource.maxEvaRangeKm !== undefined
        ? rawConfigSource.maxEvaRangeKm
        : existing.config.maxEvaRangeKm,
  };

  const config = validateMissionConfigInput(mergedRawConfig);
  return { name, notes, config };
}
