-- Governance & Risk harness schema. Idempotent: safe to run on every start.

CREATE TABLE IF NOT EXISTS engagements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  client      text NOT NULL DEFAULT '',
  prefix      text NOT NULL,
  color       text NOT NULL DEFAULT '#8b9dff',
  framework   text NOT NULL DEFAULT 'NIST AI RMF 1.0 · ISO/IEC 42001',
  gates       jsonb NOT NULL,
  card_seq    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A card is one AI use case moving through governance.
CREATE TABLE IF NOT EXISTS cards (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id     uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  number            integer NOT NULL,
  key               text NOT NULL UNIQUE,
  title             text NOT NULL,
  stage             text NOT NULL DEFAULT 'intake',
  status            text NOT NULL DEFAULT 'idle',
  status_note       text,
  use_case          jsonb NOT NULL,
  tier              text,
  classification    jsonb,
  latest_run_id     uuid,
  cost_usd          numeric(12,4) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  stage_entered_at  timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cards_engagement_stage ON cards (engagement_id, stage);

CREATE SEQUENCE IF NOT EXISTS run_seq;

-- Append-only record of every agent run (pattern from Anser ADR 022).
CREATE TABLE IF NOT EXISTS runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer NOT NULL DEFAULT nextval('run_seq'),
  card_id     uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  agent       text NOT NULL,
  model       text NOT NULL,
  runtime     text NOT NULL,
  status      text NOT NULL DEFAULT 'running',
  error       text,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  cost_usd    numeric(12,4) NOT NULL DEFAULT 0,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS runs_card ON runs (card_id, started_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  id      bigserial PRIMARY KEY,
  run_id  uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  at      timestamptz NOT NULL DEFAULT now(),
  kind    text NOT NULL,
  text    text NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events (run_id, id);

CREATE SEQUENCE IF NOT EXISTS risk_seq;

-- Risk register. Rows come from an approved classification, then people own them.
CREATE TABLE IF NOT EXISTS risks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('risk_seq'),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  card_id        uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title          text NOT NULL,
  category       text NOT NULL,
  likelihood     integer NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact         integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  owner          text NOT NULL DEFAULT '',
  treatment      text NOT NULL DEFAULT 'mitigate',
  status         text NOT NULL DEFAULT 'open',
  rationale      text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Control register. Filled by the Control Designer (next agent to build).
CREATE TABLE IF NOT EXISTS controls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  card_id         uuid REFERENCES cards(id) ON DELETE CASCADE,
  risk_id         uuid REFERENCES risks(id) ON DELETE SET NULL,
  title           text NOT NULL,
  objective       text NOT NULL DEFAULT '',
  type            text NOT NULL DEFAULT 'preventive',
  frequency       text NOT NULL DEFAULT 'per change',
  owner           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'proposed',
  framework_refs  jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Audit trail. Written in the same transaction as the change it records
-- (pattern from Anser ADR 024). Never holds credential values.
CREATE TABLE IF NOT EXISTS audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,
  action  text NOT NULL,
  entity  text NOT NULL,
  detail  jsonb NOT NULL DEFAULT '{}'
);

-- Workspace settings: typed key-value store (pattern from Anser ADR 025). No secrets.
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- v0.2: providers, configurable agents, engagement settings
-- ---------------------------------------------------------------------------
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS about  text NOT NULL DEFAULT '';
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;

-- Model providers, shared by every engagement. API keys are encrypted at rest
-- (AES-256-GCM, key in data/secret.key or SECRET_KEY) and never sent to the browser.
CREATE TABLE IF NOT EXISTS providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  name            text NOT NULL,
  base_url        text NOT NULL DEFAULT '',
  api_key_enc     text,
  key_last4       text,
  enabled         boolean NOT NULL DEFAULT true,
  built_in        boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'untested',
  status_text     text,
  checked_at      timestamptz,
  models          jsonb NOT NULL DEFAULT '[]',
  billed          boolean NOT NULL DEFAULT true,
  max_concurrent  integer,
  prices          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One agent per stage per engagement. Its instructions are added after the
-- harness's own rules for that role; they never replace them.
CREATE TABLE IF NOT EXISTS agents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  role                  text NOT NULL,
  name                  text NOT NULL,
  stage                 text NOT NULL,
  route                 text NOT NULL DEFAULT 'all',
  enabled               boolean NOT NULL DEFAULT true,
  provider_id           uuid REFERENCES providers(id) ON DELETE SET NULL,
  model                 text NOT NULL,
  effort                text NOT NULL DEFAULT 'medium',
  fallback_provider_id  uuid REFERENCES providers(id) ON DELETE SET NULL,
  fallback_model        text,
  summary               text NOT NULL DEFAULT '',
  instructions          text NOT NULL DEFAULT '',
  tools                 jsonb NOT NULL DEFAULT '[]',
  max_cost_usd          numeric(10,2) NOT NULL DEFAULT 1,
  timeout_min           integer NOT NULL DEFAULT 10,
  concurrency           integer NOT NULL DEFAULT 2,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, role)
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS agent_id     uuid;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS provider_id  uuid;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS billed       boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- v0.3: people, controls, inventory, testing, evidence, issues, evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'preparer',
  password_hash  text NOT NULL,
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz
);

-- Session tokens are stored hashed; the browser holds the raw token in an
-- HttpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text
);

-- Tamper-evident audit: each row carries the hash of the row before it.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash text;

ALTER TABLE cards  ADD COLUMN IF NOT EXISTS design jsonb;
ALTER TABLE cards  ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE runs   ADD COLUMN IF NOT EXISTS rules_version text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS killed_at timestamptz;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS kill_tested_at timestamptz;

ALTER TABLE engagements ADD COLUMN IF NOT EXISTS appetite jsonb NOT NULL DEFAULT '{}';
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS report_signed_by text;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS report_signed_at timestamptz;

ALTER TABLE risks ADD COLUMN IF NOT EXISTS residual_likelihood integer;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS residual_impact integer;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS accepted_by text;

-- Reusable controls mapped to public standards.
CREATE TABLE IF NOT EXISTS control_library (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  title              text NOT NULL,
  objective          text NOT NULL,
  domain             text NOT NULL,
  type               text NOT NULL,
  frequency          text NOT NULL,
  evidence_expected  text NOT NULL DEFAULT '',
  test_procedure     text NOT NULL DEFAULT '',
  risk_categories    jsonb NOT NULL DEFAULT '[]',
  refs               jsonb NOT NULL DEFAULT '{}',
  built_in           boolean NOT NULL DEFAULT true
);

-- Requirements from laws and standards, each met by library controls.
CREATE TABLE IF NOT EXISTS obligations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,
  ref            text NOT NULL,
  title          text NOT NULL,
  summary        text NOT NULL DEFAULT '',
  library_codes  jsonb NOT NULL DEFAULT '[]',
  UNIQUE (source, ref)
);

CREATE SEQUENCE IF NOT EXISTS control_seq;
ALTER TABLE controls ADD COLUMN IF NOT EXISTS number     integer NOT NULL DEFAULT nextval('control_seq');
ALTER TABLE controls ADD COLUMN IF NOT EXISTS library_id uuid REFERENCES control_library(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS control_risks (
  control_id  uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  risk_id     uuid NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  PRIMARY KEY (control_id, risk_id)
);

-- Statement of Applicability: which library controls apply to an engagement.
CREATE TABLE IF NOT EXISTS soa (
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  library_id     uuid NOT NULL REFERENCES control_library(id) ON DELETE CASCADE,
  applicable     boolean NOT NULL,
  justification  text NOT NULL DEFAULT '',
  decided_by     text,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, library_id)
);

CREATE SEQUENCE IF NOT EXISTS inventory_seq;
CREATE TABLE IF NOT EXISTS inventory (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 integer NOT NULL DEFAULT nextval('inventory_seq'),
  engagement_id          uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind                   text NOT NULL,
  name                   text NOT NULL,
  owner                  text NOT NULL DEFAULT '',
  description            text NOT NULL DEFAULT '',
  vendor                 text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'live',
  card_ids               jsonb NOT NULL DEFAULT '[]',
  identity               text NOT NULL DEFAULT '',
  mandate                text NOT NULL DEFAULT '',
  limits                 text NOT NULL DEFAULT '',
  approval_threshold     text NOT NULL DEFAULT '',
  step_limit             integer,
  kill_switch_tested_at  timestamptz,
  last_review_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS test_seq;
CREATE TABLE IF NOT EXISTS tests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('test_seq'),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  control_id     uuid NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'operating',
  title          text NOT NULL,
  procedure      text NOT NULL DEFAULT '',
  population     text NOT NULL DEFAULT '',
  sample_size    integer,
  expected       text NOT NULL DEFAULT '',
  actual         text NOT NULL DEFAULT '',
  exceptions     integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'not_started',
  prepared_by    text,
  prepared_at    timestamptz,
  reviewed_by    text,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Evidence: files are stored on disk under data/evidence, named by their hash.
CREATE SEQUENCE IF NOT EXISTS evidence_seq;
CREATE TABLE IF NOT EXISTS evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('evidence_seq'),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  title          text NOT NULL,
  kind           text NOT NULL,
  filename       text,
  mime           text,
  size           integer,
  sha256         text NOT NULL,
  url            text,
  note           text,
  source         text NOT NULL DEFAULT '',
  collected_by   text NOT NULL,
  collected_at   timestamptz NOT NULL DEFAULT now(),
  control_id     uuid REFERENCES controls(id) ON DELETE SET NULL,
  test_id        uuid REFERENCES tests(id) ON DELETE SET NULL
);

CREATE SEQUENCE IF NOT EXISTS issue_seq;
CREATE TABLE IF NOT EXISTS issues (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number               integer NOT NULL DEFAULT nextval('issue_seq'),
  engagement_id        uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  title                text NOT NULL,
  description          text NOT NULL DEFAULT '',
  severity             text NOT NULL DEFAULT 'medium',
  status               text NOT NULL DEFAULT 'open',
  owner                text NOT NULL DEFAULT '',
  due_date             date,
  management_response  text NOT NULL DEFAULT '',
  control_id           uuid REFERENCES controls(id) ON DELETE SET NULL,
  test_id              uuid REFERENCES tests(id) ON DELETE SET NULL,
  eval_run_id          uuid,
  card_id              uuid REFERENCES cards(id) ON DELETE SET NULL,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  closed_by            text
);

CREATE SEQUENCE IF NOT EXISTS suite_seq;
CREATE TABLE IF NOT EXISTS eval_suites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             integer NOT NULL DEFAULT nextval('suite_seq'),
  engagement_id      uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name               text NOT NULL,
  kind               text NOT NULL,
  inventory_id       uuid REFERENCES inventory(id) ON DELETE SET NULL,
  provider_id        uuid REFERENCES providers(id) ON DELETE SET NULL,
  model              text NOT NULL,
  system_prompt      text NOT NULL DEFAULT '',
  threshold_pct      integer NOT NULL DEFAULT 90,
  judge_provider_id  uuid REFERENCES providers(id) ON DELETE SET NULL,
  judge_model        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id  uuid NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  name      text NOT NULL,
  category  text NOT NULL DEFAULT 'quality',
  ref       text NOT NULL DEFAULT '',
  input     text NOT NULL,
  "check"   text NOT NULL,
  expected  text NOT NULL DEFAULT '',
  severity  text NOT NULL DEFAULT 'medium',
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id    uuid NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'running',
  model       text NOT NULL,
  provider    text NOT NULL,
  passed      integer NOT NULL DEFAULT 0,
  total       integer NOT NULL DEFAULT 0,
  cost_usd    numeric(12,4) NOT NULL DEFAULT 0,
  results     jsonb NOT NULL DEFAULT '[]',
  error       text,
  run_by      text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

CREATE TABLE IF NOT EXISTS assessments (
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  area           text NOT NULL,
  score          integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  rationale      text NOT NULL DEFAULT '',
  assessed_by    text NOT NULL,
  assessed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, area)
);

-- ---------------------------------------------------------------------------
-- v0.4: engagements you can add, audit addresses, session idle timeout,
-- display-name changes that keep segregation of duties intact
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log   ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE sessions    ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users       ADD COLUMN IF NOT EXISTS former_names jsonb NOT NULL DEFAULT '[]';
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS sector text NOT NULL DEFAULT '';
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS created_by text;
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);

-- v0.4.1: archive (read-only, kept) and delete (admin, after archiving)
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS archive_reason text;

-- v0.5: drafting agents. Drafts never count as a preparer, reviewer or sign-off.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS drafts jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS draft jsonb;
UPDATE agents SET name = 'Review assistant' WHERE role = 'independent_reviewer' AND name = 'Independent reviewer';

-- v0.6: knowledge base for grounding agents (retrieval-augmented generation).
-- engagement_id NULL means shared by every engagement (framework summaries,
-- library controls, methodology). The embedding column is added in code,
-- only when the vector extension is available.
CREATE SEQUENCE IF NOT EXISTS kb_seq;
CREATE TABLE IF NOT EXISTS kb_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid REFERENCES engagements(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  title          text NOT NULL,
  ref            text NOT NULL DEFAULT '',
  origin         text NOT NULL DEFAULT 'built_in',
  evidence_id    uuid REFERENCES evidence(id) ON DELETE CASCADE,
  card_id        uuid REFERENCES cards(id) ON DELETE CASCADE,
  created_by     text NOT NULL DEFAULT 'system',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref, engagement_id)
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('kb_seq'),
  source_id      uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE CASCADE,
  ord            integer NOT NULL DEFAULT 0,
  heading        text NOT NULL DEFAULT '',
  text           text NOT NULL,
  tsv            tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || text)) STORED,
  embed_model    text
);
CREATE INDEX IF NOT EXISTS kb_chunks_tsv ON kb_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS kb_chunks_eng ON kb_chunks (engagement_id);

-- Per-item human decisions on agent drafts (accept, edit, reject).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS decisions jsonb NOT NULL DEFAULT '{}';

-- v0.7: the Verifier (advisory LLM-as-a-judge) and agent testing.
-- Verdicts sit beside the draft, keyed by stage, and are cleared with it.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}';
-- Golden dataset: inputs with a known right answer. Shared by every engagement.
CREATE SEQUENCE IF NOT EXISTS golden_seq;
CREATE TABLE IF NOT EXISTS golden_cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer NOT NULL DEFAULT nextval('golden_seq'),
  agent       text NOT NULL,
  title       text NOT NULL,
  use_case    jsonb NOT NULL,
  tier        text,
  risks       jsonb NOT NULL DEFAULT '[]',
  expected    jsonb NOT NULL,
  built_in    boolean NOT NULL DEFAULT false,
  ref         text UNIQUE,
  created_by  text NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS golden_run_seq;
CREATE TABLE IF NOT EXISTS golden_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        integer NOT NULL DEFAULT nextval('golden_run_seq'),
  agent         text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  runtime       text NOT NULL,
  rules_version text NOT NULL DEFAULT '',
  with_verifier boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'running',
  results       jsonb NOT NULL DEFAULT '[]',
  summary       jsonb,
  regressions   jsonb NOT NULL DEFAULT '[]',
  previous      text,
  started_by    text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
-- Judge labels: claims a person marked good or bad, used to measure the Verifier.
CREATE SEQUENCE IF NOT EXISTS judge_label_seq;
CREATE TABLE IF NOT EXISTS judge_labels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer NOT NULL DEFAULT nextval('judge_label_seq'),
  kind        text NOT NULL,
  claim       text NOT NULL,
  passages    jsonb NOT NULL DEFAULT '[]',
  human       text NOT NULL,
  note        text NOT NULL DEFAULT '',
  origin      text NOT NULL DEFAULT 'manual',
  ref         text UNIQUE,
  created_by  text NOT NULL DEFAULT 'system',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS judge_cal_seq;
CREATE TABLE IF NOT EXISTS judge_calibrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer NOT NULL DEFAULT nextval('judge_cal_seq'),
  model       text NOT NULL,
  runtime     text NOT NULL,
  result      jsonb NOT NULL,
  started_by  text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
-- Billed spend outside card runs (Verifier checks, golden runs, calibrations),
-- so the monthly spend cap covers every model call the harness makes.
CREATE TABLE IF NOT EXISTS ai_spend (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source    text NOT NULL,
  model     text NOT NULL,
  cost_usd  numeric NOT NULL DEFAULT 0,
  at        timestamptz NOT NULL DEFAULT now()
);

-- v0.8: the assistant. One conversation per person per context (a use case or
-- a register); suggestions are applied or discarded by a person.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  context_kind   text NOT NULL,
  context_id     text NOT NULL DEFAULT '',
  role           text NOT NULL,
  text           text NOT NULL,
  citations      jsonb NOT NULL DEFAULT '[]',
  passages       jsonb NOT NULL DEFAULT '[]',
  suggestions    jsonb NOT NULL DEFAULT '[]',
  dropped        jsonb NOT NULL DEFAULT '[]',
  model          text,
  runtime        text,
  author         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_thread ON assistant_messages (engagement_id, user_id, context_kind, context_id, created_at);

-- v0.10: text read out of PDFs, spreadsheets and Word files, so agents and
-- search can use them. The original file is unchanged and still fingerprinted.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS text_content text;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS text_note text;

-- v0.10: incidents on live AI systems, with notification deadlines.
CREATE SEQUENCE IF NOT EXISTS incident_seq;
CREATE TABLE IF NOT EXISTS incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('incident_seq'),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  severity       text NOT NULL DEFAULT 'high',
  status         text NOT NULL DEFAULT 'open',
  occurred_at    timestamptz,
  aware_at       timestamptz NOT NULL,
  inventory_id   uuid REFERENCES inventory(id) ON DELETE SET NULL,
  card_id        uuid REFERENCES cards(id) ON DELETE SET NULL,
  owner          text NOT NULL DEFAULT '',
  notices        jsonb NOT NULL DEFAULT '[]',
  timeline       jsonb NOT NULL DEFAULT '[]',
  root_cause     text NOT NULL DEFAULT '',
  lessons        text NOT NULL DEFAULT '',
  reported_by    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_by      text,
  closed_at      timestamptz
);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL;

-- v0.10: monitoring. Suites can run on a schedule; each completed run is
-- compared with the suite's threshold and its recent baseline (drift).
ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS schedule text NOT NULL DEFAULT 'off';
ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS next_run_at timestamptz;
ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS drift_drop_pct integer NOT NULL DEFAULT 10;
CREATE SEQUENCE IF NOT EXISTS alert_seq;
CREATE TABLE IF NOT EXISTS monitor_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           integer NOT NULL DEFAULT nextval('alert_seq'),
  engagement_id    uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  suite_id         uuid NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  run_id           uuid REFERENCES eval_runs(id) ON DELETE SET NULL,
  kind             text NOT NULL,
  message          text NOT NULL,
  pass_pct         integer,
  baseline_pct     integer,
  status           text NOT NULL DEFAULT 'open',
  acknowledged_by  text,
  acknowledged_at  timestamptz,
  note             text NOT NULL DEFAULT '',
  issue_id         uuid REFERENCES issues(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind)
);

-- v0.10: evidence connectors (read-only pulls from client systems).
CREATE SEQUENCE IF NOT EXISTS connector_seq;
CREATE TABLE IF NOT EXISTS connectors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         integer NOT NULL DEFAULT nextval('connector_seq'),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name           text NOT NULL,
  url            text NOT NULL,
  auth           text NOT NULL DEFAULT 'none',
  header_name    text NOT NULL DEFAULT '',
  secret_enc     text,
  control_id     uuid REFERENCES controls(id) ON DELETE SET NULL,
  schedule       text NOT NULL DEFAULT 'manual',
  enabled        boolean NOT NULL DEFAULT true,
  next_pull_at   timestamptz,
  last_pull_at   timestamptz,
  last_status    text NOT NULL DEFAULT 'never',
  last_message   text NOT NULL DEFAULT '',
  last_sha256    text,
  pulls          integer NOT NULL DEFAULT 0,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS connector_id uuid REFERENCES connectors(id) ON DELETE SET NULL;

-- v0.10: per-engagement access. An open engagement is visible to everyone
-- signed in (as before); a members-only one to its members and admins.
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'open';
CREATE TABLE IF NOT EXISTS engagement_members (
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by       text NOT NULL,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, user_id)
);
-- Which engagement an audit entry belongs to, so members-only work stays
-- private in the audit log. Not part of the hash (added after the fact).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS engagement_id uuid;
ALTER TABLE judge_labels ADD COLUMN IF NOT EXISTS engagement_id uuid;

-- ---------------------------------------------------------------------------
-- v1.1: the Use Case Planner, more than one agent per stage, act as
-- ---------------------------------------------------------------------------
-- A stage can have several agents; cards are routed between them by kind,
-- priority or tier. Agents a person added are "custom" and can be deleted.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_engagement_id_role_key;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;

-- A use case being drafted before it reaches the board.
CREATE TABLE IF NOT EXISTS plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         serial,
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  mode           text NOT NULL DEFAULT 'ai',
  status         text NOT NULL DEFAULT 'draft',
  brief          jsonb NOT NULL DEFAULT '{}',
  edited         jsonb NOT NULL DEFAULT '[]',
  messages       jsonb NOT NULL DEFAULT '[]',
  card_id        uuid REFERENCES cards(id) ON DELETE SET NULL,
  created_by     text NOT NULL,
  created_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_engagement ON plans (engagement_id, updated_at DESC);

-- Act as: an admin works through the whole flow as another person without
-- signing out. The audit log records both names.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS acting_as uuid;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS real_actor text;

-- ---------------------------------------------------------------------------
-- v1.2 (ARGUS): optional modules per engagement. Engagements that existed
-- before keep everything on; new ones start with the core flow only.
-- ---------------------------------------------------------------------------
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS modules jsonb;
UPDATE engagements SET modules = '{"evals":true,"incidents":true,"inventory":true,"connectors":true,"soa":true,"advanced_ai":true}' WHERE modules IS NULL;
ALTER TABLE engagements ALTER COLUMN modules SET DEFAULT '{"evals":false,"incidents":false,"inventory":false,"connectors":false,"soa":false,"advanced_ai":false}';

-- v1.4: assistant conversations. A person can start a new conversation, find an
-- old one and carry on. Each message still records the page or record it was
-- asked about. Threads from before v1.4 become one conversation each.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  title          text NOT NULL,
  context_kind   text NOT NULL DEFAULT 'engagement',
  context_id     text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_conv_list ON assistant_conversations (engagement_id, user_id, updated_at DESC);
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE CASCADE;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS page text;
CREATE INDEX IF NOT EXISTS assistant_conv_msgs ON assistant_messages (conversation_id, created_at);
WITH threads AS (
  SELECT engagement_id, user_id, context_kind, context_id, min(created_at) AS first_at, max(created_at) AS last_at,
         left(coalesce((array_agg(text ORDER BY created_at) FILTER (WHERE role = 'user'))[1], 'Conversation'), 80) AS title
  FROM assistant_messages WHERE conversation_id IS NULL GROUP BY engagement_id, user_id, context_kind, context_id
), made AS (
  INSERT INTO assistant_conversations (engagement_id, user_id, title, context_kind, context_id, created_at, updated_at)
  SELECT engagement_id, user_id, title, context_kind, context_id, first_at, last_at FROM threads
  RETURNING id, engagement_id, user_id, context_kind, context_id
)
UPDATE assistant_messages m SET conversation_id = made.id FROM made
WHERE m.conversation_id IS NULL AND m.engagement_id = made.engagement_id AND m.user_id = made.user_id AND m.context_kind = made.context_kind AND m.context_id = made.context_id;

-- v1.6: agentic agents. Each agent can work in agentic mode (look things up
-- with read-only tools, ask a person, check its own draft) or single-call mode
-- (the v1.5 behaviour). Runs record which mode ran and how many steps it took.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'agentic';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_steps integer NOT NULL DEFAULT 8;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS self_check boolean NOT NULL DEFAULT true;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'single';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS steps integer NOT NULL DEFAULT 0;
-- Questions an agent asked a person (rule 27). The run stops as "waiting"; the
-- card shows "Question for You"; answering or skipping queues the card again,
-- and the next run is given every answer for that card and stage.
CREATE TABLE IF NOT EXISTS agent_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  card_id        uuid REFERENCES cards(id) ON DELETE CASCADE,
  run_id         uuid REFERENCES runs(id) ON DELETE SET NULL,
  stage          text NOT NULL,
  agent          text NOT NULL,
  question       text NOT NULL,
  why            text NOT NULL DEFAULT '',
  asked_to       text NOT NULL DEFAULT '',
  feedback       text,
  status         text NOT NULL DEFAULT 'open',
  answer         text,
  answered_by    text,
  asked_at       timestamptz NOT NULL DEFAULT now(),
  answered_at    timestamptz
);
CREATE INDEX IF NOT EXISTS agent_questions_card ON agent_questions (card_id, stage, asked_at);
-- v1.6: golden runs say whether the agent ran agentic or as one call, so the two can be compared.
ALTER TABLE golden_runs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'single';
-- v1.6: the assistant shows what it based an answer on, and the steps it took.
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS basis jsonb NOT NULL DEFAULT '[]';
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS trail jsonb NOT NULL DEFAULT '[]';
