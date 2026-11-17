import * as THREE from 'three';
import { LUNAR_RADIUS_KM, validateLunarCoordinates } from '../domain/LunarGeometryService.js';
import type {
  HourlyTelemetry,
  LolaDemSample,
  LunarSite,
  LunarSiteId,
  Waypoint,
} from '../models/lunar.types.js';
import type { SceneViewMode } from '../viewmodels/NavigatorViewModel.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const GLOBE_RADIUS = 1.65;
const LOLA_VERTICAL_EXAGGERATION = 1.6;

export interface Cartesian3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LatLonPoint {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
}

export interface LolaWorldPoint extends Cartesian3, LatLonPoint {}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapLongitudeDeg(lonDeg: number): number {
  let wrapped = (((lonDeg + 180) % 360) + 360) % 360 - 180;
  if (wrapped === -180 && lonDeg > 0) {
    wrapped = 180;
  }
  return wrapped;
}

/**
 * Convierte coordenadas selenográficas (latitud, longitud en grados)
 * a coordenadas cartesianas 3D en un sistema Y-up (Polo Norte +Y, Lon 0° en +Z, Lon 90°E en +X).
 */
export function latLonToLunarCartesian(
  latitudeDeg: number,
  longitudeDeg: number,
  radius = GLOBE_RADIUS,
): Cartesian3 {
  const latRad = latitudeDeg * DEG_TO_RAD;
  const lonRad = longitudeDeg * DEG_TO_RAD;
  const cosLat = Math.cos(latRad);

  return {
    x: radius * cosLat * Math.sin(lonRad),
    y: radius * Math.sin(latRad),
    z: radius * cosLat * Math.cos(lonRad),
  };
}

/** Convierte un punto cartesiano 3D sobre la esfera lunar a latitud y longitud geodésicas. */
export function cartesianToLatLon(x: number, y: number, z: number): LatLonPoint {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r === 0) {
    return { latitudeDeg: 0, longitudeDeg: 0 };
  }
  const latitudeDeg = Math.asin(clamp(y / r, -1, 1)) * RAD_TO_DEG;
  const longitudeDeg = Math.atan2(x, z) * RAD_TO_DEG;
  return {
    latitudeDeg: Number(latitudeDeg.toFixed(4)),
    longitudeDeg: Number(longitudeDeg.toFixed(4)),
  };
}

/**
 * Convierte azimut (desde el Norte hacia el Este) y elevación (sobre el horizonte)
 * medidos en un sitio lunar `(siteLatDeg, siteLonDeg)` a un vector unitario 3D en coordenadas del globo.
 */
export function azElToDirectionVector(
  azimuthDeg: number,
  elevationDeg: number,
  siteLatDeg: number,
  siteLonDeg: number,
): Cartesian3 {
  const lat = siteLatDeg * DEG_TO_RAD;
  const lon = siteLonDeg * DEG_TO_RAD;
  const az = azimuthDeg * DEG_TO_RAD;
  const el = elevationDeg * DEG_TO_RAD;

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);

  const up: Cartesian3 = {
    x: cosLat * sinLon,
    y: sinLat,
    z: cosLat * cosLon,
  };
  const east: Cartesian3 = {
    x: cosLon,
    y: 0,
    z: -sinLon,
  };
  const north: Cartesian3 = {
    x: -sinLat * sinLon,
    y: cosLat,
    z: -sinLat * cosLon,
  };

  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);

  const horizX = cosAz * north.x + sinAz * east.x;
  const horizY = cosAz * north.y + sinAz * east.y;
  const horizZ = cosAz * north.z + sinAz * east.z;

  return {
    x: cosEl * horizX + sinEl * up.x,
    y: cosEl * horizY + sinEl * up.y,
    z: cosEl * horizZ + sinEl * up.z,
  };
}

/**
 * Mapea una celda `(row, col)` y su elevación LOLA real (en metros) a coordenadas 3D
 * de la escena local (`1 unidad = 1 km`, Norte en `-Z`, Este en `+X`, Arriba en `+Y`)
 * y sus coordenadas geodésicas aproximadas centradas en `(centerLatDeg, centerLonDeg)`.
 */
export function lolaGridPointToWorld(
  row: number,
  col: number,
  elevationM: number,
  sample: LolaDemSample,
  centerLatDeg: number,
  centerLonDeg: number,
): LolaWorldPoint {
  const cellKm = sample.cellSpacingM / 1000;
  const rowCenter = (sample.gridRows - 1) / 2;
  const colCenter = (sample.gridCols - 1) / 2;
  const meanElevM = (sample.minElevationM + sample.maxElevationM) / 2;

  const eastKm = (col - colCenter) * cellKm;
  const southKm = (row - rowCenter) * cellKm;
  const northKm = -southKm;

  const rhoKm = Math.hypot(eastKm, northKm);
  let latitudeDeg = centerLatDeg;
  let longitudeDeg = centerLonDeg;

  if (rhoKm > 1e-9) {
    const c = rhoKm / LUNAR_RADIUS_KM;
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const lat0 = centerLatDeg * DEG_TO_RAD;
    const lon0 = centerLonDeg * DEG_TO_RAD;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);

    const sinLat = clamp(cosC * sinLat0 + (northKm * sinC * cosLat0) / rhoKm, -1, 1);
    const lat = Math.asin(sinLat);
    const lon =
      lon0 +
      Math.atan2(eastKm * sinC, rhoKm * cosLat0 * cosC - northKm * sinLat0 * sinC);

    latitudeDeg = clamp(lat * RAD_TO_DEG, -90, 90);
    longitudeDeg = wrapLongitudeDeg(lon * RAD_TO_DEG);
  }

  return {
    x: eastKm,
    y: ((elevationM - meanElevM) / 1000) * LOLA_VERTICAL_EXAGGERATION,
    z: southKm,
    latitudeDeg: Number(latitudeDeg.toFixed(5)),
    longitudeDeg: Number(longitudeDeg.toFixed(5)),
  };
}

/** Convierte coordenadas geodésicas de un waypoint al espacio local del terreno LOLA DEM. */
function latLonToLolaWorld(
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM: number | undefined,
  sample: LolaDemSample,
  centerLatDeg: number,
  centerLonDeg: number,
): Cartesian3 {
  const meanElevM = (sample.minElevationM + sample.maxElevationM) / 2;
  const lat0 = centerLatDeg * DEG_TO_RAD;
  const lat = latitudeDeg * DEG_TO_RAD;
  const dLon = (longitudeDeg - centerLonDeg) * DEG_TO_RAD;

  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  const cosC = clamp(sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon), -1, 1);
  const c = Math.acos(cosC);
  const sinC = Math.sin(c);
  const k = c < 1e-7 || Math.abs(sinC) < 1e-9 ? 1 : c / sinC;

  const eastKm = LUNAR_RADIUS_KM * k * cosLat * Math.sin(dLon);
  const northKm =
    LUNAR_RADIUS_KM * k * (cosLat0 * sinLat - sinLat0 * cosLat * Math.cos(dLon));
  const elev = elevationM ?? meanElevM;

  return {
    x: eastKm,
    y: ((elev - meanElevM) / 1000) * LOLA_VERTICAL_EXAGGERATION + 0.035,
    z: -northKm,
  };
}

function createProceduralLunarTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#5c636e';
    ctx.fillRect(0, 0, width, height);

    // Mares lunares y tierras altas deterministas
    let seed = 4219;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 38; i++) {
      const cx = nextRand() * width;
      const cy = height * 0.18 + nextRand() * height * 0.64;
      const rx = 18 + nextRand() * 44;
      const ry = 12 + nextRand() * 28;
      const grad = ctx.createRadialGradient(cx, cy, rx * 0.1, cx, cy, rx);
      grad.addColorStop(0, 'rgba(34, 40, 48, 0.55)');
      grad.addColorStop(1, 'rgba(34, 40, 48, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, nextRand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cráteres con borde iluminado y cuenca oscura
    for (let i = 0; i < 220; i++) {
      const cx = nextRand() * width;
      const cy = nextRand() * height;
      const r = 1.5 + nextRand() * 7.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(38, 42, 50, ${0.25 + nextRand() * 0.35})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(176, 184, 198, ${0.22 + nextRand() * 0.3})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildLolaTerrainGeometry(
  sample: LolaDemSample,
  centerLatDeg: number,
  centerLonDeg: number,
): THREE.BufferGeometry {
  const rows = sample.gridRows;
  const cols = sample.gridCols;
  const vertexCount = rows * cols;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const elevSpan = Math.max(1, sample.maxElevationM - sample.minElevationM);

  const lowColor = new THREE.Color('#273242');
  const midColor = new THREE.Color('#667487');
  const highColor = new THREE.Color('#cfd8e3');
  const tmpColor = new THREE.Color();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const elev = sample.elevationsM[r][c];
      const world = lolaGridPointToWorld(r, c, elev, sample, centerLatDeg, centerLonDeg);

      positions[idx * 3] = world.x;
      positions[idx * 3 + 1] = world.y;
      positions[idx * 3 + 2] = world.z;

      const t = clamp((elev - sample.minElevationM) / elevSpan, 0, 1);
      if (t < 0.5) {
        tmpColor.lerpColors(lowColor, midColor, t * 2);
      } else {
        tmpColor.lerpColors(midColor, highColor, (t - 0.5) * 2);
      }
      colors[idx * 3] = tmpColor.r;
      colors[idx * 3 + 1] = tmpColor.g;
      colors[idx * 3 + 2] = tmpColor.b;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface LunarSceneCallbacks {
  readonly onSelectSite: (siteId: LunarSiteId) => void;
  readonly onAddWaypoint: (waypoint: Waypoint) => void;
  readonly onHoverCoordinates?: (info: string | null) => void;
}

export interface LunarSceneRenderState {
  readonly sites: readonly LunarSite[];
  readonly selectedSiteId: LunarSiteId;
  readonly viewMode3D: SceneViewMode;
  readonly evaDrawMode: boolean;
  readonly waypoints: readonly Waypoint[];
  readonly currentHourTelemetry: HourlyTelemetry | null;
  readonly lolaDem: LolaDemSample | null;
}

/**
 * Visor Lunar 3D en Three.js (WebGL) con los 6 sitios clicables, iluminación solar
 * dinámica 2027, relieve real LOLA DEM del Polo Sur y trazado interactivo de waypoints EVA.
 */
export class LunarScene3D {
  private readonly container: HTMLElement;
  private readonly callbacks: LunarSceneCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly raycaster = new THREE.Raycaster();

  private readonly globeGroup = new THREE.Group();
  private readonly lolaGroup = new THREE.Group();
  private readonly evaGroup = new THREE.Group();
  private readonly vectorGroup = new THREE.Group();

  private globeMesh: THREE.Mesh | null = null;
  private lolaMesh: THREE.Mesh | null = null;
  private readonly siteMeshes = new Map<LunarSiteId, THREE.Mesh>();
  private readonly siteRings = new Map<LunarSiteId, THREE.Mesh>();

  private readonly sunLight = new THREE.DirectionalLight('#fff8e6', 2.6);
  private readonly earthLight = new THREE.DirectionalLight('#4aa8ff', 0.35);
  private readonly ambientLight = new THREE.AmbientLight('#8ca4c4', 0.25);

  private sunMarker: THREE.Mesh;
  private earthMarker: THREE.Mesh;

  private orbitYaw = 0.45;
  private orbitPitch = -0.35;
  private orbitDistance = 4.6;
  private isDragging = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };
  private dragMoved = false;

  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private currentState: LunarSceneRenderState | null = null;
  private lolaCacheKey = '';

  constructor(container: HTMLElement, callbacks: LunarSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);
    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.05, 100);

    this.scene.background = new THREE.Color('#06090d');
    this.scene.add(this.ambientLight);

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 30;
    this.sunLight.shadow.camera.left = -4;
    this.sunLight.shadow.camera.right = 4;
    this.sunLight.shadow.camera.top = 4;
    this.sunLight.shadow.camera.bottom = -4;
    this.scene.add(this.sunLight);
    this.scene.add(this.earthLight);

    this.sunMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#ffd166' }),
    );
    this.earthMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#38bdf8' }),
    );
    this.vectorGroup.add(this.sunMarker, this.earthMarker);

    this.scene.add(this.globeGroup);
    this.scene.add(this.lolaGroup);
    this.scene.add(this.evaGroup);
    this.scene.add(this.vectorGroup);

    this.buildStarfield();
    this.buildGlobeBase();
    this.initRenderer(width, height);
    this.bindEvents();
    this.updateCameraTransform();
    this.startLoop();
  }

  private initRenderer(width: number, height: number): void {
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute('aria-label', 'Lienzo 3D WebGL del globo lunar y relieve LOLA');
      this.container.appendChild(renderer.domElement);
      this.renderer = renderer;
    } catch {
      const fallback = document.createElement('p');
      fallback.className = 'webgl-fallback';
      fallback.textContent =
        'Visor WebGL no disponible en este entorno; utiliza los controles del HUD para operar el simulador.';
      this.container.appendChild(fallback);
    }
  }

  private buildStarfield(): void {
    const starCount = 450;
    const positions = new Float32Array(starCount * 3);
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < starCount; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = 24 + rand() * 12;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#cbd5e1',
      size: 0.09,
      sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private buildGlobeBase(): void {
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 48);
    const texture = createProceduralLunarTexture();
    const sphereMat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      metalness: 0.04,
    });
    const globe = new THREE.Mesh(sphereGeo, sphereMat);
    globe.receiveShadow = true;
    this.globeMesh = globe;
    this.globeGroup.add(globe);

    // Retícula técnica: Ecuador, meridiano primo y paralelo 80°S (región LOLA)
    const addLatitudeRing = (latDeg: number, color: string, opacity: number): void => {
      const pts: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 6) {
        const p = latLonToLunarCartesian(latDeg, lon, GLOBE_RADIUS + 0.005);
        pts.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      this.globeGroup.add(new THREE.Line(geo, mat));
    };

    addLatitudeRing(0, '#475569', 0.45);
    addLatitudeRing(-45, '#334155', 0.3);
    addLatitudeRing(-80, '#38bdf8', 0.7);
  }

  private syncSiteMarkers(sites: readonly LunarSite[], selectedSiteId: LunarSiteId): void {
    if (this.siteMeshes.size === 0) {
      for (const site of sites) {
        const pos = latLonToLunarCartesian(site.latitudeDeg, site.longitudeDeg, GLOBE_RADIUS + 0.03);
        const markerGeo = new THREE.SphereGeometry(0.048, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({
          color: site.isFarSide ? '#f59e0b' : '#38bdf8',
        });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.set(pos.x, pos.y, pos.z);
        marker.userData = { siteId: site.id };

        const ringGeo = new THREE.RingGeometry(0.068, 0.095, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: '#22c55e',
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(pos.x, pos.y, pos.z);
        ring.lookAt(pos.x * 2, pos.y * 2, pos.z * 2);

        this.siteMeshes.set(site.id, marker);
        this.siteRings.set(site.id, ring);
        this.globeGroup.add(marker, ring);
      }
    }

    for (const site of sites) {
      const marker = this.siteMeshes.get(site.id);
      const ring = this.siteRings.get(site.id);
      const isSelected = site.id === selectedSiteId;
      if (marker) {
        const mat = marker.material as THREE.MeshBasicMaterial;
        mat.color.set(isSelected ? '#22c55e' : site.isFarSide ? '#f59e0b' : '#38bdf8');
        marker.scale.setScalar(isSelected ? 1.35 : 1.0);
      }
      if (ring) {
        ring.visible = isSelected;
      }
    }
  }

  private syncLolaTerrain(state: LunarSceneRenderState): void {
    if (!state.lolaDem) {
      return;
    }

    const activeSite =
      state.sites.find((s) => s.id === state.selectedSiteId) ?? state.sites[0];
    const centerLat = activeSite?.latitudeDeg ?? -89.45;
    const centerLon = activeSite?.longitudeDeg ?? 130.0;
    const cacheKey = `${state.lolaDem.gridRows}x${state.lolaDem.gridCols}:${centerLat}:${centerLon}`;

    if (cacheKey === this.lolaCacheKey && this.lolaMesh) {
      return;
    }

    while (this.lolaGroup.children.length > 0) {
      const child = this.lolaGroup.children[0];
      this.lolaGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (!Array.isArray(child.material)) {
          child.material.dispose();
        }
      }
    }

    const terrainGeo = buildLolaTerrainGeometry(state.lolaDem, centerLat, centerLon);
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;

    const wireGeo = new THREE.WireframeGeometry(terrainGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.14,
    });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    wireframe.position.y = 0.004;

    // Marcador central del módulo de alunizaje sobre el DEM real
    const centerElev =
      state.lolaDem.elevationsM[Math.floor(state.lolaDem.gridRows / 2)]?.[
        Math.floor(state.lolaDem.gridCols / 2)
      ] ?? state.lolaDem.minElevationM;
    const landerPos = latLonToLolaWorld(
      centerLat,
      centerLon,
      centerElev,
      state.lolaDem,
      centerLat,
      centerLon,
    );
    const landerBeacon = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.14, 12),
      new THREE.MeshBasicMaterial({ color: '#22c55e' }),
    );
    landerBeacon.position.set(landerPos.x, landerPos.y + 0.06, landerPos.z);

    this.lolaMesh = terrainMesh;
    this.lolaCacheKey = cacheKey;
    this.lolaGroup.add(terrainMesh, wireframe, landerBeacon);
  }

  private syncEvaRoute(state: LunarSceneRenderState): void {
    while (this.evaGroup.children.length > 0) {
      const child = this.evaGroup.children[0];
      this.evaGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (!Array.isArray(child.material)) {
          child.material.dispose();
        }
      }
    }

    const waypoints = state.waypoints;
    if (waypoints.length === 0) {
      return;
    }

    const activeSite =
      state.sites.find((s) => s.id === state.selectedSiteId) ?? state.sites[0];
    const centerLat = activeSite?.latitudeDeg ?? -89.45;
    const centerLon = activeSite?.longitudeDeg ?? 130.0;

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      let vec: THREE.Vector3;

      if (state.viewMode3D === 'LOLA_DEM' && state.lolaDem) {
        const p = latLonToLolaWorld(
          wp.latitudeDeg,
          wp.longitudeDeg,
          wp.elevationM,
          state.lolaDem,
          centerLat,
          centerLon,
        );
        vec = new THREE.Vector3(p.x, p.y, p.z);
      } else {
        const p = latLonToLunarCartesian(wp.latitudeDeg, wp.longitudeDeg, GLOBE_RADIUS + 0.025);
        vec = new THREE.Vector3(p.x, p.y, p.z);
      }

      points.push(vec);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(state.viewMode3D === 'LOLA_DEM' ? 0.045 : 0.035, 12, 12),
        new THREE.MeshBasicMaterial({ color: i === 0 ? '#22c55e' : '#f97316' }),
      );
      pin.position.copy(vec);
      this.evaGroup.add(pin);
    }

    if (points.length >= 2) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({ color: '#f97316' });
      this.evaGroup.add(new THREE.Line(lineGeo, lineMat));
    }
  }

  private syncCelestialVectors(state: LunarSceneRenderState): void {
    const telemetry = state.currentHourTelemetry;
    const activeSite =
      state.sites.find((s) => s.id === state.selectedSiteId) ?? state.sites[0];
    const siteLat = activeSite?.latitudeDeg ?? -89.45;
    const siteLon = activeSite?.longitudeDeg ?? 130.0;

    if (!telemetry) {
      this.sunLight.position.set(5, 3, 5);
      this.sunLight.intensity = 2.0;
      this.sunMarker.visible = false;
      this.earthMarker.visible = false;
      return;
    }

    this.sunMarker.visible = true;
    this.earthMarker.visible = true;

    const sunAz = telemetry.solarAzimuthDeg * DEG_TO_RAD;
    const sunEl = telemetry.solarElevationDeg * DEG_TO_RAD;
    const earthAz = telemetry.earthAzimuthDeg * DEG_TO_RAD;
    const earthEl = telemetry.earthElevationDeg * DEG_TO_RAD;

    if (state.viewMode3D === 'LOLA_DEM') {
      const sunDist = 7.0;
      const sx = Math.cos(sunEl) * Math.sin(sunAz) * sunDist;
      const sy = Math.sin(sunEl) * sunDist;
      const sz = -Math.cos(sunEl) * Math.cos(sunAz) * sunDist;
      this.sunLight.position.set(sx, sy, sz);
      this.sunMarker.position.set(sx * 0.45, Math.max(sy * 0.45, -1.2), sz * 0.45);

      const ed = 3.2;
      const ex = Math.cos(earthEl) * Math.sin(earthAz) * ed;
      const ey = Math.sin(earthEl) * ed;
      const ez = -Math.cos(earthEl) * Math.cos(earthAz) * ed;
      this.earthLight.position.set(ex, ey, ez);
      this.earthMarker.position.set(ex, ey, ez);
    } else {
      const sunDir = azElToDirectionVector(
        telemetry.solarAzimuthDeg,
        telemetry.solarElevationDeg,
        siteLat,
        siteLon,
      );
      this.sunLight.position.set(sunDir.x * 8, sunDir.y * 8, sunDir.z * 8);
      this.sunMarker.position.set(sunDir.x * 2.8, sunDir.y * 2.8, sunDir.z * 2.8);

      const earthDir = azElToDirectionVector(
        telemetry.earthAzimuthDeg,
        telemetry.earthElevationDeg,
        siteLat,
        siteLon,
      );
      this.earthLight.position.set(earthDir.x * 6, earthDir.y * 6, earthDir.z * 6);
      this.earthMarker.position.set(earthDir.x * 2.5, earthDir.y * 2.5, earthDir.z * 2.5);
    }

    if (telemetry.solarElevationDeg <= 0) {
      this.sunLight.intensity = 0.08;
      this.ambientLight.intensity = 0.22;
      (this.sunMarker.material as THREE.MeshBasicMaterial).color.set('#64748b');
    } else if (telemetry.solarElevationDeg < 3) {
      this.sunLight.intensity = 1.9;
      this.ambientLight.intensity = 0.24;
      (this.sunMarker.material as THREE.MeshBasicMaterial).color.set('#f59e0b');
    } else {
      this.sunLight.intensity = 2.8;
      this.ambientLight.intensity = 0.3;
      (this.sunMarker.material as THREE.MeshBasicMaterial).color.set('#fde047');
    }

    (this.earthMarker.material as THREE.MeshBasicMaterial).color.set(
      telemetry.earthElevationDeg >= 5 ? '#38bdf8' : '#ef4444',
    );
  }

  /** Actualiza la escena 3D completa a partir del estado reactivo del ViewModel. */
  renderState(state: LunarSceneRenderState): void {
    const prevMode = this.currentState?.viewMode3D;
    const prevSite = this.currentState?.selectedSiteId;
    this.currentState = state;

    this.globeGroup.visible = state.viewMode3D === 'GLOBE';
    this.lolaGroup.visible = state.viewMode3D === 'LOLA_DEM';

    this.syncSiteMarkers(state.sites, state.selectedSiteId);
    this.syncLolaTerrain(state);
    this.syncEvaRoute(state);
    this.syncCelestialVectors(state);

    if (prevMode !== state.viewMode3D || prevSite !== state.selectedSiteId) {
      this.focusCameraForState(state);
    }
  }

  private focusCameraForState(state: LunarSceneRenderState): void {
    if (state.viewMode3D === 'LOLA_DEM') {
      this.orbitYaw = 0.65;
      this.orbitPitch = 0.68;
      this.orbitDistance = 4.9;
    } else {
      const site = state.sites.find((s) => s.id === state.selectedSiteId);
      if (site) {
        this.orbitYaw = site.longitudeDeg * DEG_TO_RAD;
        this.orbitPitch = clamp(site.latitudeDeg * DEG_TO_RAD, -1.25, 1.25);
      }
      this.orbitDistance = 4.3;
    }
    this.updateCameraTransform();
  }

  resetCamera(): void {
    if (this.currentState) {
      this.focusCameraForState(this.currentState);
    } else {
      this.orbitYaw = 0.45;
      this.orbitPitch = -0.35;
      this.orbitDistance = 4.6;
      this.updateCameraTransform();
    }
  }

  private updateCameraTransform(): void {
    const cosPitch = Math.cos(this.orbitPitch);
    const x = this.orbitDistance * cosPitch * Math.sin(this.orbitYaw);
    const y = this.orbitDistance * Math.sin(this.orbitPitch);
    const z = this.orbitDistance * cosPitch * Math.cos(this.orbitYaw);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  private getNormalizedPointer(event: PointerEvent): THREE.Vector2 | null {
    const targetEl = this.renderer?.domElement ?? this.container;
    const rect = targetEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private handlePointerClick(event: PointerEvent): void {
    if (!this.currentState) {
      return;
    }
    const ndc = this.getNormalizedPointer(event);
    if (!ndc) {
      return;
    }

    this.raycaster.setFromCamera(ndc, this.camera);

    if (this.currentState.viewMode3D === 'GLOBE') {
      if (!this.currentState.evaDrawMode) {
        const markers = Array.from(this.siteMeshes.values());
        const siteHits = this.raycaster.intersectObjects(markers, false);
        if (siteHits.length > 0) {
          const siteId = siteHits[0].object.userData.siteId as LunarSiteId | undefined;
          if (siteId) {
            this.callbacks.onSelectSite(siteId);
            return;
          }
        }
      } else if (this.globeMesh) {
        const globeHits = this.raycaster.intersectObject(this.globeMesh, false);
        if (globeHits.length > 0) {
          const pt = globeHits[0].point;
          const coords = cartesianToLatLon(pt.x, pt.y, pt.z);
          if (validateLunarCoordinates(coords.latitudeDeg, coords.longitudeDeg)) {
            this.callbacks.onAddWaypoint(coords);
          }
        }
      }
      return;
    }

    if (
      this.currentState.viewMode3D === 'LOLA_DEM' &&
      this.currentState.evaDrawMode &&
      this.lolaMesh &&
      this.currentState.lolaDem
    ) {
      const hits = this.raycaster.intersectObject(this.lolaMesh, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const sample = this.currentState.lolaDem;
        const activeSite =
          this.currentState.sites.find((s) => s.id === this.currentState?.selectedSiteId) ??
          this.currentState.sites[0];
        const centerLat = activeSite?.latitudeDeg ?? -89.45;
        const centerLon = activeSite?.longitudeDeg ?? 130.0;
        const cellKm = sample.cellSpacingM / 1000;
        const col = clamp(
          Math.round(hit.point.x / cellKm + (sample.gridCols - 1) / 2),
          0,
          sample.gridCols - 1,
        );
        const row = clamp(
          Math.round(hit.point.z / cellKm + (sample.gridRows - 1) / 2),
          0,
          sample.gridRows - 1,
        );
        const elevM = sample.elevationsM[row]?.[col] ?? sample.minElevationM;
        const world = lolaGridPointToWorld(row, col, elevM, sample, centerLat, centerLon);
        if (validateLunarCoordinates(world.latitudeDeg, world.longitudeDeg)) {
          this.callbacks.onAddWaypoint({
            latitudeDeg: world.latitudeDeg,
            longitudeDeg: world.longitudeDeg,
            elevationM: elevM,
          });
        }
      }
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.isDragging = true;
    this.dragMoved = false;
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
    this.lastPointerPos = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.isDragging) {
      const dx = event.clientX - this.lastPointerPos.x;
      const dy = event.clientY - this.lastPointerPos.y;
      if (
        Math.hypot(
          event.clientX - this.pointerDownPos.x,
          event.clientY - this.pointerDownPos.y,
        ) > 5
      ) {
        this.dragMoved = true;
      }

      this.orbitYaw -= dx * 0.008;
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.008, -1.45, 1.45);
      this.lastPointerPos = { x: event.clientX, y: event.clientY };
      this.updateCameraTransform();
      return;
    }

    if (this.callbacks.onHoverCoordinates && this.currentState) {
      const ndc = this.getNormalizedPointer(event);
      if (!ndc) return;
      this.raycaster.setFromCamera(ndc, this.camera);
      if (this.currentState.viewMode3D === 'GLOBE' && this.globeMesh) {
        const hits = this.raycaster.intersectObject(this.globeMesh, false);
        if (hits.length > 0) {
          const c = cartesianToLatLon(hits[0].point.x, hits[0].point.y, hits[0].point.z);
          this.callbacks.onHoverCoordinates(
            `LAT ${c.latitudeDeg.toFixed(2)}° / LON ${c.longitudeDeg.toFixed(2)}°`,
          );
          return;
        }
      } else if (
        this.currentState.viewMode3D === 'LOLA_DEM' &&
        this.lolaMesh &&
        this.currentState.lolaDem
      ) {
        const hits = this.raycaster.intersectObject(this.lolaMesh, false);
        if (hits.length > 0) {
          const sample = this.currentState.lolaDem;
          const cellKm = sample.cellSpacingM / 1000;
          const col = clamp(
            Math.round(hits[0].point.x / cellKm + (sample.gridCols - 1) / 2),
            0,
            sample.gridCols - 1,
          );
          const row = clamp(
            Math.round(hits[0].point.z / cellKm + (sample.gridRows - 1) / 2),
            0,
            sample.gridRows - 1,
          );
          const elevM = sample.elevationsM[row]?.[col] ?? sample.minElevationM;
          this.callbacks.onHoverCoordinates(`LOLA DEM [${row},${col}] · ELEV ${elevM.toFixed(1)} m`);
          return;
        }
      }
      this.callbacks.onHoverCoordinates(null);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const wasClick = this.isDragging && !this.dragMoved;
    this.isDragging = false;
    if (wasClick) {
      this.handlePointerClick(event);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.orbitDistance = clamp(this.orbitDistance + event.deltaY * 0.003, 2.3, 9.0);
    this.updateCameraTransform();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const step = 0.1;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.orbitYaw -= step;
        this.updateCameraTransform();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.orbitYaw += step;
        this.updateCameraTransform();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.orbitPitch = clamp(this.orbitPitch + step, -1.45, 1.45);
        this.updateCameraTransform();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.orbitPitch = clamp(this.orbitPitch - step, -1.45, 1.45);
        this.updateCameraTransform();
        break;
      case '+':
      case '=':
        this.orbitDistance = clamp(this.orbitDistance - 0.35, 2.3, 9.0);
        this.updateCameraTransform();
        break;
      case '-':
      case '_':
        this.orbitDistance = clamp(this.orbitDistance + 0.35, 2.3, 9.0);
        this.updateCameraTransform();
        break;
      case '0':
        this.resetCamera();
        break;
      default:
        break;
    }
  };

  private bindEvents(): void {
    const el = this.renderer?.domElement ?? this.container;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('keydown', this.onKeyDown);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  resize(): void {
    if (!this.renderer) return;
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private startLoop(): void {
    const tick = (): void => {
      if (this.renderer) {
        this.renderer.render(this.scene, this.camera);
      }
      this.animationFrameId = window.requestAnimationFrame(tick);
    };
    this.animationFrameId = window.requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
    }
    this.resizeObserver?.disconnect();
    const el = this.renderer?.domElement ?? this.container;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.renderer?.dispose();
  }
}
