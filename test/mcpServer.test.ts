import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MissionEvaluation, SiteComparisonResponse } from '../src/models/lunar.types.js';
import { createApp, type ServerAppContext } from '../src/server/app.js';
import {
  LunarNavigatorMcpServer,
  runMcpCliDemo,
  type McpToolCallResult,
} from '../src/server/mcpServer.js';

describe('LunarNavigatorMcpServer — Servidor MCP Propio (JSON-RPC 2.0)', () => {
  const mcpServer = new LunarNavigatorMcpServer();
  let appCtx: ServerAppContext;

  beforeAll(() => {
    appCtx = createApp({ dbPath: ':memory:' });
  });

  afterAll(() => {
    appCtx.repository.close();
  });

  it('responde al ciclo de vida MCP (initialize, notifications/initialized, ping y tools/list)', async () => {
    const initRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(initRes?.error).toBeUndefined();
    expect(initRes?.result).toMatchObject({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'artemis-lunar-navigator-mcp' },
    });

    const notifRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notifRes).toBeNull();

    const ackNotifRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 'n1',
      method: 'notifications/initialized',
    });
    expect(ackNotifRes?.result).toEqual({ acknowledged: true });

    const pingRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });
    expect(pingRes?.result).toEqual({});

    const listRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });
    const tools = (listRes?.result as { tools: { name: string }[] }).tools;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual([
      'evaluate_mission',
      'find_best_2027_windows',
      'compare_lunar_sites',
      'list_lunar_sites',
    ]);
  });

  it('ejecuta evaluate_mission en Shackleton (con Relay) y bloquea ChangE-4 sin Relay (NO-GO)', async () => {
    const shackletonRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'evaluate_mission',
        arguments: {
          siteId: 'shackleton-rim',
          startUtc: '2027-01-15T12:00:00Z',
          durationHours: 48,
          batteryCapacityKwh: 120,
          baseConsumptionKw: 1.5,
          solarPanelMaxKw: 4.5,
          hasRelaySatellite: true,
        },
      },
    });
    const shackToolRes = shackletonRes?.result as McpToolCallResult;
    expect(shackToolRes.isError).toBeUndefined();
    const shackStructured = shackToolRes.structuredContent as {
      evaluation: MissionEvaluation;
    };
    expect(['GO', 'CAUTION']).toContain(shackStructured.evaluation.verdict);
    expect(shackStructured.evaluation.rules.communications.status).toBe('GO');

    const change4Res = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'evaluate_mission',
        arguments: {
          siteId: 'change-4',
          startUtc: '2027-01-01T00:00:00Z',
          hasRelaySatellite: false,
        },
      },
    });
    const change4ToolRes = change4Res?.result as McpToolCallResult;
    const change4Structured = change4ToolRes.structuredContent as {
      evaluation: MissionEvaluation;
    };
    expect(change4Structured.evaluation.verdict).toBe('NO-GO');
    expect(change4Structured.evaluation.rules.communications.status).toBe('NO-GO');
  });

  it('ejecuta find_best_2027_windows, compare_lunar_sites y list_lunar_sites con datasets NASA reales', async () => {
    const bestRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'find_best_2027_windows',
        arguments: {
          siteId: 'shackleton-rim',
          durationHours: 72,
          hasRelaySatellite: true,
        },
      },
    });
    const bestToolRes = bestRes?.result as McpToolCallResult;
    const bestPayload = bestToolRes.structuredContent as {
      windows: { viabilityScore: number }[];
    };
    expect(bestPayload.windows).toHaveLength(3);
    expect(bestPayload.windows[0].viabilityScore).toBeGreaterThanOrEqual(
      bestPayload.windows[1].viabilityScore,
    );

    const compareRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'compare_lunar_sites',
        arguments: {
          siteA: 'apollo-11',
          siteB: 'shackleton-rim',
        },
      },
    });
    const compareToolRes = compareRes?.result as McpToolCallResult;
    const comparePayload = compareToolRes.structuredContent as SiteComparisonResponse;
    expect(comparePayload.year).toBe(2027);
    expect(comparePayload.siteA.monthly).toHaveLength(12);
    expect(comparePayload.siteB.monthly).toHaveLength(12);

    const listRes = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'list_lunar_sites',
        arguments: {},
      },
    });
    const listToolRes = listRes?.result as McpToolCallResult;
    const listPayload = listToolRes.structuredContent as {
      count: number;
      sites: { id: string }[];
    };
    expect(listPayload.count).toBe(6);
    expect(listPayload.sites.map((s) => s.id)).toContain('change-4');
  });

  it('maneja errores JSON-RPC (-32600, -32601, -32602) y errores de validación de herramienta (isError: true)', async () => {
    const invalidReq = await mcpServer.handleRequest({ foo: 'bar' });
    expect(invalidReq?.error?.code).toBe(-32600);

    const unknownMethod = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 30,
      method: 'resources/unknown',
    });
    expect(unknownMethod?.error?.code).toBe(-32601);

    const unknownTool = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'tool_inexistente', arguments: {} },
    });
    expect(unknownTool?.error?.code).toBe(-32602);

    const missingToolName = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 32,
      method: 'tools/call',
      params: {},
    });
    expect(missingToolName?.error?.code).toBe(-32602);

    const badArgs = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 33,
      method: 'tools/call',
      params: {
        name: 'evaluate_mission',
        arguments: {
          siteId: 'sitio-invalido',
          startUtc: '2027-01-01T00:00:00Z',
        },
      },
    });
    const badToolRes = badArgs?.result as McpToolCallResult;
    expect(badToolRes.isError).toBe(true);
    expect(badToolRes.content[0].text).toContain('Sitio lunar desconocido');
  });

  it('expone POST /api/mcp sobre Express y ejecuta runMcpCliDemo correctamente', async () => {
    const httpList = await request(appCtx.app)
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 100, method: 'tools/list' });
    expect(httpList.status).toBe(200);
    expect(httpList.body.result.tools).toHaveLength(4);

    const httpEval = await request(appCtx.app)
      .post('/api/mcp')
      .send({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'evaluate_mission',
          arguments: {
            siteId: 'apollo-11',
            startUtc: '2027-01-15T12:00:00Z',
            hasRelaySatellite: true,
          },
        },
      });
    expect(httpEval.status).toBe(200);
    expect(httpEval.body.result.structuredContent.evaluation.verdict).toBeDefined();

    const httpNotif = await request(appCtx.app)
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(httpNotif.status).toBe(204);

    const demoReport = await runMcpCliDemo(mcpServer);
    expect(demoReport).toContain('SERVIDOR MCP PROPIO');
    expect(demoReport).toContain('evaluate_mission');
    expect(demoReport).toContain('find_best_2027_windows');
    expect(demoReport).toContain('compare_lunar_sites');
  });
});
