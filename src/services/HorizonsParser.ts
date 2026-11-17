import type { HourlyTelemetry, HorizonsRow } from '../models/lunar.types.js';

const MONTHS: Readonly<Record<string, string>> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/**
 * Normaliza marcas temporales de JPL Horizons (ej. "2027-Jan-01 00:00")
 * o fechas ISO ya formateadas a ISO-8601 UTC ("2027-01-01T00:00:00Z").
 */
export function normalizeHorizonsTimestamp(rawTimestamp: string): string {
  const trimmed = rawTimestamp.trim();
  const jplMatch = /^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    trimmed,
  );

  if (jplMatch) {
    const [, year, monthAbbr, day, hour, minute, second = '00'] = jplMatch;
    const monthNum = MONTHS[monthAbbr];
    if (!monthNum) {
      throw new Error(`Mes inválido en efeméride Horizons: ${monthAbbr}`);
    }
    return `${year}-${monthNum}-${day}T${hour}:${minute}:${second}Z`;
  }

  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) {
    throw new Error(`Formato de fecha UTC inválido en Horizons: "${rawTimestamp}"`);
  }
  return new Date(parsedMs).toISOString().replace('.000Z', 'Z');
}

/**
 * Parsea un archivo de texto generado por NASA JPL Horizons (`$$SOE` ... `$$EOE`)
 * con `QUANTITIES='4'` y `CSV_FORMAT='YES'`.
 */
export function parseHorizonsEphemeris(rawText: string): HorizonsRow[] {
  const soeIndex = rawText.indexOf('$$SOE');
  const eoeIndex = rawText.indexOf('$$EOE');

  if (soeIndex === -1 || eoeIndex === -1 || eoeIndex <= soeIndex) {
    throw new Error(
      'Formato Horizons inválido: faltan marcadores obligatorios $$SOE / $$EOE.',
    );
  }

  const body = rawText.slice(soeIndex + '$$SOE'.length, eoeIndex);
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error('Bloque $$SOE/$$EOE vacío: no hay filas de efemérides.');
  }

  const rows: HorizonsRow[] = [];
  for (const line of lines) {
    const parts = line.split(',').map((token) => token.trim());
    if (parts.length < 3) {
      throw new Error(`Fila Horizons malformada: "${line}"`);
    }

    const rawTimestamp = parts[0];
    const utcIso = normalizeHorizonsTimestamp(rawTimestamp);

    // En formato CSV de Horizons (QUANTITIES=4) suele haber 2 columnas de flags
    // entre fecha y azimut/elevación (p.ej. `fecha, , , 123.4, -5.6,`).
    const numericValues: number[] = [];
    for (let i = 1; i < parts.length; i++) {
      const token = parts[i];
      if (token.length === 0) continue;
      const num = Number(token);
      if (Number.isFinite(num)) {
        numericValues.push(num);
      }
    }

    if (numericValues.length < 2) {
      throw new Error(
        `No se encontraron valores numéricos de azimut/elevación en fila: "${line}"`,
      );
    }

    rows.push({
      utcIso,
      rawTimestamp,
      azimuthDeg: numericValues[0],
      elevationDeg: numericValues[1],
    });
  }

  return rows;
}

/**
 * Combina las series horarias del Sol (COMMAND=10) y de la Tierra (COMMAND=399)
 * emparejando por marca temporal UTC exacta.
 */
export function mergeSolarAndEarthTelemetry(
  sunRawText: string,
  earthRawText: string,
): HourlyTelemetry[] {
  const sunRows = parseHorizonsEphemeris(sunRawText);
  const earthRows = parseHorizonsEphemeris(earthRawText);

  const earthMap = new Map<string, HorizonsRow>();
  for (const row of earthRows) {
    earthMap.set(row.utcIso, row);
  }

  const merged: HourlyTelemetry[] = [];
  for (const sunRow of sunRows) {
    const earthRow = earthMap.get(sunRow.utcIso);
    if (!earthRow) {
      throw new Error(
        `Desincronización de efemérides: falta registro de Tierra para ${sunRow.utcIso}`,
      );
    }
    merged.push({
      utcIso: sunRow.utcIso,
      solarAzimuthDeg: sunRow.azimuthDeg,
      solarElevationDeg: sunRow.elevationDeg,
      earthAzimuthDeg: earthRow.azimuthDeg,
      earthElevationDeg: earthRow.elevationDeg,
    });
  }

  return merged;
}
