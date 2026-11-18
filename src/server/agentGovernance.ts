import { readFileSync } from 'node:fs';
import {
  evaluateMissionAtStart,
  findBestLandingWindows,
} from '../domain/MissionEvaluator.js';
import type {
  LunarSite,
  LunarSiteId,
  MissionConfig,
  MissionEvaluation,
  OptimalWindowRecommendation,
  SiteComparisonResponse,
} from '../models/lunar.types.js';
import { TelemetryCatalogService } from './TelemetryCatalogService.js';

export type HookDecisionType = 'allow' | 'deny';

export interface PreToolUseHookInput {
  readonly hookEventName?: string;
  readonly toolCall?: {
    readonly id?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  };
}

export interface PreToolUseHookDecision {
  readonly decision: HookDecisionType;
  readonly ruleId: string;
  readonly reason: string;
}

export interface LunarMissionAuditReport {
  readonly site: LunarSite;
  readonly referenceSiteId: LunarSiteId;
  readonly siteComparison: SiteComparisonResponse;
  readonly initialConfig: MissionConfig;
  readonly initialEvaluation: MissionEvaluation;
  readonly optimalWindows2027: readonly OptimalWindowRecommendation[];
  readonly remediatedConfig: MissionConfig;
  readonly remediatedEvaluation: MissionEvaluation;
  readonly scoreDelta: number;
  readonly findings: readonly string[];
  readonly recommendations: readonly string[];
}

const DIRECT_MAIN_PUSH_RE =
  /\bgit\s+push\b[^\n]*(?:\s|:)(?:refs\/heads\/)?(?:main|master)(?:\s|$|[;&|])/i;
const FORCE_PUSH_RE =
  /\bgit\s+push\b[^\n]*(?:\s-f(?:\s|$)|--force(?:-with-lease)?\b)/i;

const DESTRUCTIVE_SQL_RE =
  /\b(?:DROP\s+(?:TABLE|DATABASE|VIEW|SCHEMA)|TRUNCATE(?:\s+TABLE)?\s+\w+|DELETE\s+FROM\s+[`"[]?(?:missions|eva_waypoints)[`"\]]?\s*(?:;|$|WHERE\s+1\s*=\s*1))/i;
const DESTRUCTIVE_DATA_DELETE_RE =
  /(?:\brm\s+-[^\n]*r[^\n]*|\bRemove-Item\b[^\n]*-Recurse\b|\bdel\s+\/[sqf]+|\brd\s+\/s|\brmdir\s+\/s)[^\n]*(?:data[/\\]|horizons|lola|\.sqlite)/i;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
];
const DOTENV_FILE_RE = /(?:^|[\\/])\.env(?:\.(?!example$)[^\\/]*)?$/i;
const ENV_SECRET_ASSIGN_RE =
  /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*['"]?[A-Za-z0-9_/+=-]{8,}/i;

const SQL_INTERPOLATION_TEMPLATE_RE =
  /`[^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^`]*\$\{[^}]+\}[^`]*`/is;
const SQL_CONCAT_RE =
  /['"][^'"]*\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^'"]*['"]\s*\+/is;

const DOMAIN_FORBIDDEN_IMPORT_RE =
  /\b(?:from\s+['"](?:express|better-sqlite3|three|cors)(?:\/[^'"]*)?['"]|require\s*\(\s*['"](?:express|better-sqlite3|three|cors)(?:\/[^'"]*)?['"]\s*\))/;
const DOMAIN_DOM_GLOBAL_RE = /\b(?:window|document)\s*\./;

function normalizePath(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\\/g, '/') : '';
}

function collectTextFields(args: Record<string, unknown>): string {
  const candidates = [
    args.CommandLine,
    args.command,
    args.Content,
    args.content,
    args.Replacement,
    args.replacement,
  ];
  return candidates.filter((v): v is string => typeof v === 'string').join('\n');
}

function getTargetPath(args: Record<string, unknown>): string {
  return normalizePath(args.Path ?? args.path ?? args.TargetFile ?? args.targetFile);
}

/**
 * Evalúa una invocación de herramienta según el contrato `PreToolUse` de Antigravity
 * aplicando los controles obligatorios de `AGENTS.md` (protección de main, prevención de
 * pérdida de datos, cero secretos, SQL parametrizado y aislamiento puro del dominio).
 */
export function evaluatePreToolUseHook(
  input: PreToolUseHookInput,
): PreToolUseHookDecision {
  const toolName = input.toolCall?.name ?? '';
  const args = input.toolCall?.args ?? {};
  const payloadText = collectTextFields(args);
  const targetPath = getTargetPath(args);

  if (toolName === 'run_command') {
    const commandLine =
      typeof args.CommandLine === 'string'
        ? args.CommandLine
        : typeof args.command === 'string'
          ? args.command
          : payloadText;

    if (DIRECT_MAIN_PUSH_RE.test(commandLine) || FORCE_PUSH_RE.test(commandLine)) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-GIT-01',
        reason:
          'Bloqueado por AGENTS.md §4.3: prohibido hacer push directo a main/master o force-push; usa ramas feat/... y Pull Request.',
      };
    }

    if (
      DESTRUCTIVE_SQL_RE.test(commandLine) ||
      DESTRUCTIVE_DATA_DELETE_RE.test(commandLine)
    ) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-SEC-02',
        reason:
          'Bloqueado por prevención de pérdida de datos: operación SQL destructiva o borrado recursivo sobre datasets/SQLite.',
      };
    }
  }

  if (
    toolName === 'write_file' ||
    toolName === 'edit_file' ||
    toolName === 'run_command'
  ) {
    if (
      DESTRUCTIVE_SQL_RE.test(payloadText) ||
      DESTRUCTIVE_DATA_DELETE_RE.test(payloadText)
    ) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-SEC-02',
        reason:
          'Bloqueado por prevención de pérdida de datos: sentencia SQL destructiva (DROP/TRUNCATE/DELETE sin WHERE) o eliminación de data/.',
      };
    }

    const hasSecretToken = SECRET_PATTERNS.some((pattern) => pattern.test(payloadText));
    const writesPrivateEnv =
      (toolName === 'write_file' || toolName === 'edit_file') &&
      DOTENV_FILE_RE.test(targetPath) &&
      ENV_SECRET_ASSIGN_RE.test(payloadText);

    if (hasSecretToken || writesPrivateEnv) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-SEC-03',
        reason:
          'Bloqueado por AGENTS.md §5.1: detección de credencial, token o escritura de archivo .env con secretos reales.',
      };
    }
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    if (
      targetPath.includes('src/server/') &&
      (SQL_INTERPOLATION_TEMPLATE_RE.test(payloadText) || SQL_CONCAT_RE.test(payloadText))
    ) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-SQL-04',
        reason:
          'Bloqueado por AGENTS.md §5.2: prohibida la interpolación o concatenación de strings en SQL; usa placeholders parametrizados (?).',
      };
    }

    if (
      targetPath.includes('src/domain/') &&
      (DOMAIN_FORBIDDEN_IMPORT_RE.test(payloadText) ||
        DOMAIN_DOM_GLOBAL_RE.test(payloadText))
    ) {
      return {
        decision: 'deny',
        ruleId: 'HOOK-ARCH-05',
        reason:
          'Bloqueado por AGENTS.md §2.2: src/domain/ debe permanecer puro, sin dependencias de Express, SQLite, Three.js ni DOM.',
      };
    }
  }

  return {
    decision: 'allow',
    ruleId: 'HOOK-OK',
    reason: 'Operación verificada conforme a AGENTS.md y spec/spec.md.',
  };
}

function buildFindingsAndRecommendations(
  site: LunarSite,
  evaluation: MissionEvaluation,
  optimalWindows: readonly OptimalWindowRecommendation[],
): { findings: string[]; recommendations: string[] } {
  const findings: string[] = [];
  const recommendations: string[] = [];

  if (evaluation.rules.lighting.status !== 'GO') {
    findings.push(`[Regla 1 - Iluminación] ${evaluation.rules.lighting.reason}`);
    if (optimalWindows[0]) {
      recommendations.push(
        `Reprogramar alunizaje a la ventana óptima #1 de 2027: ${optimalWindows[0].startUtc} (score ${optimalWindows[0].viabilityScore}).`,
      );
    }
  }

  if (evaluation.rules.energy.status !== 'GO') {
    findings.push(`[Regla 2 - Energía] ${evaluation.rules.energy.reason}`);
    recommendations.push(
      'Incrementar potencia solar o seleccionar una ventana con mayor continuidad de luz solar en 2027.',
    );
  }

  if (evaluation.rules.communications.status !== 'GO') {
    findings.push(`[Regla 3 - Comunicaciones] ${evaluation.rules.communications.reason}`);
    if (!evaluation.rules.communications.relayActive) {
      recommendations.push(
        site.isFarSide
          ? `Habilitar Satélite Retransmisor (Relay) obligatorio para ${site.name} (cara oculta).`
          : 'Activar cobertura con Satélite Relay para eliminar cortes de enlace directo DTE.',
      );
    }
  }

  if (evaluation.rules.terrain.status !== 'GO') {
    findings.push(`[Regla 4 - Topografía LOLA] ${evaluation.rules.terrain.reason}`);
    recommendations.push(
      'Ajustar punto de descenso sobre la grilla LOLA DEM hacia una zona con pendiente <= 10°.',
    );
  }

  if (evaluation.rules.eva.status !== 'GO') {
    findings.push(`[Regla 5 - Ruta EVA] ${evaluation.rules.eva.reason}`);
    recommendations.push(
      'Acortar la trayectoria EVA dentro de la autonomía máxima y asegurar >= 2h de margen antes del ocaso.',
    );
  }

  if (findings.length === 0) {
    findings.push('Las 5 Reglas de Negocio cumplen márgenes nominales GO sin hallazgos críticos.');
    recommendations.push('Plan aprobado en Flight Readiness Review para persistencia en SQLite.');
  }

  return { findings, recommendations };
}

/**
 * Skill propio de Auditoría de Misiones Lunares (Flight Readiness Review — FRR).
 * Diagnostica incumplimientos de las 5 reglas, busca ventanas óptimas 2027, compara contra
 * sitio de referencia y cuantifica la remediación automática recomendada.
 */
export async function runLunarMissionAuditSkill(
  config: MissionConfig,
  catalogService = new TelemetryCatalogService(),
): Promise<LunarMissionAuditReport> {
  const site = catalogService.getSiteById(config.siteId);
  const referenceSiteId: LunarSiteId =
    site.id === 'shackleton-rim' ? 'apollo-11' : 'shackleton-rim';

  const [annualTelemetry, siteComparison] = await Promise.all([
    catalogService.getAnnualTelemetry(site.id),
    catalogService.compareSites(site.id, referenceSiteId),
  ]);

  const initialEvaluation = evaluateMissionAtStart(annualTelemetry, config);
  const baseWindowConfig: Omit<MissionConfig, 'startUtc'> = {
    siteId: site.id,
    durationHours: config.durationHours,
    batteryCapacityKwh: config.batteryCapacityKwh,
    baseConsumptionKw: config.baseConsumptionKw,
    solarPanelMaxKw: config.solarPanelMaxKw,
    hasRelaySatellite: config.hasRelaySatellite,
    ...(config.terrainSlopeDeg !== undefined
      ? { terrainSlopeDeg: config.terrainSlopeDeg }
      : {}),
    ...(config.waypoints !== undefined ? { waypoints: config.waypoints } : {}),
    ...(config.evaSpeedKmh !== undefined ? { evaSpeedKmh: config.evaSpeedKmh } : {}),
    ...(config.maxEvaRangeKm !== undefined ? { maxEvaRangeKm: config.maxEvaRangeKm } : {}),
  };

  const optimalWindows2027 = findBestLandingWindows(annualTelemetry, baseWindowConfig, 3);

  let remediatedConfig: MissionConfig = { ...config };
  if (
    initialEvaluation.rules.communications.status !== 'GO' &&
    !remediatedConfig.hasRelaySatellite
  ) {
    remediatedConfig = {
      ...remediatedConfig,
      hasRelaySatellite: true,
    };
  }

  const postRelayEvaluation = evaluateMissionAtStart(annualTelemetry, remediatedConfig);
  const remediatedWindows =
    remediatedConfig.hasRelaySatellite !== config.hasRelaySatellite
      ? findBestLandingWindows(
          annualTelemetry,
          { ...baseWindowConfig, hasRelaySatellite: remediatedConfig.hasRelaySatellite },
          3,
        )
      : optimalWindows2027;

  if (
    (postRelayEvaluation.rules.lighting.status !== 'GO' ||
      postRelayEvaluation.rules.energy.status !== 'GO') &&
    remediatedWindows.length > 0
  ) {
    remediatedConfig = {
      ...remediatedConfig,
      startUtc: remediatedWindows[0].startUtc,
    };
  }

  const remediatedEvaluation = evaluateMissionAtStart(annualTelemetry, remediatedConfig);
  const scoreDelta =
    remediatedEvaluation.viabilityScore - initialEvaluation.viabilityScore;

  const { findings, recommendations } = buildFindingsAndRecommendations(
    site,
    initialEvaluation,
    remediatedWindows,
  );

  return {
    site,
    referenceSiteId,
    siteComparison,
    initialConfig: config,
    initialEvaluation,
    optimalWindows2027,
    remediatedConfig,
    remediatedEvaluation,
    scoreDelta,
    findings,
    recommendations,
  };
}

/**
 * Ejecuta una demostración integral del Bloque Avanzado (Hooks PreToolUse + Skill FRR)
 * para verificación en CLI y captura de evidencias.
 */
export async function runGovernanceCliDemo(
  catalogService = new TelemetryCatalogService(),
): Promise<string> {
  const hookScenarios: readonly { label: string; input: PreToolUseHookInput }[] = [
    {
      label: 'Push directo a rama main',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin main' },
        },
      },
    },
    {
      label: 'Sentencia SQL destructiva (DROP TABLE)',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'sqlite3 data/lunar.sqlite "DROP TABLE missions;"' },
        },
      },
    },
    {
      label: 'Exposición de token secreto en archivo',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'write_file',
          args: {
            Path: 'src/server/config.ts',
            Content: 'export const TOKEN = "ghp_1234567890abcdefghijklmnop";',
          },
        },
      },
    },
    {
      label: 'Interpolación SQL insegura en src/server/',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'edit_file',
          args: {
            Path: 'src/server/SqliteMissionRepository.ts',
            Replacement: 'this.db.prepare(`SELECT * FROM missions WHERE id = ${id}`);',
          },
        },
      },
    },
    {
      label: 'Acoplamiento prohibido en src/domain/',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'edit_file',
          args: {
            Path: 'src/domain/MissionEvaluator.ts',
            Replacement: "import * as THREE from 'three';",
          },
        },
      },
    },
    {
      label: 'Ejecución segura de suite de pruebas',
      input: {
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm run test:coverage' },
        },
      },
    },
  ];

  const lines: string[] = [
    '========================================================================',
    '  BLOQUE AVANZADO — HOOKS DE SEGURIDAD/CALIDAD + SKILL AUDITORÍA LUNAR',
    '========================================================================',
    '',
    '1) HOOKS PRE-TOOL-USE (AGENTS.md + Prevención de Riesgos)',
  ];

  for (const scenario of hookScenarios) {
    const decision = evaluatePreToolUseHook(scenario.input);
    lines.push(
      `  [${decision.decision.toUpperCase()}] (${decision.ruleId}) ${scenario.label} -> ${decision.reason}`,
    );
  }

  const auditReport = await runLunarMissionAuditSkill(
    {
      siteId: 'change-4',
      startUtc: '2027-01-01T00:00:00Z',
      durationHours: 72,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
      hasRelaySatellite: false,
    },
    catalogService,
  );

  lines.push('');
  lines.push('2) SKILL PROPIO: FLIGHT READINESS REVIEW (auditoría de misión lunar)');
  lines.push(`  Sitio auditado: ${auditReport.site.name} (${auditReport.site.id})`);
  lines.push(
    `  Dictamen inicial: ${auditReport.initialEvaluation.verdict} (${auditReport.initialEvaluation.viabilityScore}/100)`,
  );
  lines.push(`  Hallazgos: ${auditReport.findings.join(' | ')}`);
  lines.push(`  Recomendaciones: ${auditReport.recommendations.join(' | ')}`);
  lines.push(
    `  Configuración remediada: startUtc=${auditReport.remediatedConfig.startUtc}, hasRelaySatellite=${String(auditReport.remediatedConfig.hasRelaySatellite)}`,
  );
  lines.push(
    `  Dictamen tras remediación: ${auditReport.remediatedEvaluation.verdict} (${auditReport.remediatedEvaluation.viabilityScore}/100, delta +${auditReport.scoreDelta})`,
  );
  lines.push('========================================================================');

  return lines.join('\n');
}

const entryArg = process.argv[1];
if (
  entryArg &&
  (entryArg.endsWith('agentGovernance.ts') || entryArg.endsWith('agentGovernance.js'))
) {
  if (process.argv.includes('--hook')) {
    const rawStdin = readFileSync(0, 'utf8').trim();
    const parsed = rawStdin.length > 0 ? (JSON.parse(rawStdin) as PreToolUseHookInput) : {};
    const result = evaluatePreToolUseHook(parsed);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    void runGovernanceCliDemo().then((report) => {
      process.stdout.write(`${report}\n`);
    });
  }
}
