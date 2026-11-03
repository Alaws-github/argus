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
