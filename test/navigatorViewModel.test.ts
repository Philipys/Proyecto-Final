import { describe, expect, it } from 'vitest';
import { evaluateMissionAtStart } from '../src/domain/MissionEvaluator.js';
import type {
  BestWindowsResponse,
  CreateMissionPayload,
  HourlyTelemetry,
  LolaDemSample,
  LunarSite,
  LunarSiteId,
  MissionPlan,
  SiteComparisonResponse,
  TelemetryWindowResponse,
  UpdateMissionPayload,
} from '../src/models/lunar.types.js';
import { LUNAR_SITES } from '../src/models/lunarSites.catalog.js';
import type { BestWindowsQueryParams } from '../src/services/MissionApiClient.js';
import {
  NavigatorViewModel,
  type NavigatorApiGateway,
} from '../src/viewmodels/NavigatorViewModel.js';

function makeTelemetrySeries(
  siteId: LunarSiteId,
  startUtc: string,
  hours: number,
): HourlyTelemetry[] {
  const startMs = Date.parse(startUtc);
  const isFarSide = siteId === 'change-4';
  const rows: HourlyTelemetry[] = [];
  for (let i = 0; i < hours; i++) {
    rows.push({
      utcIso: new Date(startMs + i * 3600_000).toISOString().replace('.000Z', 'Z'),
      solarAzimuthDeg: (i * 1.5) % 360,
      solarElevationDeg: 8.5,
      earthAzimuthDeg: 180,
      earthElevationDeg: isFarSide ? -28.0 : 25.0,
    });
  }
  return rows;
}

class InMemoryNavigatorGateway implements NavigatorApiGateway {
  private readonly plans = new Map<string, MissionPlan>();
  private seq = 1;
  failNextBestWindows = false;

  async getSites(): Promise<readonly LunarSite[]> {
    return LUNAR_SITES;
  }

  async getTelemetryWindow(
    siteId: LunarSiteId,
    startUtc: string,
    hours: number,
  ): Promise<TelemetryWindowResponse> {
    const site = LUNAR_SITES.find((s) => s.id === siteId) ?? LUNAR_SITES[0];
    return {
      site,
      startUtc,
      hours,
      telemetry: makeTelemetrySeries(siteId, startUtc, hours),
    };
  }

  async getBestWindows(
    siteId: LunarSiteId,
    params: BestWindowsQueryParams,
  ): Promise<BestWindowsResponse> {
    if (this.failNextBestWindows) {
      this.failNextBestWindows = false;
      throw new Error('Fallo simulado de ventanas');
    }
    const site = LUNAR_SITES.find((s) => s.id === siteId) ?? LUNAR_SITES[0];
    return {
      site,
      durationHours: params.durationHours,
      hasRelaySatellite: params.hasRelaySatellite,
      windows: [
        {
          startUtc: '2027-06-10T00:00:00Z',
          endUtc: '2027-06-12T23:00:00Z',
          verdict: 'GO',
          viabilityScore: 98,
          daylightHours: params.durationHours,
          minBatteryPct: 100,
          directLinkPct: site.isFarSide ? 0 : 100,
        },
      ],
    };
  }

  async compareSites(
    siteAId: LunarSiteId,
    siteBId: LunarSiteId,
  ): Promise<SiteComparisonResponse> {
    const siteA = LUNAR_SITES.find((s) => s.id === siteAId) ?? LUNAR_SITES[0];
    const siteB = LUNAR_SITES.find((s) => s.id === siteBId) ?? LUNAR_SITES[3];
    return {
      year: 2027,
      siteA: {
        site: siteA,
        totalHours: 8760,
        daylightHours: 4380,
        optimalLightingHours: 4000,
        lowShadowHours: 380,
        directEarthLinkHours: 8760,
        directEarthLinkPct: 100,
        monthly: [
          {
            month: '2027-01',
            totalHours: 744,
            daylightHours: 372,
            optimalLightingHours: 340,
            lowShadowHours: 32,
            directEarthLinkHours: 744,
            directEarthLinkPct: 100,
          },
        ],
      },
      siteB: {
        site: siteB,
        totalHours: 8760,
        daylightHours: 7200,
        optimalLightingHours: 4200,
        lowShadowHours: 3000,
        directEarthLinkHours: 4380,
        directEarthLinkPct: 50,
        monthly: [
          {
            month: '2027-01',
            totalHours: 744,
            daylightHours: 610,
            optimalLightingHours: 350,
            lowShadowHours: 260,
            directEarthLinkHours: 372,
            directEarthLinkPct: 50,
          },
        ],
      },
    };
  }

  async getLolaDemSample(): Promise<LolaDemSample> {
    return {
      sourceLabel: 'ldem_80s_80m.lbl',
      sourceImage: 'ldem_80s_80m.img',
      projection: 'POLAR_STEREOGRAPHIC',
      gridRows: 4,
      gridCols: 4,
      cellSpacingM: 80,
      centerSampleIndex: { line: 3620, sample: 3920 },
      minElevationM: -700,
      maxElevationM: -300,
      meanSlopeDeg: 6.27,
      maxSlopeDeg: 14.0,
      elevationsM: Array.from({ length: 4 }, () => [-500, -450, -400, -350]),
    };
  }

  async listMissions(): Promise<readonly MissionPlan[]> {
    return Array.from(this.plans.values());
  }

  async createMission(payload: CreateMissionPayload): Promise<MissionPlan> {
    const id = `plan-${this.seq++}`;
    const series = makeTelemetrySeries(
      payload.config.siteId,
      payload.config.startUtc,
      payload.config.durationHours,
    );
    const evaluation = evaluateMissionAtStart(series, payload.config);
    const now = new Date().toISOString();
    const plan: MissionPlan = {
      id,
      name: payload.name,
      config: payload.config,
      evaluation,
      notes: payload.notes,
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(id, plan);
    return plan;
  }

  async updateMission(id: string, payload: UpdateMissionPayload): Promise<MissionPlan> {
    const existing = this.plans.get(id);
    if (!existing) {
      throw new Error(`Plan no encontrado: ${id}`);
    }
    const nextConfig = { ...existing.config, ...(payload.config ?? {}) };
    const series = makeTelemetrySeries(
      nextConfig.siteId,
      nextConfig.startUtc,
      nextConfig.durationHours,
    );
    const evaluation = evaluateMissionAtStart(series, nextConfig);
    const updated: MissionPlan = {
      ...existing,
      name: payload.name ?? existing.name,
      notes: payload.notes ?? existing.notes,
      config: nextConfig,
      evaluation,
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(id, updated);
    return updated;
  }

  async deleteMission(id: string): Promise<{ readonly deleted: boolean; readonly id: string }> {
    this.plans.delete(id);
    return { deleted: true, id };
  }
}

describe('NavigatorViewModel (MVVM Frontend)', () => {
  it('inicializa catálogo, LOLA DEM, telemetría 2027 y permite navegar horas', async () => {
    const gateway = new InMemoryNavigatorGateway();
    const vm = new NavigatorViewModel(gateway);

    let notifications = 0;
    const unsubscribe = vm.subscribe(() => {
      notifications++;
    });

    await vm.initialize();
    const state = vm.getState();

    expect(state.status).toBe('ready');
    expect(state.sites).toHaveLength(6);
    expect(state.lolaDem?.gridRows).toBe(4);
    expect(state.telemetryWindow).toHaveLength(72);
    expect(state.evaluation?.verdict).toBe('GO');
    expect(notifications).toBeGreaterThan(0);

    vm.setActiveHourOffset(15);
    expect(vm.getState().activeHourOffset).toBe(15);
    expect(vm.getState().currentHourTelemetry?.utcIso).toBe('2027-01-01T15:00:00Z');

    vm.setActiveHourOffset(999);
    expect(vm.getState().activeHourOffset).toBe(71);

    unsubscribe();
  });

  it('cambia de sitio, activa LOLA DEM en polo sur y recalcula en vivo cara oculta con/sin Relay', async () => {
    const gateway = new InMemoryNavigatorGateway();
    const vm = new NavigatorViewModel(gateway);
    await vm.initialize();

    // Sitio polar sur -> cambia automáticamente a vista LOLA_DEM
    await vm.selectSite('south-pole-895');
    expect(vm.getState().viewMode3D).toBe('LOLA_DEM');
    expect(vm.getState().selectedSiteId).toBe('south-pole-895');

    // Cara oculta (Chang'e-4) sin Relay -> NO-GO comunicaciones y vista GLOBO
    await vm.selectSite('change-4');
    expect(vm.getState().viewMode3D).toBe('GLOBE');
    expect(vm.getState().evaluation?.verdict).toBe('NO-GO');
    expect(vm.getState().evaluation?.rules.communications.status).toBe('NO-GO');

    // Activar Relay recalcula inmediatamente en dominio sin error
    await vm.updateConfig({ hasRelaySatellite: true });
    expect(vm.getState().evaluation?.rules.communications.status).toBe('GO');
    expect(vm.getState().evaluation?.verdict).toBe('GO');
  });

  it('traza waypoints EVA y detecta exceso de rango > 10 km en tiempo real', async () => {
    const gateway = new InMemoryNavigatorGateway();
    const vm = new NavigatorViewModel(gateway);
    await vm.initialize();

    vm.toggleEvaDrawMode(true);
    expect(vm.getState().evaDrawMode).toBe(true);

    // Dos puntos separados ~6 km ida (~12 km ida y vuelta > 10 km)
    vm.addWaypoint({ latitudeDeg: 0, longitudeDeg: 0, elevationM: -500 });
    vm.addWaypoint({ latitudeDeg: 0, longitudeDeg: 0.2, elevationM: -480 });

    const state = vm.getState();
    expect(state.missionConfig.waypoints).toHaveLength(2);
    expect(state.evaluation?.rules.eva.status).toBe('NO-GO');
    expect(state.evaluation?.verdict).toBe('NO-GO');

    vm.removeLastWaypoint();
    expect(vm.getState().missionConfig.waypoints).toHaveLength(1);
    expect(vm.getState().evaluation?.rules.eva.status).toBe('GO');

    // Rechaza coordenadas inválidas sin dañar ruta
    vm.addWaypoint({ latitudeDeg: 120, longitudeDeg: 0 });
    expect(vm.getState().errorMessage).toContain('Coordenadas lunares fuera de rango');

    vm.clearWaypoints();
    expect(vm.getState().missionConfig.waypoints).toHaveLength(0);
  });

  it('ejecuta el flujo CRUD completo (crear, cargar/editar, actualizar y eliminar) y el comparador', async () => {
    const gateway = new InMemoryNavigatorGateway();
    const vm = new NavigatorViewModel(gateway);
    await vm.initialize();

    await vm.selectSite('change-4');
    vm.setDraftMetadata('Plan Von Kármán', 'Sin relay inicial');

    const created = await vm.saveNewMission();
    expect(created).not.toBeNull();
    expect(created?.evaluation.verdict).toBe('NO-GO');
    expect(vm.getState().missions).toHaveLength(1);

    await vm.startEditingMission(created!);
    expect(vm.getState().editingMissionId).toBe(created!.id);

    await vm.updateConfig({ hasRelaySatellite: true });
    vm.setDraftMetadata('Plan Von Kármán v2', 'Con satélite Queqiao');

    const updated = await vm.updateSelectedMission();
    expect(updated?.evaluation.verdict).toBe('GO');
    expect(vm.getState().editingMissionId).toBeNull();

    const deleted = await vm.deleteMission(updated!.id);
    expect(deleted).toBe(true);
    expect(vm.getState().missions).toHaveLength(0);

    await vm.loadSiteComparison('apollo-11', 'shackleton-rim');
    expect(vm.getState().comparison?.siteB.daylightHours).toBe(7200);

    await vm.applyOptimalWindow('2027-06-10T00:00:00Z');
    expect(vm.getState().missionConfig.startUtc).toBe('2027-06-10T00:00:00Z');
  });
});
