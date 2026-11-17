import { describe, expect, it } from 'vitest';
import {
  LUNAR_RADIUS_KM,
  calculateHaversineLunarDistanceKm,
} from '../src/domain/LunarGeometryService.js';
import type { LolaDemSample } from '../src/models/lunar.types.js';
import {
  azElToDirectionVector,
  cartesianToLatLon,
  latLonToLunarCartesian,
  lolaGridPointToWorld,
} from '../src/views/LunarScene3D.js';

const SAMPLE_LOLA: LolaDemSample = {
  sourceLabel: 'ldem_80s_80m.lbl',
  sourceImage: 'ldem_80s_80m.img',
  projection: 'POLAR_STEREOGRAPHIC',
  gridRows: 48,
  gridCols: 48,
  cellSpacingM: 80,
  centerSampleIndex: { line: 3620, sample: 3920 },
  minElevationM: -766.5,
  maxElevationM: -238.5,
  meanSlopeDeg: 6.27,
  maxSlopeDeg: 16.75,
  elevationsM: Array.from({ length: 48 }, () => new Array<number>(48).fill(-500)),
};

describe('LunarScene3D — Matemáticas Geométricas 3D y Proyección LOLA', () => {
  it('convierte latitud/longitud a cartesiano 3D y viceversa con precisión', () => {
    const cases = [
      { latitudeDeg: 0, longitudeDeg: 0 },
      { latitudeDeg: 0.674, longitudeDeg: 23.473 },
      { latitudeDeg: -45.445, longitudeDeg: 177.599 },
      { latitudeDeg: -89.45, longitudeDeg: 130.0 },
      { latitudeDeg: -69.373, longitudeDeg: -42.5 },
    ];

    for (const point of cases) {
      const cart = latLonToLunarCartesian(point.latitudeDeg, point.longitudeDeg, 1.65);
      const norm = Math.hypot(cart.x, cart.y, cart.z);
      expect(norm).toBeCloseTo(1.65, 6);

      const roundTrip = cartesianToLatLon(cart.x, cart.y, cart.z);
      expect(roundTrip.latitudeDeg).toBeCloseTo(point.latitudeDeg, 2);
      expect(roundTrip.longitudeDeg).toBeCloseTo(point.longitudeDeg, 2);
    }
  });

  it('transforma azimut y elevación astronómica local a vector unitario 3D consistente', () => {
    const siteLat = -89.45;
    const siteLon = 130.0;
    const up = latLonToLunarCartesian(siteLat, siteLon, 1);

    // En el cenit (El = 90°), el vector debe coincidir con la normal local (Up)
    const zenith = azElToDirectionVector(42, 90, siteLat, siteLon);
    expect(Math.hypot(zenith.x, zenith.y, zenith.z)).toBeCloseTo(1, 6);
    expect(zenith.x).toBeCloseTo(up.x, 5);
    expect(zenith.y).toBeCloseTo(up.y, 5);
    expect(zenith.z).toBeCloseTo(up.z, 5);

    // Para elevación arbitraria, el producto escalar con Up debe igualar sin(elevación)
    const sunDir = azElToDirectionVector(120, 12.5, 0.674, 23.473);
    const upEq = latLonToLunarCartesian(0.674, 23.473, 1);
    const dot = sunDir.x * upEq.x + sunDir.y * upEq.y + sunDir.z * upEq.z;
    expect(Math.hypot(sunDir.x, sunDir.y, sunDir.z)).toBeCloseTo(1, 6);
    expect(dot).toBeCloseTo(Math.sin((12.5 * Math.PI) / 180), 5);
  });

  it('mapea celdas de la grilla LOLA (80 m/px) a coordenadas 3D y geodésicas consistentes con Haversine', () => {
    const centerLat = -89.45;
    const centerLon = 130.0;

    const pA = lolaGridPointToWorld(10, 10, -502.5, SAMPLE_LOLA, centerLat, centerLon);
    const pB = lolaGridPointToWorld(10, 20, -502.5, SAMPLE_LOLA, centerLat, centerLon);

    // 10 columnas a 80 m/px = 0.80 km de separación horizontal
    expect(pB.x - pA.x).toBeCloseTo(0.8, 5);
    expect(pA.z).toBeCloseTo(pB.z, 5);

    const haversineKm = calculateHaversineLunarDistanceKm(
      { latitudeDeg: pA.latitudeDeg, longitudeDeg: pA.longitudeDeg },
      { latitudeDeg: pB.latitudeDeg, longitudeDeg: pB.longitudeDeg },
    );
    expect(haversineKm).toBeCloseTo(0.8, 2);
    expect(LUNAR_RADIUS_KM).toBe(1737.4);
  });
});
