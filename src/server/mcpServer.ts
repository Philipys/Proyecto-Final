import { createInterface } from 'node:readline';
import { evaluateMissionAtStart } from '../domain/MissionEvaluator.js';
import type { LunarSiteId } from '../models/lunar.types.js';
import { TelemetryCatalogService } from './TelemetryCatalogService.js';
import {
  NotFoundError,
  ValidationError,
  validateMissionConfigInput,
} from './validators.js';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: JsonRpcErrorPayload;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'artemis-lunar-navigator-mcp';
const SERVER_VERSION = '1.0.0';

const SITE_ID_ENUM: readonly LunarSiteId[] = [
  'apollo-11',
  'chandrayaan-3',
  'im1-odysseus',
  'shackleton-rim',
  'south-pole-895',
  'change-4',
];

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'evaluate_mission',
    description:
      'Evalúa la viabilidad de una misión lunar 2027 usando efemérides NASA JPL Horizons, topografía LOLA DEM y las 5 Reglas de Negocio (Iluminación, Balance Energético, Comunicaciones DTE/Relay, Pendiente y Ruta EVA con Haversine lunar R=1737.4 km).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'startUtc'],
      properties: {
        siteId: {
          type: 'string',
          enum: SITE_ID_ENUM,
          description: 'Identificador oficial del sitio lunar.',
        },
        startUtc: {
          type: 'string',
          description: 'Fecha/hora UTC de alunizaje en 2027 (ej. 2027-06-15T12:00:00Z).',
        },
        durationHours: {
          type: 'integer',
          minimum: 1,
          maximum: 720,
          default: 72,
          description: 'Duración de la misión en horas (1 a 720).',
        },
        batteryCapacityKwh: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 10000,
          default: 120,
          description: 'Capacidad total de batería en kWh.',
        },
        baseConsumptionKw: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 1000,
          default: 1.5,
          description: 'Consumo base del módulo en kW.',
        },
        solarPanelMaxKw: {
          type: 'number',
          minimum: 0,
          maximum: 1000,
          default: 3.5,
          description: 'Potencia pico del arreglo solar en kW.',
        },
        hasRelaySatellite: {
          type: 'boolean',
          default: false,
          description: 'Indica si la misión cuenta con satélite retransmisor (Relay).',
        },
        terrainSlopeDeg: {
          type: 'number',
          minimum: 0,
          maximum: 90,
          description: 'Pendiente local opcional en grados (sobrescribe el catálogo LOLA).',
        },
        waypoints: {
          type: 'array',
          description: 'Lista ordenada de waypoints EVA (latitud/longitud lunar).',
          items: {
            type: 'object',
            required: ['latitudeDeg', 'longitudeDeg'],
            properties: {
              latitudeDeg: { type: 'number', minimum: -90, maximum: 90 },
              longitudeDeg: { type: 'number', minimum: -180, maximum: 180 },
              elevationM: { type: 'number', minimum: -15000, maximum: 15000 },
            },
          },
        },
        evaSpeedKmh: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 100,
          description: 'Velocidad promedio de desplazamiento EVA en km/h (por defecto 3.0).',
        },
        maxEvaRangeKm: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 1000,
          description: 'Autonomía máxima de ruta EVA ida y vuelta en km (por defecto 10.0).',
        },
      },
    },
  },
  {
    name: 'find_best_2027_windows',
    description:
      'Recorre las 8,760 horas de 2027 mediante ventana deslizante para recomendar las 3 mejores fechas de alunizaje no solapadas para un sitio lunar.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: {
          type: 'string',
          enum: SITE_ID_ENUM,
          description: 'Identificador oficial del sitio lunar.',
        },
        durationHours: {
          type: 'integer',
          minimum: 1,
          maximum: 720,
          default: 72,
        },
        hasRelaySatellite: {
          type: 'boolean',
          default: false,
        },
        batteryCapacityKwh: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 10000,
          default: 120,
        },
        baseConsumptionKw: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 1000,
          default: 1.5,
        },
        solarPanelMaxKw: {
          type: 'number',
          minimum: 0,
          maximum: 1000,
          default: 3.5,
        },
      },
    },
  },
  {
    name: 'compare_lunar_sites',
    description:
      'Compara dos sitios lunares durante las 8,760 horas de 2027, devolviendo horas totales y mensuales de luz solar, sombras rasantes y enlace directo a la Tierra (DTE >= 5°).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteA', 'siteB'],
      properties: {
        siteA: {
          type: 'string',
          enum: SITE_ID_ENUM,
          description: 'Primer sitio lunar a comparar.',
        },
        siteB: {
          type: 'string',
          enum: SITE_ID_ENUM,
          description: 'Segundo sitio lunar a comparar.',
        },
      },
    },
  },
  {
    name: 'list_lunar_sites',
    description:
      'Lista el catálogo oficial de los 6 sitios lunares 2027 con coordenadas geodésicas, pendiente LOLA y bandera de cara oculta.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractRequestId(rawPayload: unknown): JsonRpcId {
  if (!isPlainObject(rawPayload)) {
    return null;
  }
  const rawId = rawPayload.id;
  if (typeof rawId === 'string' || typeof rawId === 'number' || rawId === null) {
    return rawId;
  }
  return null;
}

function buildToolSuccessResult(payload: unknown): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function buildToolErrorResult(message: string): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

/**
 * Servidor Model Context Protocol (MCP) de Artemis Lunar Navigator.
 * Expone el motor determinista de viabilidad lunar y los datasets NASA 2027
 * a clientes y agentes de IA sobre JSON-RPC 2.0 (Stdio y HTTP POST /api/mcp).
 */
export class LunarNavigatorMcpServer {
  private readonly catalogService: TelemetryCatalogService;

  constructor(catalogService = new TelemetryCatalogService()) {
    this.catalogService = catalogService;
  }

  getToolDefinitions(): readonly McpToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  async handleRequest(rawPayload: unknown): Promise<JsonRpcResponse | null> {
    const id = extractRequestId(rawPayload);

    if (
      !isPlainObject(rawPayload) ||
      rawPayload.jsonrpc !== '2.0' ||
      typeof rawPayload.method !== 'string' ||
      rawPayload.method.trim().length === 0
    ) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Petición JSON-RPC 2.0 inválida.',
        },
      };
    }

    const method = rawPayload.method;
    const hasId = rawPayload.id !== undefined;
    const params = isPlainObject(rawPayload.params) ? rawPayload.params : {};

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          },
        };

      case 'notifications/initialized':
        if (!hasId) {
          return null;
        }
        return {
          jsonrpc: '2.0',
          id,
          result: { acknowledged: true },
        };

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getToolDefinitions(),
          },
        };

      case 'tools/call':
        return this.handleToolCall(id, params);

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Método JSON-RPC no soportado: "${method}".`,
          },
        };
    }
  }

  private async handleToolCall(
    id: JsonRpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const toolName = params.name;
    if (typeof toolName !== 'string' || toolName.trim().length === 0) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: 'Parámetros inválidos en tools/call: falta "name".',
        },
      };
    }

    const exists = TOOL_DEFINITIONS.some((tool) => tool.name === toolName);
    if (!exists) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Herramienta MCP desconocida: "${toolName}".`,
        },
      };
    }

    const rawArgs = params.arguments;
    const args = isPlainObject(rawArgs) ? rawArgs : {};

    try {
      const result = await this.executeTool(toolName, args);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof RangeError
      ) {
        return {
          jsonrpc: '2.0',
          id,
          result: buildToolErrorResult(error.message),
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Error interno al ejecutar la herramienta MCP.',
        },
      };
    }
  }

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    switch (toolName) {
      case 'list_lunar_sites': {
        const sites = this.catalogService.getSites();
        return buildToolSuccessResult({ count: sites.length, sites });
      }

      case 'evaluate_mission': {
        const normalizedConfig = validateMissionConfigInput({
          siteId: args.siteId,
          startUtc: args.startUtc,
          durationHours: args.durationHours ?? 72,
          batteryCapacityKwh: args.batteryCapacityKwh ?? 120,
          baseConsumptionKw: args.baseConsumptionKw ?? 1.5,
          solarPanelMaxKw: args.solarPanelMaxKw ?? 3.5,
          hasRelaySatellite: args.hasRelaySatellite ?? false,
          ...(args.terrainSlopeDeg !== undefined
            ? { terrainSlopeDeg: args.terrainSlopeDeg }
            : {}),
          ...(args.waypoints !== undefined ? { waypoints: args.waypoints } : {}),
          ...(args.evaSpeedKmh !== undefined ? { evaSpeedKmh: args.evaSpeedKmh } : {}),
          ...(args.maxEvaRangeKm !== undefined
            ? { maxEvaRangeKm: args.maxEvaRangeKm }
            : {}),
        });

        const annual = await this.catalogService.getAnnualTelemetry(normalizedConfig.siteId);
        const evaluation = evaluateMissionAtStart(annual, normalizedConfig);

        return buildToolSuccessResult({
          site: this.catalogService.getSiteById(normalizedConfig.siteId),
          config: normalizedConfig,
          evaluation,
        });
      }

      case 'find_best_2027_windows': {
        if (typeof args.siteId !== 'string' || args.siteId.trim().length === 0) {
          throw new ValidationError('El parámetro "siteId" es obligatorio.');
        }
        const bestWindows = await this.catalogService.getBestWindows(args.siteId.trim(), {
          durationHours: args.durationHours,
          hasRelaySatellite: args.hasRelaySatellite,
          batteryCapacityKwh: args.batteryCapacityKwh,
          baseConsumptionKw: args.baseConsumptionKw,
          solarPanelMaxKw: args.solarPanelMaxKw,
        });
        return buildToolSuccessResult(bestWindows);
      }

      case 'compare_lunar_sites': {
        const comparison = await this.catalogService.compareSites(args.siteA, args.siteB);
        return buildToolSuccessResult(comparison);
      }

      default:
        throw new ValidationError(`Herramienta MCP no soportada: "${toolName}".`);
    }
  }
}

/**
 * Inicia el servidor MCP en transporte Stdio (una petición JSON-RPC por línea).
 */
export function startMcpStdioServer(
  mcpServer = new LunarNavigatorMcpServer(),
): void {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    void (async () => {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const response = await mcpServer.handleRequest(parsed);
        if (response !== null) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch {
        const parseError: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Error de parseo JSON en flujo MCP Stdio.',
          },
        };
        process.stdout.write(`${JSON.stringify(parseError)}\n`);
      }
    })();
  });
}

/**
 * Ejecuta una sesión demostrativa real del servidor MCP para verificación manual y evidencias.
 */
export async function runMcpCliDemo(
  mcpServer = new LunarNavigatorMcpServer(),
): Promise<string> {
  const requests: readonly JsonRpcRequest[] = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        clientInfo: { name: 'artemis-cli-inspector', version: '1.0.0' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'find_best_2027_windows',
        arguments: {
          siteId: 'shackleton-rim',
          durationHours: 72,
          hasRelaySatellite: true,
        },
      },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'evaluate_mission',
        arguments: {
          siteId: 'shackleton-rim',
          startUtc: '2027-01-15T12:00:00Z',
          durationHours: 72,
          batteryCapacityKwh: 120,
          baseConsumptionKw: 1.5,
          solarPanelMaxKw: 4.5,
          hasRelaySatellite: true,
          waypoints: [
            { latitudeDeg: -89.45, longitudeDeg: 130.0, elevationM: -350 },
            { latitudeDeg: -89.43, longitudeDeg: 130.5, elevationM: -310 },
          ],
        },
      },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'compare_lunar_sites',
        arguments: {
          siteA: 'apollo-11',
          siteB: 'shackleton-rim',
        },
      },
    },
  ];

  const lines: string[] = [
    '========================================================================',
    '  ARTEMIS LUNAR NAVIGATOR — SERVIDOR MCP PROPIO (JSON-RPC 2.0 DEMO)',
    '========================================================================',
  ];

  for (const req of requests) {
    const res = await mcpServer.handleRequest(req);
    lines.push('');
    lines.push(`>>> REQUEST [id=${String(req.id)}] method=${req.method}`);
    lines.push(JSON.stringify(req));
    lines.push(`<<< RESPONSE [id=${String(req.id)}]`);

    if (req.method === 'tools/call' && isPlainObject(res?.result)) {
      const summary = summarizeDemoStructuredContent(
        (req.params as { name?: string })?.name ?? '',
        res.result.structuredContent,
      );
      lines.push(JSON.stringify(summary, null, 2));
    } else {
      lines.push(JSON.stringify(res, null, 2));
    }
  }

  lines.push('');
  lines.push('========================================================================');
  return lines.join('\n');
}

function summarizeDemoStructuredContent(
  toolName: string,
  structured: unknown,
): Record<string, unknown> {
  if (!isPlainObject(structured)) {
    return { raw: structured };
  }
  if (toolName === 'evaluate_mission' && isPlainObject(structured.evaluation)) {
    const ev = structured.evaluation;
    const rules = isPlainObject(ev.rules) ? ev.rules : {};
    return {
      tool: toolName,
      siteId: isPlainObject(structured.site) ? structured.site.id : undefined,
      verdict: ev.verdict,
      viabilityScore: ev.viabilityScore,
      blockingReasons: ev.blockingReasons,
      warnings: ev.warnings,
      rulesSummary: {
        lighting: isPlainObject(rules.lighting) ? rules.lighting.status : undefined,
        energy: isPlainObject(rules.energy)
          ? {
              status: rules.energy.status,
              minBatteryPct: rules.energy.minBatteryPct,
            }
          : undefined,
        communications: isPlainObject(rules.communications)
          ? rules.communications.status
          : undefined,
        terrain: isPlainObject(rules.terrain) ? rules.terrain.status : undefined,
        eva: isPlainObject(rules.eva)
          ? {
              status: rules.eva.status,
              roundTripKm: rules.eva.roundTripKm,
            }
          : undefined,
      },
    };
  }

  if (toolName === 'compare_lunar_sites') {
    const siteA = isPlainObject(structured.siteA) ? structured.siteA : {};
    const siteB = isPlainObject(structured.siteB) ? structured.siteB : {};
    return {
      tool: toolName,
      year: structured.year,
      siteA: {
        id: isPlainObject(siteA.site) ? siteA.site.id : undefined,
        daylightHours: siteA.daylightHours,
        directEarthLinkPct: siteA.directEarthLinkPct,
        monthsCount: Array.isArray(siteA.monthly) ? siteA.monthly.length : 0,
      },
      siteB: {
        id: isPlainObject(siteB.site) ? siteB.site.id : undefined,
        daylightHours: siteB.daylightHours,
        directEarthLinkPct: siteB.directEarthLinkPct,
        monthsCount: Array.isArray(siteB.monthly) ? siteB.monthly.length : 0,
      },
    };
  }

  return { tool: toolName, ...structured };
}

const entryArg = process.argv[1];
if (entryArg && (entryArg.endsWith('mcpServer.ts') || entryArg.endsWith('mcpServer.js'))) {
  if (process.argv.includes('--demo')) {
    void runMcpCliDemo().then((report) => {
      process.stdout.write(`${report}\n`);
    });
  } else {
    startMcpStdioServer();
  }
}
