// Builds the developer docs from the code, so they can't drift from it (v1.7.8):
//   docs/API.md               every API route: method, path, permission, request schema, where it is
//   docs/api/openapi.json     the same as OpenAPI 3.1, with request bodies from the Zod schemas
//   apps/server/src/<feature>/README.md and apps/web/src/features/<feature>/README.md
//                             what the feature is, each file's purpose (its header comment) and its routes or pages
// Run with `npm run docs`. `npm run check:docs` fails if any of these files is out of date.
// Runs under tsx because it imports the server's router and the shared Zod schemas.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative as relativeOs, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A relative path with forward slashes, so the docs are the same on Windows and Linux. */
const relative = (from, to) => relativeOs(from, to).replace(/\\/g, '/');
/** A file's text with Windows line endings made plain, for the same reason. */
const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = join(ROOT, 'apps/server/src');
const WEB = join(ROOT, 'apps/web/src');
const CHECK = process.argv.includes('--check');
const shared = await import(pathToFileURL(join(ROOT, 'packages/shared/src/index.ts')).href);
const { apiRouter } = await import(pathToFileURL(join(SERVER, 'api-router.ts')).href);
const { permissionFor, isPublicPath } = await import(pathToFileURL(join(SERVER, 'auth/auth.ts')).href);

/** What each feature folder is for. Kept here so a new folder can't go undescribed: the build fails without one. */
const FEATURES = {
  server: {
    core: 'What every feature uses: the database and schema, file paths, encryption, storage, live updates, file reading and the shared HTTP helpers.',
    audit: 'The hash-chained audit log: writing entries in the same transaction as each change (rule 5), browsing and verifying the chain.',
    auth: 'Sign-in, sessions, roles and permissions, segregation of duties, act as, members-only engagements and single sign-on.',
    engagements: 'Client engagements: list, create (with the wizard\'s starting points), update, archive, export and delete; the KPI and Overview numbers.',
    board: 'The use case board and its gate engine: picking up cards, running agents, item-by-item decisions, exit criteria and gate actions.',
    agents: 'The AI agents: one file per agent, the agent loop and its read-only tools, the Use Case Planner, agent settings and the kill switch.',
    ai: 'AI model providers (Models & keys) and the model calls: retries, repair, tool steps and the offline rules provider.',
    settings: 'Workspace settings, and reading settings, engagements, cards and other records into API shapes.',
    assistant: 'The assistant: what it is shown, its answers and the only changes it may suggest (rule 15), and each person\'s conversations.',
    knowledge: 'The knowledge base: ingesting documents, splitting them into passages, keyword and meaning search, and retrieval checks.',
    'agent-testing': 'Testing the agents: golden runs against known right answers, and the Verifier, measured against people\'s judgement.',
    controls: 'The control library (including healthcare), the control register, the Statement of Applicability, traceability, Across Frameworks and Every Requirement.',
    testing: 'Control tests (with preparers and reviewers) and evidence (fingerprinted with SHA-256).',
    issues: 'Issues and their defect-style lifecycle.',
    inventory: 'The AI inventory and the agent register checks.',
    evals: 'Evaluation suites: cases, runs, the LLM judge, schedules and the alerts a run raises.',
    monitoring: 'The scheduler tick: evaluation suites, connector pulls, write-back sends and client step checks.',
    reporting: 'The readiness assessment and the board report.',
    risks: 'The risk register.',
    incidents: 'Incidents, their regulatory notification clocks and timeline.',
    integrations: 'The client\'s tools: read-only connectors, client workflows and client step checks, write-back and pipeline ingest tokens.',
    setup: 'Seeding a new database and resetting it (npm run db:reset).',
  },
  web: {
    board: 'The use case board, the Use Case Planner, the use case drawer and its panels, and agent runs.',
    engagements: 'Overview, adding an engagement, and Settings with one component per tab.',
    controls: 'Controls: Standards, Every Requirement, the register, the library, the SoA, traceability and Across Frameworks.',
    integrations: 'Client workflows and their builder, connectors, client steps, pipeline tokens and write-back.',
    ai: 'Models & keys: AI providers and their models.',
    assistant: 'The assistant panel (Ask).',
    'agent-testing': 'Checking the AI: golden runs, the Verifier, retrieval and history, one component per tab.',
    auth: 'Signing in, and single sign-on settings.',
    workspace: 'Workspace settings, people and your account.',
    audit: 'The audit log.',
    risks: 'The risk register.',
    testing: 'Tests and Evidence.',
    issues: 'Issues.',
    incidents: 'Incidents.',
    evals: 'Evaluation suites and their cases and runs.',
    inventory: 'The AI inventory.',
    reporting: 'The board report.',
    knowledge: 'The knowledge base.',
  },
};

const GENERATED = '<!-- Generated by `npm run docs` from the code. Edit the code comments, not this file. -->';
const outputs = new Map(); // path -> text
const emit = (path, text) => outputs.set(path, text.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');

// ------------------------------------------------------------------ Zod to JSON Schema (zod v3)
function toJson(s) {
  const d = s?._def;
  if (!d) return {};
  switch (d.typeName) {
    case 'ZodString': {
      const o = { type: 'string' };
      for (const c of d.checks ?? []) {
        if (c.kind === 'min') o.minLength = c.value;
        if (c.kind === 'max') o.maxLength = c.value;
        if (c.kind === 'email') o.format = 'email';
        if (c.kind === 'url') o.format = 'uri';
        if (c.kind === 'regex') o.pattern = c.regex.source;
      }
      return o;
    }
    case 'ZodNumber': {
      const o = { type: (d.checks ?? []).some((c) => c.kind === 'int') ? 'integer' : 'number' };
      for (const c of d.checks ?? []) {
        if (c.kind === 'min') o.minimum = c.value;
        if (c.kind === 'max') o.maximum = c.value;
      }
      return o;
    }
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodLiteral': return { const: d.value };
    case 'ZodEnum': return { type: 'string', enum: d.values };
    case 'ZodNativeEnum': return { enum: Object.values(d.values) };
    case 'ZodArray': {
      const o = { type: 'array', items: toJson(d.type) };
      if (d.minLength) o.minItems = d.minLength.value;
      if (d.maxLength) o.maxItems = d.maxLength.value;
      return o;
    }
    case 'ZodObject': {
      const shape = typeof d.shape === 'function' ? d.shape() : d.shape;
      const properties = {}; const required = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = toJson(v);
        if (!v.isOptional()) required.push(k);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}) };
    }
    case 'ZodRecord': return { type: 'object', additionalProperties: toJson(d.valueType) };
    case 'ZodUnion': case 'ZodDiscriminatedUnion': return { anyOf: [...(d.options?.values?.() ?? d.options)].map(toJson) };
    case 'ZodOptional': return toJson(d.innerType);
    case 'ZodNullable': return { anyOf: [toJson(d.innerType), { type: 'null' }] };
    case 'ZodDefault': return { ...toJson(d.innerType), default: d.defaultValue() };
    case 'ZodEffects': return toJson(d.schema);
    case 'ZodPipeline': return toJson(d.in);
    case 'ZodLazy': return toJson(d.getter());
    case 'ZodAny': case 'ZodUnknown': return {};
    default: return {};
  }
}
const fieldRows = (js) =>
  Object.entries(js.properties ?? {}).map(([k, v]) => {
    const t = v.enum ? v.enum.map((x) => `\`${x}\``).join(', ') : v.anyOf ? v.anyOf.map((x) => x.type ?? (x.enum ? 'enum' : 'object')).join(' or ') : v.type === 'array' ? `array of ${v.items?.type ?? 'object'}` : v.type ?? 'any';
    const limits = [v.minLength != null && `min ${v.minLength}`, v.maxLength != null && `max ${v.maxLength}`, v.minimum != null && `≥ ${v.minimum}`, v.maximum != null && `≤ ${v.maximum}`].filter(Boolean).join(', ');
    return `| \`${k}\` | ${t}${limits ? ` (${limits})` : ''} | ${(js.required ?? []).includes(k) ? 'yes' : ''} |`;
  });

// ------------------------------------------------------------------ files and their header comments
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === 'prompts' ? [] : walk(join(d, f))) : [join(d, f)]));
function headerOf(file) {
  let t = readText(file);
  if (file.endsWith('.vue')) t = (t.match(/<script[^>]*>([\s\S]*?)<\/script>/) ?? ['', ''])[1].trimStart();
  const lines = [];
  for (const l of t.split('\n')) {
    if (/^\s*import /.test(l) && !lines.length) continue;
    if (/^\s*\/\//.test(l)) lines.push(l.replace(/^\s*\/\/\s?/, ''));
    else if (lines.length || l.trim()) break;
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  const first = text.match(/^(.*?[.!?])(\s|$)/);
  return (first ? first[1] : text).slice(0, 260) || '(no header comment)';
}

// ------------------------------------------------------------------ routes, from the real router
const stub = new Proxy({}, { get: () => () => { throw new Error('db used at registration'); } });
const registered = [];
for (const l of apiRouter(stub).stack) if (l.route) for (const m of Object.keys(l.route.methods)) registered.push({ method: m.toUpperCase(), path: l.route.path });
registered.push({ method: 'POST', path: '/ingest/evidence', ingest: true }); // mounted before sign-in in index.ts (rule 31)

// Where each route is registered, and the schema its handler parses.
const sources = walk(SERVER).filter((f) => f.endsWith('.ts'));
const texts = Object.fromEntries(sources.map((f) => [f, readText(f)]));
function locate(route) {
  for (const [file, t] of Object.entries(texts)) {
    const re = new RegExp(`r\\.${route.method.toLowerCase()}\\(\\s*(['\`])${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);
    const m = re.exec(t);
    if (!m) continue;
    const rest = t.slice(m.index);
    const next = rest.slice(5).search(/\n {2}r\.(get|post|put|patch|delete)\(/);
    const handler = next < 0 ? rest : rest.slice(0, next + 5);
    return { file, body: schemaExpr(handler, 'body'), query: schemaExpr(handler, 'query') };
  }
  return { file: null, body: null, query: null };
}
/** The schema a handler parses its body or query with: a name (IssueInput) or the inline expression's source. */
function schemaExpr(handler, part) {
  const at = handler.indexOf(`.parse(req.${part}`);
  if (at < 0) return null;
  const start = handler.lastIndexOf('= ', at) + 2;
  const expr = handler.slice(start, at).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ \./g, '.').replace(/,\s*([})])/g, ' $1').trim();
  const named = /^(\w+)(\.partial\(\))?$/.exec(expr);
  return named ? { name: named[1] } : { inline: expr };
}
const sample = (path) => path.replace(/:(\w+)(\([^)]*\))?/g, (_m, _n, c) => (c ? c.slice(1).split('|')[0] : 'x'));
const routes = registered.map((r) => {
  const loc = locate(r);
  const feature = loc.file ? relative(SERVER, loc.file).split('/')[0] : 'integrations';
  const schemaOf = (s) => {
    if (!s) return null;
    if (s.inline) return { name: '(inline schema)', inline: s.inline, json: null };
    if (shared[s.name]?._def) return { name: s.name, from: '@gh/shared', json: toJson(shared[s.name]) };
    return { name: s.name, from: loc.file ? relative(ROOT, loc.file).replace(/\\/g, '/') : '', json: null };
  };
  return {
    ...r,
    feature,
    file: loc.file ? relative(ROOT, loc.file).replace(/\\/g, '/') : 'apps/server/src/integrations/ingest.ts',
    permission: r.ingest ? 'ingest token (Bearer)' : isPublicPath(sample(r.path)) ? 'none (public)' : permissionFor(r.method, sample(r.path)),
    body: schemaOf(r.ingest ? { name: 'IngestEvidence' } : loc.body),
    query: schemaOf(loc.query),
  };
});

// ------------------------------------------------------------------ docs/API.md
const byFeature = {};
for (const r of routes) (byFeature[r.feature] ??= []).push(r);
const md = [
  '# API reference',
  '',
  GENERATED,
  '',
  `Every route the server registers (${routes.length}), by feature. Paths are under \`/api\`. Sign in with a session cookie (\`POST /api/auth/login\`); the permission column is what your role needs (see \`permissionFor\` in \`apps/server/src/auth/auth.ts\`). Members-only engagements answer 404 to non-members, and archived engagements refuse changes (rules 9 and 16). Request schemas come from the Zod schemas in \`@gh/shared\`; the same is in \`docs/api/openapi.json\`.`,
  '',
];
for (const f of Object.keys(byFeature).sort()) {
  md.push(`## ${f}`, '', FEATURES.server[f] ?? '', '');
  for (const r of byFeature[f]) {
    md.push(`### \`${r.method} /api${r.path}\``, '', `Permission: ${r.permission}. Registered in \`${r.file}\`.`, '');
    for (const [label, s] of [['Body', r.body], ['Query', r.query]]) {
      if (!s) continue;
      if (s.json?.properties) md.push(`${label}: \`${s.name}\` (${s.from})`, '', '| Field | Type | Required |', '|---|---|---|', ...fieldRows(s.json), '');
      else if (s.inline) md.push(`${label}: checked by this schema in the handler:`, '', '```ts', s.inline.length > 600 ? `${s.inline.slice(0, 600)} ...` : s.inline, '```', '');
      else md.push(`${label}: \`${s.name}\`${s.from ? `, defined in \`${s.from}\`` : ''}.`, '');
    }
  }
}
emit(join(ROOT, 'docs/API.md'), md.join('\n'));

// ------------------------------------------------------------------ docs/api/openapi.json
const openapi = {
  openapi: '3.1.0',
  info: { title: 'ARGUS API', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, description: 'Generated by npm run docs from the server router and the Zod schemas.' },
  servers: [{ url: '/api' }],
  components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'gh_session' }, ingestToken: { type: 'http', scheme: 'bearer' } } },
  paths: {},
};
for (const r of routes) {
  const p = r.path.replace(/:(\w+)(\([^)]*\))?/g, '{$1}');
  const params = [...r.path.matchAll(/:(\w+)(\(([^)]*)\))?/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: m[3] ? { type: 'string', enum: m[3].split('|') } : { type: 'string' } }));
  const op = {
    tags: [r.feature],
    summary: `${r.method} ${r.path}`,
    description: `Permission: ${r.permission}. Registered in ${r.file}.`,
    security: r.ingest ? [{ ingestToken: [] }] : r.permission === 'none (public)' ? [] : [{ session: [] }],
    ...(params.length ? { parameters: params } : {}),
    ...(r.body?.json ? { requestBody: { required: true, content: { 'application/json': { schema: r.body.json } } } } : {}),
    responses: { 200: { description: 'OK' } },
  };
  (openapi.paths[p] ??= {})[r.method.toLowerCase()] = op;
}
emit(join(ROOT, 'docs/api/openapi.json'), JSON.stringify(openapi, null, 2));

// ------------------------------------------------------------------ feature READMEs
const title = (s) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
for (const dir of readdirSync(SERVER).filter((d) => statSync(join(SERVER, d)).isDirectory())) {
  if (!FEATURES.server[dir]) throw new Error(`No description for apps/server/src/${dir}: add it to FEATURES in scripts/docs/build-docs.mjs`);
  const files = walk(join(SERVER, dir)).filter((f) => /\.(ts|sql)$/.test(f)).sort();
  const lines = [`# ${title(dir)} (server)`, '', GENERATED, '', FEATURES.server[dir], '', '## Files', ''];
  for (const f of files) lines.push(`- \`${relative(join(SERVER, dir), f)}\`: ${f.endsWith('.sql') ? 'The database schema, append-only: each version adds its changes at the end.' : headerOf(f)}`);
  if (existsSync(join(SERVER, dir, 'prompts'))) lines.push('- `prompts/`: the agents\' rules files (rule 8).');
  const rs = byFeature[dir] ?? [];
  if (rs.length) lines.push('', '## Routes', '', 'Full detail, with request fields, in [`docs/API.md`](../../../../docs/API.md).', '', '| Method | Path | Permission | Body |', '|---|---|---|---|', ...rs.map((r) => `| ${r.method} | \`/api${r.path}\` | ${r.permission} | ${r.body ? `\`${r.body.name}\`` : ''} |`));
  emit(join(SERVER, dir, 'README.md'), lines.join('\n'));
}
// Web: which route shows which page (from main.ts).
const mainTs = readText(join(WEB, 'main.ts'));
const pageRoutes = [...mainTs.matchAll(/path: '([^']+)'[^}]*?import\('\.\/features\/([\w-]+)\/(\w+)\.vue'\)/g)].map((m) => ({ path: m[1], feature: m[2], page: m[3] }));
const directRoutes = [...mainTs.matchAll(/path: '([^']+)'[^}]*?component: (\w+)/g)];
for (const dir of readdirSync(join(WEB, 'features'))) {
  if (!FEATURES.web[dir]) throw new Error(`No description for apps/web/src/features/${dir}: add it to FEATURES in scripts/docs/build-docs.mjs`);
  const files = walk(join(WEB, 'features', dir)).filter((f) => /\.(ts|vue)$/.test(f)).sort();
  const lines = [`# ${title(dir)} (web)`, '', GENERATED, '', FEATURES.web[dir], '', '## Files', ''];
  for (const f of files) lines.push(`- \`${relative(join(WEB, 'features', dir), f)}\`: ${headerOf(f)}`);
  const pages = [
    ...pageRoutes.filter((p) => p.feature === dir).map((p) => [p.path, p.page]),
    ...directRoutes.filter((m) => existsSync(join(WEB, 'features', dir, `${m[2]}.vue`))).map((m) => [m[1], m[2]]),
  ];
  if (pages.length) lines.push('', '## Pages', '', '| Address | Page |', '|---|---|', ...pages.map(([a, p]) => `| \`${a}\` | \`${p}.vue\` |`));
  if (FEATURES.server[dir]) lines.push('', `The server side is in [\`apps/server/src/${dir}\`](../../../../server/src/${dir}/README.md).`);
  emit(join(WEB, 'features', dir, 'README.md'), lines.join('\n'));
}

// ------------------------------------------------------------------ write or check
const stale = [];
for (const [path, text] of outputs) {
  const old = existsSync(path) ? readText(path) : null;
  if (old === text) continue;
  if (CHECK) stale.push(relative(ROOT, path));
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
if (CHECK && stale.length) {
  console.error(`These docs are out of date. Run npm run docs:\n${stale.map((s) => `  ${s}`).join('\n')}`);
  process.exit(1);
}
console.log(`${CHECK ? 'Docs up to date' : 'Docs written'}: ${outputs.size} files, ${routes.length} routes.`);
process.exit(0);
