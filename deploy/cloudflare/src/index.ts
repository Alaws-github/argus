// The ARGUS Worker. Static screens come from ASSETS; /api and /socket.io go to
// the single ARGUS server container, with the visitor's address passed on so
// the audit log records where each action came from.
import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  ARGUS: DurableObjectNamespace<ArgusServer>;
  ASSETS: Fetcher;
  // Secrets (npx wrangler secret put ...)
  DATABASE_URL: string;
  SECRET_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  ANTHROPIC_API_KEY?: string;
  // Plain settings (wrangler.jsonc "vars")
  R2_BUCKET: string;
  PUBLIC_URL?: string;
}

export class ArgusServer extends Container<Env> {
  defaultPort = 4300;
  // Sleeps after 30 minutes with no requests; the next visit wakes it in a few seconds.
  sleepAfter = '30m';

  // The empty props type is the one Cloudflare's Container class declares.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      PORT: '4300',
      DATABASE_URL: env.DATABASE_URL,
      SECRET_KEY: env.SECRET_KEY,
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
      R2_BUCKET: env.R2_BUCKET,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      ...(env.PUBLIC_URL ? { PUBLIC_URL: env.PUBLIC_URL } : {}),
      ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    };
  }
}

const server = (env: Env) => getContainer(env.ARGUS, 'argus');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
      const headers = new Headers(request.headers);
      headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
      headers.set('x-forwarded-proto', 'https');
      return server(env).fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  },

  // Hourly: wake the server so its schedules (evaluations, connector pulls) run.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await server(env).fetch(new Request('https://argus.internal/api/health'));
  },
} satisfies ExportedHandler<Env>;
