import { validateLunarCoordinates } from '../domain/LunarGeometryService.js';
import { evaluateMissionWindow } from '../domain/MissionEvaluator.js';
import type {
  BestWindowsResponse,
  CreateMissionPayload,
  HourlyTelemetry,
  LolaDemSample,
  LunarSite,
  LunarSiteId,
  MissionConfig,
  MissionEvaluation,
  MissionPlan,
  OptimalWindowRecommendation,
  SiteComparisonResponse,
  TelemetryWindowResponse,
  UpdateMissionPayload,
  Waypoint,
} from '../models/lunar.types.js';
import { LUNAR_SITES, getLunarSiteById } from '../models/lunarSites.catalog.js';
import type { BestWindowsQueryParams } from '../services/MissionApiClient.js';

export type ViewModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SceneViewMode = 'GLOBE' | 'LOLA_DEM';

/** Contrato mínimo del cliente REST requerido por el ViewModel (permite inyección/mocks en tests). */
export interface NavigatorApiGateway {
  getSites(): Promise<readonly LunarSite[]>;
  getTelemetryWindow(
    siteId: LunarSiteId,
    startUtc: string,
    hours: number,
  ): Promise<TelemetryWindowResponse>;
  getBestWindows(
    siteId: LunarSiteId,
    params: BestWindowsQueryParams,
  ): Promise<BestWindowsResponse>;
  compareSites(
    siteA: LunarSiteId,
    siteB: LunarSiteId,
  ): Promise<SiteComparisonResponse>;
  getLolaDemSample(): Promise<LolaDemSample>;
  listMissions(): Promise<readonly MissionPlan[]>;
  createMission(payload: CreateMissionPayload): Promise<MissionPlan>;
  updateMission(id: string, payload: UpdateMissionPayload): Promise<MissionPlan>;
  deleteMission(id: string): Promise<{ readonly deleted: boolean; readonly id: string }>;
}

export interface NavigatorState {
  readonly status: ViewModelStatus;
  readonly errorMessage: string | null;
  readonly statusBanner: string | null;
  readonly sites: readonly LunarSite[];
  readonly selectedSiteId: LunarSiteId;
  readonly missionConfig: MissionConfig;
  readonly activeHourOffset: number;
  readonly telemetryWindow: readonly HourlyTelemetry[];
  readonly currentHourTelemetry: HourlyTelemetry | null;
  readonly evaluation: MissionEvaluation | null;
  readonly bestWindows: readonly OptimalWindowRecommendation[];
  readonly lolaDem: LolaDemSample | null;
  readonly viewMode3D: SceneViewMode;
  readonly evaDrawMode: boolean;
  readonly missions: readonly MissionPlan[];
  readonly editingMissionId: string | null;
  readonly draftMissionName: string;
  readonly draftMissionNotes: string;
  readonly comparison: SiteComparisonResponse | null;
  readonly comparisonSiteA: LunarSiteId;
  readonly comparisonSiteB: LunarSiteId;
}

export type StateListener = (state: NavigatorState) => void;

const MAX_WAYPOINTS = 50;
const DEFAULT_SITE_ID: LunarSiteId = 'shackleton-rim';
const DEFAULT_START_UTC = '2027-01-01T00:00:00Z';

function buildInitialConfig(): MissionConfig {
  const defaultSite = getLunarSiteById(DEFAULT_SITE_ID) ?? LUNAR_SITES[0];
  return {
    siteId: defaultSite.id,
    startUtc: DEFAULT_START_UTC,
    durationHours: 72,
    batteryCapacityKwh: 120,
    baseConsumptionKw: 1.5,
    solarPanelMaxKw: 3.5,
    hasRelaySatellite: false,
    terrainSlopeDeg: defaultSite.terrainSlopeDeg,
    waypoints: [],
    evaSpeedKmh: 3.0,
    maxEvaRangeKm: 10.0,
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Ocurrió un error inesperado al comunicarse con el servidor.';
}

/**
 * ViewModel central del patrón MVVM.
 * Orquesta de forma reactiva el estado de la misión, las llamadas asíncronas a la API REST
 * y el recálculo instantáneo con el motor puro del Dominio (`MissionEvaluator`).
 * Sin dependencias del DOM ni de Three.js.
 */
export class NavigatorViewModel {
  private readonly api: NavigatorApiGateway;
  private readonly listeners = new Set<StateListener>();
  private state: NavigatorState;

  constructor(api: NavigatorApiGateway) {
    this.api = api;
    this.state = {
      status: 'idle',
      errorMessage: null,
      statusBanner: null,
      sites: LUNAR_SITES,
      selectedSiteId: DEFAULT_SITE_ID,
      missionConfig: buildInitialConfig(),
      activeHourOffset: 0,
      telemetryWindow: [],
      currentHourTelemetry: null,
      evaluation: null,
      bestWindows: [],
      lolaDem: null,
      viewMode3D: 'GLOBE',
      evaDrawMode: false,
      missions: [],
      editingMissionId: null,
      draftMissionName: '',
      draftMissionNotes: '',
      comparison: null,
      comparisonSiteA: 'apollo-11',
      comparisonSiteB: 'shackleton-rim',
    };
  }

  getState(): NavigatorState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(partial: Partial<NavigatorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private resolveCurrentHourTelemetry(
    telemetryWindow: readonly HourlyTelemetry[],
    offset: number,
  ): { readonly clampedOffset: number; readonly currentHourTelemetry: HourlyTelemetry | null } {
    if (telemetryWindow.length === 0) {
      return { clampedOffset: 0, currentHourTelemetry: null };
    }
    const clampedOffset = Math.max(0, Math.min(offset, telemetryWindow.length - 1));
    return {
      clampedOffset,
      currentHourTelemetry: telemetryWindow[clampedOffset] ?? null,
    };
  }

  private evaluateLocally(
    telemetryWindow: readonly HourlyTelemetry[],
    config: MissionConfig,
  ): MissionEvaluation | null {
    if (telemetryWindow.length < config.durationHours) {
      return null;
    }
    return evaluateMissionWindow(telemetryWindow, config);
  }

  private async fetchTelemetryAndEvaluate(
    config: MissionConfig,
    preferredOffset = 0,
    refreshWindows = true,
  ): Promise<void> {
    const telemetryPromise = this.api.getTelemetryWindow(
      config.siteId,
      config.startUtc,
      config.durationHours,
    );
    const bestWindowsPromise = refreshWindows
      ? this.api.getBestWindows(config.siteId, {
          durationHours: config.durationHours,
          hasRelaySatellite: config.hasRelaySatellite,
          batteryCapacityKwh: config.batteryCapacityKwh,
          baseConsumptionKw: config.baseConsumptionKw,
          solarPanelMaxKw: config.solarPanelMaxKw,
        })
      : Promise.resolve(null);

    const [telemetryRes, windowsRes] = await Promise.all([
      telemetryPromise,
      bestWindowsPromise,
    ]);

    if (telemetryRes.telemetry.length < config.durationHours) {
      throw new Error(
        `La ventana desde ${config.startUtc} solo dispone de ${telemetryRes.telemetry.length} horas en 2027 (se requieren ${config.durationHours} h).`,
      );
    }

    const evaluation = this.evaluateLocally(telemetryRes.telemetry, config);
    const { clampedOffset, currentHourTelemetry } = this.resolveCurrentHourTelemetry(
      telemetryRes.telemetry,
      preferredOffset,
    );

    this.setState({
      status: 'ready',
      errorMessage: null,
      missionConfig: config,
      telemetryWindow: telemetryRes.telemetry,
      activeHourOffset: clampedOffset,
      currentHourTelemetry,
      evaluation,
      ...(windowsRes ? { bestWindows: windowsRes.windows } : {}),
    });
  }

  /** Inicializa catálogo, relieve LOLA DEM, planes guardados y evaluación inicial. */
  async initialize(): Promise<void> {
    this.setState({
      status: 'loading',
      errorMessage: null,
      statusBanner: 'Cargando telemetría NASA JPL Horizons 2027 y modelo LOLA DEM...',
    });

    try {
      const [sites, lolaDem, missions] = await Promise.all([
        this.api.getSites(),
        this.api.getLolaDemSample(),
        this.api.listMissions(),
      ]);

      const selectedSite =
        sites.find((s) => s.id === this.state.selectedSiteId) ?? sites[0] ?? LUNAR_SITES[0];
      const config: MissionConfig = {
        ...this.state.missionConfig,
        siteId: selectedSite.id,
        terrainSlopeDeg: selectedSite.terrainSlopeDeg,
      };

      this.setState({
        sites,
        selectedSiteId: selectedSite.id,
        lolaDem,
        missions,
        missionConfig: config,
      });

      await this.fetchTelemetryAndEvaluate(config, 0, true);
      this.setState({
        statusBanner: 'Consola sincronizada con efemérides NASA 2027 y BD SQLite.',
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
    }
  }

  /** Cambia el sitio lunar activo, ajusta el modo 3D y recarga telemetría + ventanas óptimas. */
  async selectSite(siteId: LunarSiteId): Promise<void> {
    const site =
      this.state.sites.find((s) => s.id === siteId) ?? getLunarSiteById(siteId);
    if (!site) {
      this.setState({ errorMessage: `Sitio lunar desconocido: ${siteId}` });
      return;
    }

    const nextViewMode: SceneViewMode = site.latitudeDeg <= -80 ? 'LOLA_DEM' : 'GLOBE';
    const nextConfig: MissionConfig = {
      ...this.state.missionConfig,
      siteId: site.id,
      terrainSlopeDeg: site.terrainSlopeDeg,
      waypoints: [],
    };

    this.setState({
      status: 'loading',
      errorMessage: null,
      selectedSiteId: site.id,
      viewMode3D: nextViewMode,
      evaDrawMode: false,
      statusBanner: `Cargando efemérides 2027 para ${site.name}...`,
    });

    try {
      await this.fetchTelemetryAndEvaluate(nextConfig, 0, true);
      this.setState({
        statusBanner: `Sitio activo: ${site.name}.`,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
    }
  }

  /**
   * Actualiza parámetros de configuración de misión.
   * Recarga ventana del servidor solo si cambian `startUtc` o `durationHours`;
   * en caso contrario recalcula inmediatamente en memoria con el Dominio.
   */
  async updateConfig(
    patch: Partial<Omit<MissionConfig, 'siteId' | 'waypoints'>>,
  ): Promise<void> {
    const prev = this.state.missionConfig;
    const nextConfig: MissionConfig = {
      ...prev,
      ...patch,
    };

    if (!Number.isInteger(nextConfig.durationHours) || nextConfig.durationHours < 1 || nextConfig.durationHours > 720) {
      this.setState({
        errorMessage: 'La duración de la misión debe ser un entero entre 1 y 720 horas.',
      });
      return;
    }
    if (!Number.isFinite(nextConfig.batteryCapacityKwh) || nextConfig.batteryCapacityKwh <= 0) {
      this.setState({ errorMessage: 'La capacidad de batería debe ser mayor que 0 kWh.' });
      return;
    }
    if (!Number.isFinite(nextConfig.baseConsumptionKw) || nextConfig.baseConsumptionKw <= 0) {
      this.setState({ errorMessage: 'El consumo base debe ser mayor que 0 kW.' });
      return;
    }
    if (!Number.isFinite(nextConfig.solarPanelMaxKw) || nextConfig.solarPanelMaxKw < 0) {
      this.setState({ errorMessage: 'La potencia solar máxima no puede ser negativa.' });
      return;
    }

    const windowChanged =
      nextConfig.startUtc !== prev.startUtc ||
      nextConfig.durationHours !== prev.durationHours;

    if (windowChanged) {
      this.setState({
        status: 'loading',
        errorMessage: null,
        statusBanner: 'Sincronizando ventana horaria 2027...',
      });
      try {
        await this.fetchTelemetryAndEvaluate(nextConfig, 0, true);
        this.setState({ statusBanner: 'Ventana de misión actualizada.' });
      } catch (error) {
        this.setState({
          status: 'error',
          errorMessage: extractErrorMessage(error),
          statusBanner: null,
        });
      }
      return;
    }

    const evaluation = this.evaluateLocally(this.state.telemetryWindow, nextConfig);
    this.setState({
      errorMessage: null,
      missionConfig: nextConfig,
      evaluation,
    });
  }

  /** Desplaza la hora activa de simulación (0..durationHours-1) para mover el vector solar 3D. */
  setActiveHourOffset(hourOffset: number): void {
    const rounded = Math.trunc(hourOffset);
    const { clampedOffset, currentHourTelemetry } = this.resolveCurrentHourTelemetry(
      this.state.telemetryWindow,
      rounded,
    );
    this.setState({
      activeHourOffset: clampedOffset,
      currentHourTelemetry,
    });
  }

  setViewMode3D(mode: SceneViewMode): void {
    this.setState({ viewMode3D: mode });
  }

  toggleEvaDrawMode(enabled?: boolean): void {
    const next = enabled ?? !this.state.evaDrawMode;
    this.setState({
      evaDrawMode: next,
      statusBanner: next
        ? 'Modo trazado EVA activo: haz clic sobre la superficie lunar 3D para añadir waypoints.'
        : 'Modo trazado EVA desactivado.',
    });
  }

  /** Agrega un waypoint EVA validando coordenadas y recalcula las 5 reglas al instante. */
  addWaypoint(wp: Waypoint): void {
    if (!validateLunarCoordinates(wp.latitudeDeg, wp.longitudeDeg)) {
      this.setState({
        errorMessage: 'Coordenadas lunares fuera de rango (lat [-90, 90], lon [-180, 180]).',
      });
      return;
    }

    const existing = this.state.missionConfig.waypoints ?? [];
    if (existing.length >= MAX_WAYPOINTS) {
      this.setState({
        errorMessage: `Máximo permitido de ${MAX_WAYPOINTS} waypoints EVA por misión.`,
      });
      return;
    }

    const cleanWaypoint: Waypoint = {
      latitudeDeg: Number(wp.latitudeDeg.toFixed(4)),
      longitudeDeg: Number(wp.longitudeDeg.toFixed(4)),
      ...(wp.elevationM !== undefined && Number.isFinite(wp.elevationM)
        ? { elevationM: Number(wp.elevationM.toFixed(1)) }
        : {}),
    };

    const nextConfig: MissionConfig = {
      ...this.state.missionConfig,
      waypoints: [...existing, cleanWaypoint],
    };
    const evaluation = this.evaluateLocally(this.state.telemetryWindow, nextConfig);

    this.setState({
      errorMessage: null,
      missionConfig: nextConfig,
      evaluation,
      statusBanner: `Waypoint EVA #${nextConfig.waypoints?.length ?? 0} añadido (${cleanWaypoint.latitudeDeg.toFixed(2)}°, ${cleanWaypoint.longitudeDeg.toFixed(2)}°).`,
    });
  }

  removeLastWaypoint(): void {
    const existing = this.state.missionConfig.waypoints ?? [];
    if (existing.length === 0) {
      return;
    }

    const nextConfig: MissionConfig = {
      ...this.state.missionConfig,
      waypoints: existing.slice(0, -1),
    };
    const evaluation = this.evaluateLocally(this.state.telemetryWindow, nextConfig);

    this.setState({
      errorMessage: null,
      missionConfig: nextConfig,
      evaluation,
      statusBanner: `Waypoint eliminado (${nextConfig.waypoints?.length ?? 0} restantes).`,
    });
  }

  clearWaypoints(): void {
    const nextConfig: MissionConfig = {
      ...this.state.missionConfig,
      waypoints: [],
    };
    const evaluation = this.evaluateLocally(this.state.telemetryWindow, nextConfig);

    this.setState({
      errorMessage: null,
      missionConfig: nextConfig,
      evaluation,
      statusBanner: 'Ruta EVA reiniciada.',
    });
  }

  /** Aplica una fecha óptima recomendada de 2027 sobre la simulación activa. */
  async applyOptimalWindow(startUtc: string): Promise<void> {
    await this.updateConfig({ startUtc });
    if (this.state.errorMessage === null) {
      this.setState({
        statusBanner: `Ventana óptima aplicada: ${startUtc}.`,
      });
    }
  }

  async refreshBestWindows(): Promise<void> {
    const config = this.state.missionConfig;
    this.setState({
      status: 'loading',
      errorMessage: null,
      statusBanner: 'Calculando las 3 mejores ventanas de alunizaje en 2027...',
    });

    try {
      const response = await this.api.getBestWindows(config.siteId, {
        durationHours: config.durationHours,
        hasRelaySatellite: config.hasRelaySatellite,
        batteryCapacityKwh: config.batteryCapacityKwh,
        baseConsumptionKw: config.baseConsumptionKw,
        solarPanelMaxKw: config.solarPanelMaxKw,
      });

      this.setState({
        status: 'ready',
        bestWindows: response.windows,
        statusBanner: `Ventanas óptimas actualizadas para ${response.site.name}.`,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
    }
  }

  setDraftMetadata(name: string, notes: string): void {
    this.setState({
      draftMissionName: name,
      draftMissionNotes: notes,
    });
  }

  /** Crea y persiste un nuevo plan de misión en SQLite (`POST /api/missions`). */
  async saveNewMission(): Promise<MissionPlan | null> {
    const trimmedName = this.state.draftMissionName.trim();
    if (trimmedName.length === 0) {
      this.setState({
        errorMessage: 'Debes ingresar un nombre para guardar el plan de misión.',
      });
      return null;
    }

    this.setState({
      status: 'loading',
      errorMessage: null,
      statusBanner: 'Guardando plan de misión en SQLite...',
    });

    try {
      const created = await this.api.createMission({
        name: trimmedName,
        notes: this.state.draftMissionNotes.trim(),
        config: this.state.missionConfig,
      });

      const missions = await this.api.listMissions();
      this.setState({
        status: 'ready',
        missions,
        editingMissionId: null,
        draftMissionName: '',
        draftMissionNotes: '',
        evaluation: created.evaluation,
        statusBanner: `Plan "${created.name}" guardado con dictamen ${created.evaluation.verdict}.`,
      });
      return created;
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
      return null;
    }
  }

  /** Carga un plan existente en la consola y escena 3D para inspección o edición. */
  async startEditingMission(plan: MissionPlan): Promise<void> {
    const site =
      this.state.sites.find((s) => s.id === plan.config.siteId) ??
      getLunarSiteById(plan.config.siteId);
    const nextViewMode: SceneViewMode =
      site && site.latitudeDeg <= -80 ? 'LOLA_DEM' : 'GLOBE';

    this.setState({
      status: 'loading',
      errorMessage: null,
      selectedSiteId: plan.config.siteId,
      viewMode3D: nextViewMode,
      editingMissionId: plan.id,
      draftMissionName: plan.name,
      draftMissionNotes: plan.notes,
      statusBanner: `Cargando plan "${plan.name}" para edición...`,
    });

    try {
      await this.fetchTelemetryAndEvaluate(plan.config, 0, true);
      this.setState({
        statusBanner: `Editando plan "${plan.name}".`,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
    }
  }

  cancelEditingMission(): void {
    this.setState({
      editingMissionId: null,
      draftMissionName: '',
      draftMissionNotes: '',
      errorMessage: null,
      statusBanner: 'Edición cancelada.',
    });
  }

  /** Actualiza el plan en edición en SQLite con recálculo autoritativo (`PUT /api/missions/:id`). */
  async updateSelectedMission(): Promise<MissionPlan | null> {
    const editingId = this.state.editingMissionId;
    if (!editingId) {
      this.setState({ errorMessage: 'No hay ningún plan seleccionado para actualizar.' });
      return null;
    }

    const trimmedName = this.state.draftMissionName.trim();
    if (trimmedName.length === 0) {
      this.setState({
        errorMessage: 'El nombre del plan de misión no puede quedar vacío.',
      });
      return null;
    }

    this.setState({
      status: 'loading',
      errorMessage: null,
      statusBanner: 'Actualizando plan de misión y recalculando reglas en servidor...',
    });

    try {
      const updated = await this.api.updateMission(editingId, {
        name: trimmedName,
        notes: this.state.draftMissionNotes.trim(),
        config: this.state.missionConfig,
      });

      const missions = await this.api.listMissions();
      this.setState({
        status: 'ready',
        missions,
        editingMissionId: null,
        draftMissionName: '',
        draftMissionNotes: '',
        evaluation: updated.evaluation,
        statusBanner: `Plan "${updated.name}" actualizado (${updated.evaluation.verdict}).`,
      });
      return updated;
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
      return null;
    }
  }

  /** Elimina un plan de misión de SQLite (`DELETE /api/missions/:id`). */
  async deleteMission(id: string): Promise<boolean> {
    this.setState({
      status: 'loading',
      errorMessage: null,
      statusBanner: 'Eliminando plan de misión...',
    });

    try {
      await this.api.deleteMission(id);
      const missions = await this.api.listMissions();
      const clearedEdit = this.state.editingMissionId === id;

      this.setState({
        status: 'ready',
        missions,
        ...(clearedEdit
          ? {
              editingMissionId: null,
              draftMissionName: '',
              draftMissionNotes: '',
            }
          : {}),
        statusBanner: 'Plan de misión eliminado de SQLite.',
      });
      return true;
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
      return false;
    }
  }

  /** Carga la comparativa mensual 2027 entre dos sitios lunares (`GET /api/sites/compare`). */
  async loadSiteComparison(
    siteA: LunarSiteId = this.state.comparisonSiteA,
    siteB: LunarSiteId = this.state.comparisonSiteB,
  ): Promise<void> {
    this.setState({
      status: 'loading',
      errorMessage: null,
      comparisonSiteA: siteA,
      comparisonSiteB: siteB,
      statusBanner: 'Comparando telemetría anual 2027 entre sitios...',
    });

    try {
      const comparison = await this.api.compareSites(siteA, siteB);
      this.setState({
        status: 'ready',
        comparison,
        statusBanner: `Comparativa 2027 lista: ${comparison.siteA.site.name} vs ${comparison.siteB.site.name}.`,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: extractErrorMessage(error),
        statusBanner: null,
      });
    }
  }
}
