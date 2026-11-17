import { calculateSlopeDegFromGrid } from '../domain/LunarGeometryService.js';
import type { LolaDemSample, LolaLabelMetadata } from '../models/lunar.types.js';

function readNumericField(lblText: string, key: string): number {
  const regex = new RegExp(`^\\s*${key}\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)`, 'm');
  const match = regex.exec(lblText);
  if (!match) {
    throw new Error(`Campo PDS faltante en etiqueta LOLA .lbl: ${key}`);
  }
  return Number(match[1]);
}

function readStringField(lblText: string, key: string): string {
  const regex = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm');
  const match = regex.exec(lblText);
  return match ? match[1].trim() : '';
}

function readScaleMetersField(lblText: string, key: string): number {
  const regex = new RegExp(
    `^\\s*${key}\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)(?:\\s*<([^>]+)>)?`,
    'm',
  );
  const match = regex.exec(lblText);
  if (!match) {
    throw new Error(`Campo PDS faltante en etiqueta LOLA .lbl: ${key}`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (unit.startsWith('km')) {
    return value * 1000;
  }
  return value;
}

/**
 * Extrae metadatos clave de proyección y escalado de la etiqueta PDS `ldem_80s_80m.lbl`.
 */
export function parseLolaPdsLabel(lblText: string): LolaLabelMetadata {
  const lines = readNumericField(lblText, 'LINES');
  const lineSamples = readNumericField(lblText, 'LINE_SAMPLES');
  const sampleBits = readNumericField(lblText, 'SAMPLE_BITS');
  const sampleType = readStringField(lblText, 'SAMPLE_TYPE') || 'LSB_INTEGER';
  const scalingFactor = readNumericField(lblText, 'SCALING_FACTOR');
  const offset = readNumericField(lblText, 'OFFSET');
  const mapScaleM = readScaleMetersField(lblText, 'MAP_SCALE');
  const minimumLatitudeDeg = readNumericField(lblText, 'MINIMUM_LATITUDE');
  const maximumLatitudeDeg = readNumericField(lblText, 'MAXIMUM_LATITUDE');

  return {
    lines,
    lineSamples,
    sampleBits,
    sampleType,
    scalingFactor,
    offset,
    mapScaleM,
    minimumLatitudeDeg,
    maximumLatitudeDeg,
  };
}

/**
 * Decodifica un bloque binario de muestras `LSB_INTEGER` de 16 bits con signo
 * a elevaciones relativas en metros: según la etiqueta PDS LOLA,
 * `HEIGHT = DN * SCALING_FACTOR` (sin sumar OFFSET, que convierte a radio planetario).
 */
export function decodeLolaInt16Samples(
  buffer: Uint8Array,
  scalingFactor = 0.5,
  offset = 0,
): number[] {
  if (buffer.byteLength % 2 !== 0) {
    throw new RangeError('El buffer LOLA int16 debe tener longitud par en bytes.');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = buffer.byteLength / 2;
  const elevations: number[] = new Array<number>(count);

  for (let i = 0; i < count; i++) {
    const rawInt16 = view.getInt16(i * 2, true);
    elevations[i] = rawInt16 * scalingFactor + offset;
  }

  return elevations;
}

/**
 * Construye el resumen estadístico y matriz 2D de elevaciones para una subventana
 * polar LOLA lista para renderizarse en el visor 3D.
 */
export function buildLolaDemSample(
  elevationsM: readonly (readonly number[])[],
  metadata: LolaLabelMetadata,
  centerLine: number,
  centerSample: number,
): LolaDemSample {
  const rows = elevationsM.length;
  const cols = rows > 0 ? elevationsM[0].length : 0;
  const cellSpacingM = Math.round(metadata.mapScaleM);

  let minElevationM = Infinity;
  let maxElevationM = -Infinity;
  let slopeSum = 0;
  let slopeCount = 0;
  let maxSlopeDeg = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = elevationsM[r][c];
      if (h < minElevationM) minElevationM = h;
      if (h > maxElevationM) maxElevationM = h;

      if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) {
        const slope = calculateSlopeDegFromGrid(
          elevationsM[r - 1][c],
          elevationsM[r + 1][c],
          elevationsM[r][c + 1],
          elevationsM[r][c - 1],
          cellSpacingM,
        );
        slopeSum += slope;
        slopeCount++;
        if (slope > maxSlopeDeg) maxSlopeDeg = slope;
      }
    }
  }

  return {
    sourceLabel: 'ldem_80s_80m.lbl',
    sourceImage: 'ldem_80s_80m.img',
    projection: 'POLAR_STEREOGRAPHIC',
    gridRows: rows,
    gridCols: cols,
    cellSpacingM,
    centerSampleIndex: { line: centerLine, sample: centerSample },
    minElevationM: Number(minElevationM.toFixed(2)),
    maxElevationM: Number(maxElevationM.toFixed(2)),
    meanSlopeDeg:
      slopeCount > 0 ? Number((slopeSum / slopeCount).toFixed(2)) : 0,
    maxSlopeDeg: Number(maxSlopeDeg.toFixed(2)),
    elevationsM,
  };
}
