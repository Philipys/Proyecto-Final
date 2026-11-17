import type {
  BestWindowsResponse,
  CreateMissionPayload,
  LolaDemSample,
  LunarSite,
  LunarSiteId,
  MissionConfig,
  MissionEvaluation,
  MissionPlan,
  SiteComparisonResponse,
  TelemetryWindowResponse,
  UpdateMissionPayload,
} from '../models/lunar.types.js';

/** Error tipado para respuestas HTTP fallidas o errores de red del cliente REST. */
export class ApiClientError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
  }
}

export interface BestWindowsQueryParams {
  readonly durationHours: number;
  readonly hasRelaySatellite: boolean;
  readonly batteryCapacityKwh?: number;
  readonly baseConsumptionKw?: number;
  readonly solarPanelMaxKw?: number;
}

/**
 * Cliente HTTP asíncrono (`fetch`) para consumir los endpoints REST del Backend
 * (`/api/sites`, `/api/lola-dem`, `/api/missions`).
 */
export class MissionApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl = '/api', fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : (init?.headers as Record<string, string> | undefined)),
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Fallo de red inesperado.';
      throw new ApiClientError(`No se pudo conectar con la API REST: ${detail}`, 0);
    }

    const rawText = await response.text();
    let parsed: unknown = null;
    if (rawText.trim().length > 0) {
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        if (!response.ok) {
          throw new ApiClientError(
            `Error HTTP ${response.status} al consultar ${path}.`,
            response.status,
          );
        }
        throw new ApiClientError('La API devolvió una respuesta JSON inválida.', response.status);
      }
    }

    if (!response.ok) {
      const errorMessage =
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof (parsed as { error: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : `Error HTTP ${response.status} al consultar ${path}.`;
      throw new ApiClientError(errorMessage, response.status);
    }

    return parsed as T;
  }

  async getSites(): Promise<readonly LunarSite[]> {
    const data = await this.requestJson<{ readonly sites: readonly LunarSite[] }>('/sites');
    return data.sites;
  }

  async getTelemetryWindow(
    siteId: LunarSiteId,
    startUtc: string,
    hours: number,
  ): Promise<TelemetryWindowResponse> {
    const params = new URLSearchParams({
      start: startUtc,
      hours: String(hours),
    });
    return this.requestJson<TelemetryWindowResponse>(
      `/sites/${encodeURIComponent(siteId)}/telemetry?${params.toString()}`,
    );
  }

  async getBestWindows(
    siteId: LunarSiteId,
    params: BestWindowsQueryParams,
  ): Promise<BestWindowsResponse> {
    const query = new URLSearchParams({
      durationHours: String(params.durationHours),
      hasRelaySatellite: String(params.hasRelaySatellite),
    });
    if (params.batteryCapacityKwh !== undefined) {
      query.set('batteryCapacityKwh', String(params.batteryCapacityKwh));
    }
    if (params.baseConsumptionKw !== undefined) {
      query.set('baseConsumptionKw', String(params.baseConsumptionKw));
    }
    if (params.solarPanelMaxKw !== undefined) {
      query.set('solarPanelMaxKw', String(params.solarPanelMaxKw));
    }
    return this.requestJson<BestWindowsResponse>(
      `/sites/${encodeURIComponent(siteId)}/best-windows?${query.toString()}`,
    );
  }

  async compareSites(
    siteA: LunarSiteId,
    siteB: LunarSiteId,
  ): Promise<SiteComparisonResponse> {
    const query = new URLSearchParams({
      siteA,
      siteB,
    });
    return this.requestJson<SiteComparisonResponse>(`/sites/compare?${query.toString()}`);
  }

  async getLolaDemSample(): Promise<LolaDemSample> {
    return this.requestJson<LolaDemSample>('/lola-dem');
  }

  async evaluateMission(config: MissionConfig): Promise<MissionEvaluation> {
    return this.requestJson<MissionEvaluation>('/missions/evaluate', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async listMissions(): Promise<readonly MissionPlan[]> {
    const data = await this.requestJson<{ readonly missions: readonly MissionPlan[] }>(
      '/missions',
    );
    return data.missions;
  }

  async getMissionById(id: string): Promise<MissionPlan> {
    return this.requestJson<MissionPlan>(`/missions/${encodeURIComponent(id)}`);
  }

  async createMission(payload: CreateMissionPayload): Promise<MissionPlan> {
    return this.requestJson<MissionPlan>('/missions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateMission(id: string, payload: UpdateMissionPayload): Promise<MissionPlan> {
    return this.requestJson<MissionPlan>(`/missions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteMission(id: string): Promise<{ readonly deleted: boolean; readonly id: string }> {
    return this.requestJson<{ readonly deleted: boolean; readonly id: string }>(
      `/missions/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    );
  }
}
