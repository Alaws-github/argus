import './env.js';
// Server entry point: opens the database, upgrades it, adds the demo data,
// starts the web API, live updates (Socket.IO) and the agent engine, and in
// production serves the built web app too.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { getDb, migrate } from './db.js';
import { ensureBaseline, seed } from './seed.js';
import { routes } from './routes.js';
import { attach } from './realtime.js';
import { startEngine } from './engine.js';
import { accessGuard } from './access.js';
import { startMonitoring } from './monitoring.js';
import { startSuiteRun } from './routes-grc.js';
import { setInternalToken, withRequestContext } from './context.js';
import { INTERNAL_TOKEN } from './assistant.js';
import { archiveGuard } from './archive.js';
import { authMiddleware, readCookie, userFromToken } from './auth.js';

const PORT = Number(process.env.PORT || 4300);
const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(here, '../../web/dist');

const db = await getDb();
await migrate(db);
if (await seed(db)) console.log('[seed] created the Client Zero demo engagement');
await ensureBaseline(db);

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy, set TRUST_PROXY=true so audit entries record the client's address.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', true);
setInternalToken(INTERNAL_TOKEN);
app.use(withRequestContext);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// Evidence uploads arrive as base64 JSON, so that one route takes a larger body.
app.use('/api/evidence', express.json({ limit: '15mb' }));
app.use(/^\/api\/engagements\/[^/]+\/controls\/import$/, express.json({ limit: '15mb' }));
app.use(/^\/api\/engagements\/[^/]+\/knowledge$/, express.json({ limit: '15mb' }));
app.use(express.json({ limit: '256kb' }));
app.use('/api', authMiddleware(db));
app.use('/api', accessGuard(db));
app.use('/api', archiveGuard(db));
app.use('/api', routes(db));

// In production the server also serves the built web app.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(resolve(WEB_DIST, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  }
  // A malformed id in the URL (Postgres invalid_text_representation) is a miss, not a crash.
  const status = err.status || (err.code === '22P02' ? 404 : 500);
  if (err.code === '22P02') err.message = 'Not found';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
});

const http = createServer(app);
const io = new Server(http, { cors: { origin: false } });
// Live updates only go to signed-in browsers.
io.use((socket, next) => {
  userFromToken(db, readCookie(socket.handshake.headers.cookie))
    .then((u) => {
      if (!u) return next(new Error('Sign in to continue'));
      socket.data.user = { id: u.id, role: u.role };
      next();
    })
    .catch(() => next(new Error('Sign in to continue')));
});
attach(io, db);
startEngine(db);
startMonitoring(db, (id, actor) => startSuiteRun(db, id, actor));

http.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  db=${db.kind}  models: see /models in the app`);
});
