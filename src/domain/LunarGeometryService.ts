import type { Waypoint } from '../models/lunar.types.js';

/** Radio medio volumétrico oficial de la Luna en kilómetros. */
export const LUNAR_RADIUS_KM = 1737.4;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface EvaRouteMetrics {
  readonly waypointCount: number;
  readonly oneWayKm: number;
  readonly roundTripKm: number;
  readonly estimatedHours: number;
}

/**
 * Valida que las coordenadas geodésicas estén en rangos válidos:
 * latitud [-90, 90] y longitud [-180, 180].
 */
export function validateLunarCoordinates(
  latitudeDeg: number,
  longitudeDeg: number,
): boolean {
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
    return false;
  }
  return (
    latitudeDeg >= -90 &&
    latitudeDeg <= 90 &&
    longitudeDeg >= -180 &&
    longitudeDeg <= 180
  );
}

/**
 * Calcula la distancia ortodrómica entre dos puntos de la superficie lunar
 * usando la fórmula de Haversine con R_Luna = 1737.4 km.
 */
export function calculateHaversineLunarDistanceKm(
  pointA: Waypoint,
  pointB: Waypoint,
): number {
  if (
    !validateLunarCoordinates(pointA.latitudeDeg, pointA.longitudeDeg) ||
    !validateLunarCoordinates(pointB.latitudeDeg, pointB.longitudeDeg)
  ) {
    throw new RangeError('Coordenadas lunares fuera de rango válido.');
  }

  const lat1 = pointA.latitudeDeg * DEG_TO_RAD;
  const lat2 = pointB.latitudeDeg * DEG_TO_RAD;
  const deltaLat = (pointB.latitudeDeg - pointA.latitudeDeg) * DEG_TO_RAD;
  const deltaLon = (pointB.longitudeDeg - pointA.longitudeDeg) * DEG_TO_RAD;

  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return LUNAR_RADIUS_KM * c;
}

/**
 * Calcula distancia total de recorrido (ida y retorno si la ruta es abierta)
 * y duración estimada en horas para un conjunto ordenado de waypoints EVA.
 */
export function calculateEvaRouteMetrics(
  waypoints: readonly Waypoint[],
  evaSpeedKmh = 3.0,
): EvaRouteMetrics {
  if (!Number.isFinite(evaSpeedKmh) || evaSpeedKmh <= 0) {
    throw new RangeError('La velocidad EVA debe ser mayor que cero.');
  }

  if (waypoints.length < 2) {
    for (const wp of waypoints) {
      if (!validateLunarCoordinates(wp.latitudeDeg, wp.longitudeDeg)) {
        throw new RangeError('Waypoint con coordenadas lunares inválidas.');
      }
    }
    return {
      waypointCount: waypoints.length,
      oneWayKm: 0,
      roundTripKm: 0,
      estimatedHours: 0,
    };
  }

  let pathDistanceKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    pathDistanceKm += calculateHaversineLunarDistanceKm(
      waypoints[i],
      waypoints[i + 1],
    );
  }

  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const closureDistanceKm = calculateHaversineLunarDistanceKm(first, last);
  const isClosedLoop = waypoints.length >= 3 && closureDistanceKm < 0.05;

  const roundTripKm = isClosedLoop ? pathDistanceKm : pathDistanceKm * 2;
  const oneWayKm = isClosedLoop ? pathDistanceKm / 2 : pathDistanceKm;
  const estimatedHours = roundTripKm / evaSpeedKmh;

  return {
    waypointCount: waypoints.length,
    oneWayKm,
    roundTripKm,
    estimatedHours,
  };
}

/**
 * Calcula la pendiente topográfica local (en grados) por diferencias finitas
 * centrales sobre una grilla regular LOLA (80 m/píxel por defecto).
 */
export function calculateSlopeDegFromGrid(
  northM: number,
  southM: number,
  eastM: number,
  westM: number,
  cellSizeM = 80,
): number {
  if (
    !Number.isFinite(northM) ||
    !Number.isFinite(southM) ||
    !Number.isFinite(eastM) ||
    !Number.isFinite(westM) ||
    !Number.isFinite(cellSizeM) ||
    cellSizeM <= 0
  ) {
    throw new RangeError(
      'Elevaciones y resolución de celda deben ser números finitos válidos.',
    );
  }

  const dzdx = (eastM - westM) / (2 * cellSizeM);
  const dzdy = (northM - southM) / (2 * cellSizeM);
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  return slopeRad * RAD_TO_DEG;
}
