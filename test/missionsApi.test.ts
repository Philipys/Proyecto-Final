import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MissionPlan } from '../src/models/lunar.types.js';
import { createApp, type ServerAppContext } from '../src/server/app.js';

describe('Backend REST API + SQLite (docs/api.md & Escenario 7 BDD)', () => {
  let ctx: ServerAppContext;

  beforeAll(() => {
    ctx = createApp({ dbPath: ':memory:' });
  });

  afterAll(() => {
    ctx.repository.close();
  });

  it('GET /api/health y GET /api/sites devuelven el catálogo de 6 sitios oficiales', async () => {
    const healthRes = await request(ctx.app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const sitesRes = await request(ctx.app).get('/api/sites');
    expect(sitesRes.status).toBe(200);
    expect(sitesRes.body.sites).toHaveLength(6);
    expect(sitesRes.body.sites.map((s: { id: string }) => s.id)).toContain(
      'shackleton-rim',
    );
  });

  it('GET /api/sites/:id/telemetry retorna 48 horas reales y rechaza rangos o sitios inválidos', async () => {
    const okRes = await request(ctx.app).get(
      '/api/sites/shackleton-rim/telemetry?start=2027-01-01T00:00:00Z&hours=48',
    );
    expect(okRes.status).toBe(200);
    expect(okRes.body.hours).toBe(48);
    expect(okRes.body.telemetry).toHaveLength(48);
    expect(okRes.body.telemetry[0].utcIso).toBe('2027-01-01T00:00:00Z');

    const notFoundRes = await request(ctx.app).get(
      '/api/sites/sitio-inexistente/telemetry?hours=24',
    );
    expect(notFoundRes.status).toBe(404);

    const zeroHoursRes = await request(ctx.app).get(
      '/api/sites/shackleton-rim/telemetry?hours=0',
    );
    expect(zeroHoursRes.status).toBe(400);

    const overHoursRes = await request(ctx.app).get(
      '/api/sites/shackleton-rim/telemetry?hours=900',
    );
    expect(overHoursRes.status).toBe(400);
  });

  it('GET /api/sites/:id/best-windows devuelve las 3 mejores ventanas en 2027', async () => {
    const res = await request(ctx.app).get(
      '/api/sites/shackleton-rim/best-windows?durationHours=72&hasRelaySatellite=true',
    );
    expect(res.status).toBe(200);
    expect(res.body.durationHours).toBe(72);
    expect(res.body.hasRelaySatellite).toBe(true);
    expect(res.body.windows).toHaveLength(3);
    expect(res.body.windows[0].viabilityScore).toBeGreaterThanOrEqual(
      res.body.windows[1].viabilityScore,
    );
  });

  it('GET /api/sites/compare (RF-07) y GET /api/lola-dem (RF-02) devuelven datos reales', async () => {
    const compareRes = await request(ctx.app).get(
      '/api/sites/compare?siteA=apollo-11&siteB=shackleton-rim',
    );
    expect(compareRes.status).toBe(200);
    expect(compareRes.body.year).toBe(2027);
    expect(compareRes.body.siteA.site.id).toBe('apollo-11');
    expect(compareRes.body.siteB.site.id).toBe('shackleton-rim');
    expect(compareRes.body.siteA.monthly).toHaveLength(12);
    expect(compareRes.body.siteB.monthly).toHaveLength(12);

    const lolaRes = await request(ctx.app).get('/api/lola-dem');
    expect(lolaRes.status).toBe(200);
    expect(lolaRes.body.gridRows).toBe(48);
    expect(lolaRes.body.gridCols).toBe(48);
    expect(lolaRes.body.cellSpacingM).toBe(80);
    expect(lolaRes.body.elevationsM).toHaveLength(48);
  });

  it('POST /api/missions/evaluate evalúa las 5 reglas de negocio sin persistir', async () => {
    const evalRes = await request(ctx.app)
      .post('/api/missions/evaluate')
      .send({
        siteId: 'shackleton-rim',
        startUtc: '2027-01-01T00:00Z',
        durationHours: 48,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.5,
        solarPanelMaxKw: 4.5,
        hasRelaySatellite: true,
        waypoints: [
          { latitudeDeg: -89.45, longitudeDeg: 130.0, elevationM: -350 },
          { latitudeDeg: -89.43, longitudeDeg: 130.5, elevationM: -310 },
        ],
      });

    expect(evalRes.status).toBe(200);
    expect(['GO', 'CAUTION', 'NO-GO']).toContain(evalRes.body.verdict);
    expect(evalRes.body.rules.lighting).toBeDefined();
    expect(evalRes.body.rules.energy).toBeDefined();
    expect(evalRes.body.rules.communications.relayActive).toBe(true);
    expect(evalRes.body.rules.terrain).toBeDefined();
    expect(evalRes.body.rules.eva.waypointCount).toBe(2);
  });

  it('Escenario 7 BDD: ciclo completo CRUD en SQLite con recálculo automático en PUT y cascada en DELETE', async () => {
    // 1. Crear plan en cara oculta (Chang'e-4) sin Relay -> NO-GO por comunicaciones
    const createRes = await request(ctx.app)
      .post('/api/missions')
      .send({
        name: 'Exploración Von Kármán Fase 1',
        notes: 'Plan inicial sin satélite retransmisor',
        siteId: 'change-4',
        startUtc: '2027-01-01T00:00:00Z',
        durationHours: 48,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.5,
        solarPanelMaxKw: 3.5,
        hasRelaySatellite: false,
        waypoints: [
          { latitudeDeg: -45.445, longitudeDeg: 177.599, elevationM: -5920 },
          { latitudeDeg: -45.42, longitudeDeg: 177.65, elevationM: -5905 },
        ],
      });

    expect(createRes.status).toBe(201);
    const created = createRes.body as MissionPlan;
    expect(created.id).toBeTruthy();
    expect(created.evaluation.verdict).toBe('NO-GO');
    expect(created.evaluation.rules.communications.status).toBe('NO-GO');
    expect(created.config.waypoints).toHaveLength(2);

    // 2. Listar y consultar detalle por ID
    const listRes = await request(ctx.app).get('/api/missions');
    expect(listRes.status).toBe(200);
    expect(
      listRes.body.missions.some((m: MissionPlan) => m.id === created.id),
    ).toBe(true);

    const getRes = await request(ctx.app).get(`/api/missions/${created.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.config.waypoints).toHaveLength(2);
    expect(getRes.body.config.waypoints[1].longitudeDeg).toBeCloseTo(177.65, 3);

    // 3. Actualizar notas y habilitar Relay -> recálculo automático a GO
    const putRes = await request(ctx.app)
      .put(`/api/missions/${created.id}`)
      .send({
        notes: 'Satélite Queqiao/Relay activado',
        hasRelaySatellite: true,
      });

    expect(putRes.status).toBe(200);
    const updated = putRes.body as MissionPlan;
    expect(updated.notes).toBe('Satélite Queqiao/Relay activado');
    expect(updated.config.hasRelaySatellite).toBe(true);
    expect(updated.evaluation.rules.communications.status).toBe('GO');
    expect(updated.evaluation.verdict).toBe('GO');
    expect(updated.config.waypoints).toHaveLength(2);

    // 4. Eliminar plan y verificar cascada / 404 posterior
    const deleteRes = await request(ctx.app).delete(
      `/api/missions/${created.id}`,
    );
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ deleted: true, id: created.id });

    const afterDeleteRes = await request(ctx.app).get(
      `/api/missions/${created.id}`,
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it('Seguridad (RNF-01 / RNF-02): valida rangos, sanitiza XSS, resiste SQLi y rechaza JSON malformado', async () => {
    // Coordenadas fuera de rango -> 400
    const badCoordsRes = await request(ctx.app)
      .post('/api/missions/evaluate')
      .send({
        siteId: 'apollo-11',
        startUtc: '2027-01-10T00:00:00Z',
        durationHours: 24,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.5,
        solarPanelMaxKw: 3.5,
        hasRelaySatellite: true,
        waypoints: [{ latitudeDeg: -95, longitudeDeg: 200 }],
      });
    expect(badCoordsRes.status).toBe(400);

    // Sanitización XSS y resistencia a SQL injection mediante prepared statements
    const xssAndSqliRes = await request(ctx.app)
      .post('/api/missions')
      .send({
        name: 'Misión Segura <script>alert("xss")</script> \' OR 1=1 --',
        notes: '<img src=x onerror=alert(1)>Observación técnica \' OR 1=1 --',
        siteId: 'apollo-11',
        startUtc: '2027-01-15T12:00:00Z',
        durationHours: 24,
        batteryCapacityKwh: 120,
        baseConsumptionKw: 1.5,
        solarPanelMaxKw: 3.5,
        hasRelaySatellite: true,
      });

    expect(xssAndSqliRes.status).toBe(201);
    const sanitizedPlan = xssAndSqliRes.body as MissionPlan;
    expect(sanitizedPlan.name).not.toContain('<script>');
    expect(sanitizedPlan.notes).not.toContain('<img');
    expect(sanitizedPlan.notes).toContain('Observación técnica');

    // SQLi en parámetro de ruta -> 404 limpio, sin error SQL interno
    const sqliParamRes = await request(ctx.app).get(
      "/api/missions/' OR 1=1 --",
    );
    expect(sqliParamRes.status).toBe(404);
    expect(JSON.stringify(sqliParamRes.body)).not.toContain('SQLITE');

    // Limpieza del registro de prueba
    await request(ctx.app).delete(`/api/missions/${sanitizedPlan.id}`);

    // JSON malformado -> 400
    const malformedRes = await request(ctx.app)
      .post('/api/missions')
      .set('Content-Type', 'application/json')
      .send('{"name": "rotura",');
    expect(malformedRes.status).toBe(400);
  });
});
