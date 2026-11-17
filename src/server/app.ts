import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cors from 'cors';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { evaluateMissionAtStart } from '../domain/MissionEvaluator.js';
import type { MissionPlan } from '../models/lunar.types.js';
import { SqliteMissionRepository } from './SqliteMissionRepository.js';
import { TelemetryCatalogService } from './TelemetryCatalogService.js';
import {
  NotFoundError,
  ValidationError,
  validateCreateMissionInput,
  validateMissionConfigInput,
  validateUpdateMissionInput,
} from './validators.js';

export interface CreateAppOptions {
  readonly dbPath?: string;
  readonly dataDir?: string;
  readonly corsOrigin?: string;
}

export interface ServerAppContext {
  readonly app: Express;
  readonly repository: SqliteMissionRepository;
  readonly catalogService: TelemetryCatalogService;
}

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

function getParamId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || id.length > 128) {
    throw new ValidationError('Identificador de recurso inválido.');
  }
  return id;
}

function isMalformedJsonError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) {
    return false;
  }
  const maybeBodyErr = err as { type?: unknown; status?: unknown };
  return (
    maybeBodyErr.type === 'entity.parse.failed' ||
    maybeBodyErr.status === 400 ||
    'body' in err
  );
}

/**
 * Construye la aplicación Express con todas las rutas REST documentadas en `docs/api.md`,
 * validación estricta de entradas y repositorio SQLite parametrizado.
 */
export function createApp(options: CreateAppOptions = {}): ServerAppContext {
  const dbPath =
    options.dbPath ?? process.env.DB_PATH ?? './data/lunar_missions.sqlite';
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), 'data');
  const configuredOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN;
  const corsOrigin: string | string[] = configuredOrigin
    ? configuredOrigin
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  const repository = new SqliteMissionRepository(dbPath);
  const catalogService = new TelemetryCatalogService(dataDir);
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'artemis-lunar-navigator-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/sites', (_req: Request, res: Response) => {
    res.status(200).json({ sites: catalogService.getSites() });
  });

  app.get(
    '/api/sites/compare',
    asyncHandler(async (req, res) => {
      const comparison = await catalogService.compareSites(
        req.query.siteA,
        req.query.siteB,
      );
      res.status(200).json(comparison);
    }),
  );

  app.get(
    '/api/sites/:id/telemetry',
    asyncHandler(async (req, res) => {
      const siteId = getParamId(req);
      const result = await catalogService.getTelemetryWindow(
        siteId,
        req.query.start,
        req.query.hours,
      );
      res.status(200).json(result);
    }),
  );

  app.get(
    '/api/sites/:id/best-windows',
    asyncHandler(async (req, res) => {
      const siteId = getParamId(req);
      const result = await catalogService.getBestWindows(siteId, {
        durationHours: req.query.durationHours,
        hasRelaySatellite: req.query.hasRelaySatellite,
        batteryCapacityKwh: req.query.batteryCapacityKwh,
        baseConsumptionKw: req.query.baseConsumptionKw,
        solarPanelMaxKw: req.query.solarPanelMaxKw,
      });
      res.status(200).json(result);
    }),
  );

  app.get(
    '/api/lola-dem',
    asyncHandler(async (_req, res) => {
      const demSample = await catalogService.getLolaDemSample();
      res.status(200).json(demSample);
    }),
  );

  app.post(
    '/api/missions/evaluate',
    asyncHandler(async (req, res) => {
      const config = validateMissionConfigInput(req.body);
      const annual = await catalogService.getAnnualTelemetry(config.siteId);
      const evaluation = evaluateMissionAtStart(annual, config);
      res.status(200).json(evaluation);
    }),
  );

  app.get('/api/missions', (_req: Request, res: Response) => {
    const missions = repository.listAll();
    res.status(200).json({ missions });
  });

  app.get('/api/missions/:id', (req: Request, res: Response) => {
    const id = getParamId(req);
    const mission = repository.findById(id);
    if (!mission) {
      throw new NotFoundError(`Plan de misión no encontrado: "${id}".`);
    }
    res.status(200).json(mission);
  });

  app.post(
    '/api/missions',
    asyncHandler(async (req, res) => {
      const validated = validateCreateMissionInput(req.body);
      const annual = await catalogService.getAnnualTelemetry(validated.config.siteId);
      const evaluation = evaluateMissionAtStart(annual, validated.config);
      const now = new Date().toISOString();

      const plan: MissionPlan = {
        id: randomUUID(),
        name: validated.name,
        config: validated.config,
        evaluation,
        notes: validated.notes,
        createdAt: now,
        updatedAt: now,
      };

      const created = repository.create(plan);
      res.status(201).json(created);
    }),
  );

  app.put(
    '/api/missions/:id',
    asyncHandler(async (req, res) => {
      const id = getParamId(req);
      const existing = repository.findById(id);
      if (!existing) {
        throw new NotFoundError(`Plan de misión no encontrado: "${id}".`);
      }

      const validated = validateUpdateMissionInput(req.body, existing);
      const annual = await catalogService.getAnnualTelemetry(validated.config.siteId);
      const evaluation = evaluateMissionAtStart(annual, validated.config);

      const updatedPlan: MissionPlan = {
        id: existing.id,
        name: validated.name,
        config: validated.config,
        evaluation,
        notes: validated.notes,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      const persisted = repository.update(updatedPlan);
      if (!persisted) {
        throw new NotFoundError(`Plan de misión no encontrado: "${id}".`);
      }

      res.status(200).json(persisted);
    }),
  );

  app.delete('/api/missions/:id', (req: Request, res: Response) => {
    const id = getParamId(req);
    const deleted = repository.deleteById(id);
    if (!deleted) {
      throw new NotFoundError(`Plan de misión no encontrado: "${id}".`);
    }
    res.status(200).json({ deleted: true, id });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint de API no encontrado.' });
  });

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      if (isMalformedJsonError(err)) {
        res.status(400).json({ error: 'JSON malformado en el cuerpo de la petición.' });
        return;
      }

      if (err instanceof ValidationError || err instanceof RangeError) {
        res.status(400).json({ error: err.message });
        return;
      }

      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }

      if (process.env.NODE_ENV !== 'test') {
        console.error('[API ERROR]', err);
      }
      res.status(500).json({ error: 'Error interno del servidor.' });
    },
  );

  return { app, repository, catalogService };
}
