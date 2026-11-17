import { describe, expect, it, vi } from 'vitest';
import type { MissionConfig } from '../src/models/lunar.types.js';
import { ApiClientError, MissionApiClient } from '../src/services/MissionApiClient.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SAMPLE_CONFIG: MissionConfig = {
  siteId: 'shackleton-rim',
  startUtc: '2027-01-01T00:00:00Z',
  durationHours: 24,
  batteryCapacityKwh: 120,
  baseConsumptionKw: 1.5,
  solarPanelMaxKw: 3.5,
  hasRelaySatellite: true,
};

describe('MissionApiClient', () => {
  it('invoca todos los endpoints REST de lectura, evaluación y comparación correctamente', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sites: [{ id: 'shackleton-rim' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          site: { id: 'shackleton-rim' },
          startUtc: '2027-01-01T00:00:00Z',
          hours: 24,
          telemetry: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          site: { id: 'shackleton-rim' },
          durationHours: 24,
          hasRelaySatellite: true,
          windows: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ year: 2027 }))
      .mockResolvedValueOnce(jsonResponse({ gridRows: 48, gridCols: 48 }))
      .mockResolvedValueOnce(jsonResponse({ verdict: 'GO', viabilityScore: 95 }));

    const client = new MissionApiClient('/api', fetchMock);

    const sites = await client.getSites();
    expect(sites).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sites');

    await client.getTelemetryWindow('shackleton-rim', '2027-01-01T00:00:00Z', 24);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/sites/shackleton-rim/telemetry?');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('hours=24');

    await client.getBestWindows('shackleton-rim', {
      durationHours: 24,
      hasRelaySatellite: true,
      batteryCapacityKwh: 120,
      baseConsumptionKw: 1.5,
      solarPanelMaxKw: 3.5,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/api/sites/shackleton-rim/best-windows?');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('hasRelaySatellite=true');

    await client.compareSites('apollo-11', 'shackleton-rim');
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      '/api/sites/compare?siteA=apollo-11&siteB=shackleton-rim',
    );

    const lola = await client.getLolaDemSample();
    expect(lola.gridRows).toBe(48);
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/lola-dem');

    const evalRes = await client.evaluateMission(SAMPLE_CONFIG);
    expect(evalRes.verdict).toBe('GO');
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe('POST');
  });

  it('ejecuta el ciclo CRUD completo de misiones (GET, POST, PUT, DELETE)', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ missions: [{ id: 'm-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'm-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'm-2', name: 'Artemis Test' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'm-2', name: 'Artemis Updated' }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true, id: 'm-2' }));

    const client = new MissionApiClient('http://localhost:3000/api/', fetchMock);

    const list = await client.listMissions();
    expect(list).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/missions');

    const one = await client.getMissionById('m-1');
    expect(one.id).toBe('m-1');

    const created = await client.createMission({
      name: 'Artemis Test',
      notes: 'Nota inicial',
      config: SAMPLE_CONFIG,
    });
    expect(created.id).toBe('m-2');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST');

    const updated = await client.updateMission('m-2', {
      name: 'Artemis Updated',
      notes: 'Nota actualizada',
    });
    expect(updated.name).toBe('Artemis Updated');
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('PUT');

    const deleted = await client.deleteMission('m-2');
    expect(deleted.deleted).toBe(true);
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe('DELETE');
  });

  it('lanza ApiClientError con código HTTP y mensaje estructurado ante fallos', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Sitio lunar no encontrado.' }, 404))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const client = new MissionApiClient('/api', fetchMock);

    await expect(client.getMissionById('missing')).rejects.toMatchObject({
      name: 'ApiClientError',
      statusCode: 404,
      message: 'Sitio lunar no encontrado.',
    });

    await expect(client.getSites()).rejects.toBeInstanceOf(ApiClientError);

    await expect(client.listMissions()).rejects.toMatchObject({
      statusCode: 0,
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });
});
