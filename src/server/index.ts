import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/lunar_missions.sqlite';
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const { app, repository } = createApp({ dbPath, corsOrigin });

const server = app.listen(port, () => {
  console.info(
    `[Artemis Lunar Navigator API] escuchando en http://localhost:${port} (BD: ${dbPath})`,
  );
});

function shutdown(): void {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
