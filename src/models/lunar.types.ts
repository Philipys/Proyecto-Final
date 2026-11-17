export type LunarSiteId =
  | 'apollo-11'
  | 'chandrayaan-3'
  | 'im1-odysseus'
  | 'shackleton-rim'
  | 'south-pole-895'
  | 'change-4';

export interface LunarSite {
  readonly id: LunarSiteId;
  readonly name: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly terrainSlopeDeg: number;
  readonly isFarSide: boolean;
  readonly description: string;
  readonly solarFileName: string;
  readonly earthFileName: string;
}

export interface HorizonsRow {
  readonly utcIso: string;
  readonly rawTimestamp: string;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

export interface HourlyTelemetry {
  readonly utcIso: string;
  readonly solarAzimuthDeg: number;
  readonly solarElevationDeg: number;
  readonly earthAzimuthDeg: number;
  readonly earthElevationDeg: number;
}

export type LightingState = 'NIGHT' | 'LOW_SHADOWS' | 'OPTIMAL';
export type RuleVerdict = 'GO' | 'CAUTION' | 'NO-GO';

export interface Waypoint {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationM?: number;
}

export interface MissionConfig {
  readonly siteId: LunarSiteId;
  readonly startUtc: string;
  readonly durationHours: number;
  readonly batteryCapacityKwh: number;
  readonly baseConsumptionKw: number;
  readonly solarPanelMaxKw: number;
  readonly hasRelaySatellite: boolean;
  readonly terrainSlopeDeg?: number;
  readonly waypoints?: readonly Waypoint[];
  readonly evaSpeedKmh?: number;
  readonly maxEvaRangeKm?: number;
}

export interface LightingRuleResult {
  readonly status: RuleVerdict;
  readonly landingState: LightingState;
  readonly landingSolarElevationDeg: number;
  readonly minSolarElevationDeg: number;
  readonly maxSolarElevationDeg: number;
  readonly daylightHours: number;
  readonly lowShadowHours: number;
  readonly reason: string;
}

export interface EnergyRuleResult {
  readonly status: RuleVerdict;
  readonly minBatteryPct: number;
  readonly finalBatteryPct: number;
  readonly firstCriticalHour: number | null;
  readonly blackoutHours: number;
  readonly hourlySocPct: readonly number[];
  readonly reason: string;
}

export interface CommunicationsRuleResult {
  readonly status: RuleVerdict;
  readonly directLinkHours: number;
  readonly directLinkPct: number;
  readonly relayActive: boolean;
  readonly reason: string;
}

export interface TerrainRuleResult {
  readonly status: RuleVerdict;
  readonly slopeDeg: number;
  readonly reason: string;
}

export interface EvaRuleResult {
  readonly status: RuleVerdict;
  readonly waypointCount: number;
  readonly oneWayKm: number;
  readonly roundTripKm: number;
  readonly estimatedHours: number;
  readonly safeWindowHours: number;
  readonly marginBeforeNightHours: number;
  readonly reason: string;
}

export interface MissionEvaluation {
  readonly verdict: RuleVerdict;
  readonly viabilityScore: number;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly rules: {
    readonly lighting: LightingRuleResult;
    readonly energy: EnergyRuleResult;
    readonly communications: CommunicationsRuleResult;
    readonly terrain: TerrainRuleResult;
    readonly eva: EvaRuleResult;
  };
}

export interface OptimalWindowRecommendation {
  readonly startUtc: string;
  readonly endUtc: string;
  readonly verdict: RuleVerdict;
  readonly viabilityScore: number;
  readonly daylightHours: number;
  readonly minBatteryPct: number;
  readonly directLinkPct: number;
}

export interface MissionPlan {
  readonly id: string;
  readonly name: string;
  readonly config: MissionConfig;
  readonly evaluation: MissionEvaluation;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LolaLabelMetadata {
  readonly lines: number;
  readonly lineSamples: number;
  readonly sampleBits: number;
  readonly sampleType: string;
  readonly scalingFactor: number;
  readonly offset: number;
  readonly mapScaleM: number;
  readonly minimumLatitudeDeg: number;
  readonly maximumLatitudeDeg: number;
}

export interface LolaDemSample {
  readonly sourceLabel: string;
  readonly sourceImage: string;
  readonly projection: string;
  readonly gridRows: number;
  readonly gridCols: number;
  readonly cellSpacingM: number;
  readonly centerSampleIndex: {
    readonly line: number;
    readonly sample: number;
  };
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly meanSlopeDeg: number;
  readonly maxSlopeDeg: number;
  readonly elevationsM: readonly (readonly number[])[];
}

export interface MonthlySiteStats {
  readonly month: string;
  readonly totalHours: number;
  readonly daylightHours: number;
  readonly optimalLightingHours: number;
  readonly lowShadowHours: number;
  readonly directEarthLinkHours: number;
  readonly directEarthLinkPct: number;
}

export interface SiteComparisonSummary {
  readonly site: LunarSite;
  readonly totalHours: number;
  readonly daylightHours: number;
  readonly optimalLightingHours: number;
  readonly lowShadowHours: number;
  readonly directEarthLinkHours: number;
  readonly directEarthLinkPct: number;
  readonly monthly: readonly MonthlySiteStats[];
}

export interface SiteComparisonResponse {
  readonly year: number;
  readonly siteA: SiteComparisonSummary;
  readonly siteB: SiteComparisonSummary;
}

export interface TelemetryWindowResponse {
  readonly site: LunarSite;
  readonly startUtc: string;
  readonly hours: number;
  readonly telemetry: readonly HourlyTelemetry[];
}

export interface BestWindowsResponse {
  readonly site: LunarSite;
  readonly durationHours: number;
  readonly hasRelaySatellite: boolean;
  readonly windows: readonly OptimalWindowRecommendation[];
}

export interface CreateMissionPayload {
  readonly name: string;
  readonly notes: string;
  readonly config: MissionConfig;
}

export interface UpdateMissionPayload {
  readonly name?: string;
  readonly notes?: string;
  readonly config?: Partial<MissionConfig>;
}
