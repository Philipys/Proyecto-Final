import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateHaversineLunarDistanceKm,
  calculateSlopeDegFromGrid,
  validateLunarCoordinates,
} from '../src/domain/LunarGeometryService.js';
import { LUNAR_SITES } from '../src/models/lunarSites.catalog.js';
import {
  mergeSolarAndEarthTelemetry,
  normalizeHorizonsTimestamp,
  parseHorizonsEphemeris,
} from '../src/services/HorizonsParser.js';
import {
  decodeLolaInt16Samples,
  parseLolaPdsLabel,
} from '../src/services/LolaDemExtractor.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');

describe('HorizonsParser & LOLA DEM Extractor', () => {
  it('normaliza marcas temporales de JPL Horizons a ISO-8601 UTC', () => {
    expect(normalizeHorizonsTimestamp('2027-Jan-01 00:00')).toBe(
      '2027-01-01T00:00:00Z',
    );
    expect(normalizeHorizonsTimestamp('2027-Dec-31 23:00')).toBe(
      '2027-12-31T23:00:00Z',
    );
  });

  it('parsea filas con marcadores de presencia solar y blancos entre $$SOE y $$EOE', () => {
    const sample = [
      'Header NASA JPL Horizons',
      '$$SOE',
      '2027-Jan-01 00:00,*, , 135.2500, 12.7500,',
      '2027-Jan-01 01:00, ,m, 136.0000, -4.5000,',
      '$$EOE',
    ].join('\n');

    const rows = parseHorizonsEphemeris(sample);
    expect(rows).toHaveLength(2);
    expect(rows[0].utcIso).toBe('2027-01-01T00:00:00Z');
    expect(rows[0].azimuthDeg).toBeCloseTo(135.25, 4);
    expect(rows[0].elevationDeg).toBeCloseTo(12.75, 4);
    expect(rows[1].elevationDeg).toBeCloseTo(-4.5, 4);
  });

  it('rechaza archivos sin marcadores $$SOE / $$EOE o vacíos', () => {
    expect(() => parseHorizonsEphemeris('sin marcadores')).toThrow();
    expect(() => parseHorizonsEphemeris('$$SOE\n\n$$EOE')).toThrow();
  });

  it('decodifica muestras binarias LOLA int16 little-endian a metros', () => {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setInt16(0, -4000, true); // -2000.0 m
    view.setInt16(2, 3800, true); // +1900.0 m

    const elevations = decodeLolaInt16Samples(bytes, 0.5, 0);
    expect(elevations).toEqual([-2000, 1900]);
    expect(() => decodeLolaInt16Samples(new Uint8Array(3))).toThrow();
  });

  it('calcula pendiente topográfica y distancia Haversine con radio lunar 1737.4 km', () => {
    expect(calculateSlopeDegFromGrid(100, 100, 100, 100, 80)).toBeCloseTo(0, 5);
    // dz/dx = (80 - (-80)) / (2 * 80) = 1 -> atan(1) = 45°
    expect(calculateSlopeDegFromGrid(0, 0, 80, -80, 80)).toBeCloseTo(45, 5);

    const oneDegEquatorKm = calculateHaversineLunarDistanceKm(
      { latitudeDeg: 0, longitudeDeg: 0 },
      { latitudeDeg: 0, longitudeDeg: 1 },
    );
    expect(oneDegEquatorKm).toBeCloseTo((1737.4 * Math.PI) / 180, 3);

    expect(validateLunarCoordinates(-89.45, 130.0)).toBe(true);
    expect(validateLunarCoordinates(95, 0)).toBe(false);
    expect(validateLunarCoordinates(0, -181)).toBe(false);
  });

  it('parsea los archivos reales descargados de NASA JPL Horizons 2027 y LOLA .lbl', async () => {
    const apollo = LUNAR_SITES.find((s) => s.id === 'apollo-11')!;
    const shackleton = LUNAR_SITES.find((s) => s.id === 'shackleton-rim')!;
    const change4 = LUNAR_SITES.find((s) => s.id === 'change-4')!;

    const [apolloSun, apolloEarth, shackSun, shackEarth, c4Sun, c4Earth, lbl] =
      await Promise.all([
        readFile(path.join(DATA_DIR, 'horizons', apollo.solarFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'horizons', apollo.earthFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'horizons', shackleton.solarFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'horizons', shackleton.earthFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'horizons', change4.solarFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'horizons', change4.earthFileName), 'utf8'),
        readFile(path.join(DATA_DIR, 'lola', 'ldem_80s_80m.lbl'), 'utf8'),
      ]);

    const apolloMerged = mergeSolarAndEarthTelemetry(apolloSun, apolloEarth);
    const shackMerged = mergeSolarAndEarthTelemetry(shackSun, shackEarth);
    const c4Merged = mergeSolarAndEarthTelemetry(c4Sun, c4Earth);

    expect(apolloMerged.length).toBeGreaterThanOrEqual(8736);
    expect(shackMerged.length).toBeGreaterThanOrEqual(8736);
    expect(c4Merged.length).toBeGreaterThanOrEqual(8736);

    // Realidad física: Chang'e-4 (cara oculta) jamás tiene a la Tierra sobre el horizonte
    expect(c4Merged.every((row) => row.earthElevationDeg < 0)).toBe(true);

    // Realidad física: en el borde de Shackleton el Sol nunca sube a gran altura
    const maxShackSolar = Math.max(...shackMerged.map((r) => r.solarElevationDeg));
    expect(maxShackSolar).toBeLessThan(10);

    // Metadata PDS LOLA real
    const meta = parseLolaPdsLabel(lbl);
    expect(meta.sampleBits).toBe(16);
    expect(meta.scalingFactor).toBe(0.5);
    expect(meta.mapScaleM).toBe(80);
    expect(meta.lines).toBe(7600);
    expect(meta.lineSamples).toBe(7600);
  });
});
