import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LUNAR_SITES } from '../models/lunarSites.catalog.js';
import {
  buildLolaDemSample,
  decodeLolaInt16Samples,
  parseLolaPdsLabel,
} from './LolaDemExtractor.js';

interface DownloadTarget {
  readonly fileName: string;
  readonly url: string;
}

const LOLA_LBL_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.lbl';
const LOLA_IMG_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.img';

function buildHorizonsTargets(): DownloadTarget[] {
  const targets: DownloadTarget[] = [];
  for (const site of LUNAR_SITES) {
    const coord = `${site.longitudeDeg},${site.latitudeDeg},0`;
    targets.push({
      fileName: site.solarFileName,
      url: `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='10'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='${coord}'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'`,
    });
    targets.push({
      fileName: site.earthFileName,
      url: `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='399'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='coord@301'&COORD_TYPE='GEODETIC'&SITE_COORD='${coord}'&START_TIME='2027-01-01'&STOP_TIME='2027-12-31'&STEP_SIZE='1h'&QUANTITIES='4'&CSV_FORMAT='YES'`,
    });
  }
  return targets;
}

async function fileExistsAndValid(filePath: string, marker?: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (info.size === 0) return false;
    if (!marker) return true;
    const text = await readFile(filePath, 'utf8');
    return text.includes(marker);
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} al descargar ${url}`);
  }
  return response.text();
}

async function downloadHorizonsDatasets(horizonsDir: string): Promise<void> {
  await mkdir(horizonsDir, { recursive: true });
  const targets = buildHorizonsTargets();

  for (const target of targets) {
    const outPath = path.join(horizonsDir, target.fileName);
    if (await fileExistsAndValid(outPath, '$$EOE')) {
      console.info(`[SKIP] ${target.fileName} ya existe y es válido.`);
      continue;
    }

    console.info(`[GET] Descargando ${target.fileName}...`);
    const text = await fetchText(target.url);
    if (!text.includes('$$SOE') || !text.includes('$$EOE')) {
      throw new Error(`La respuesta para ${target.fileName} no contiene $$SOE/$$EOE.`);
    }
    await writeFile(outPath, text, 'utf8');
  }
}

async function downloadAndSampleLola(lolaDir: string): Promise<void> {
  await mkdir(lolaDir, { recursive: true });
  const lblPath = path.join(lolaDir, 'ldem_80s_80m.lbl');

  let lblText: string;
  if (await fileExistsAndValid(lblPath, 'LINES')) {
    lblText = await readFile(lblPath, 'utf8');
    console.info('[SKIP] ldem_80s_80m.lbl ya existe.');
  } else {
    console.info('[GET] Descargando etiqueta PDS ldem_80s_80m.lbl...');
    lblText = await fetchText(LOLA_LBL_URL);
    await writeFile(lblPath, lblText, 'utf8');
  }

  const sampleJsonPath = path.join(lolaDir, 'south_pole_dem_sample.json');
  const forceRefresh = process.argv.includes('--force');
  if (!forceRefresh && (await fileExistsAndValid(sampleJsonPath, 'elevationsM'))) {
    console.info('[SKIP] south_pole_dem_sample.json ya existe.');
    return;
  }

  const metadata = parseLolaPdsLabel(lblText);
  const gridSize = 48;
  // Subventana centrada cerca del borde del cráter Shackleton (~89.45°S) y Polo Sur
  // Cada píxel = 80 m -> 48x48 cubre ~3.84 km x 3.84 km de relieve real LOLA
  const centerLine = Math.floor(metadata.lines / 2) - 180;
  const centerSample = Math.floor(metadata.lineSamples / 2) + 120;
  const startLine = centerLine - Math.floor(gridSize / 2);
  const startSample = centerSample - Math.floor(gridSize / 2);
  const bytesPerSample = metadata.sampleBits / 8;
  const rowWidthBytes = metadata.lineSamples * bytesPerSample;
  const sliceWidthBytes = gridSize * bytesPerSample;

  console.info(
    `[GET] Extrayendo ventana real ${gridSize}x${gridSize} del binario LOLA (.img) vía HTTP Range...`,
  );

  const elevationsM: number[][] = [];
  for (let r = 0; r < gridSize; r++) {
    const lineIndex = startLine + r;
    const byteStart = lineIndex * rowWidthBytes + startSample * bytesPerSample;
    const byteEnd = byteStart + sliceWidthBytes - 1;

    const response = await fetch(LOLA_IMG_URL, {
      headers: { Range: `bytes=${byteStart}-${byteEnd}` },
    });

    if (response.status !== 206) {
      throw new Error(
        `El servidor PDS devolvió HTTP ${response.status} en petición Range (se esperaba 206 Partial Content).`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    // Usar offset=0 para obtener HEIGHT relativa en metros (según PDS3: HEIGHT = DN * SCALING_FACTOR)
    const rowValues = decodeLolaInt16Samples(
      new Uint8Array(arrayBuffer),
      metadata.scalingFactor,
      0,
    );
    elevationsM.push(rowValues);
  }

  const demSample = buildLolaDemSample(
    elevationsM,
    metadata,
    centerLine,
    centerSample,
  );
  await writeFile(sampleJsonPath, JSON.stringify(demSample, null, 2), 'utf8');
  console.info(
    `[OK] Grilla real LOLA guardada (min=${demSample.minElevationM} m, max=${demSample.maxElevationM} m, pendiente media=${demSample.meanSlopeDeg}°).`,
  );
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  await downloadHorizonsDatasets(path.join(rootDir, 'data', 'horizons'));
  await downloadAndSampleLola(path.join(rootDir, 'data', 'lola'));
  console.info('[DONE] Descarga y verificación de datasets NASA finalizada.');
}

main().catch((err: unknown) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
