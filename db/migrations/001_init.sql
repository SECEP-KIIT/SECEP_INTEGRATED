-- migrate:up
-- ============================================================================================================
-- SECEP data layer (M7), complete schema as of 16 Nov 2026.
-- SRS v1.1 §6.6 (001_init.sql + 003_v1_1_addendum.sql) folded into one file, with the PROPOSED v1.3 decisions
-- (srs-v1.3-frontend-shapes.md §8–§16, data-model handover, data-model doc changes log) applied.
-- PostgreSQL 16, image pgvector/pgvector:pg16. Applied by dbmate.
--
-- File plan: 001_init.sql (this file, all tables) → 002_seed_demo.sql (demo data, later).
-- The SRS's 003_v1_1_addendum.sql is folded in here; the name 003 is retired. The next schema change is 004_*.
--
-- Comments tagged [v1.3] mark a change from SRS v1.1; the data-model doc gives the reason for each.
-- ============================================================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------------------------------------

-- Lenient date parse for values inside jsonb payloads: NULL instead of an error, so one malformed LLM date can't
-- block an actions insert. [v1.3]
CREATE FUNCTION secep_try_date(v text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN v::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE FUNCTION secep_try_timestamptz(v text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- Shape check for the shared encryption format (§6.6): base64(nonce 12 ‖ ciphertext ‖ tag 16), so at least
-- 40 base64 characters. A guard against plaintext slipping into an *_enc column, not proof of encryption. [v1.3]
CREATE FUNCTION secep_looks_encrypted(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT v ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(v) >= 40 AND length(v) % 4 = 0
$$;

-- ------------------------------------------------------------------------------------------------------------
-- Tenants, users, mailboxes
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',          -- own/protected domains
  settings jsonb NOT NULL DEFAULT '{}',           -- Jira, LLM, threshold, file quota, lock re-sign-in hours;
                                                  -- secret values stored encrypted, never in plain form
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),   -- [v1.3] the SRS's "stored lower-case", enforced
  display_name text,
  role_category text NOT NULL DEFAULT 'Other' CHECK (role_category IN
    ('Executive','Manager','Engineer','Analyst','Consultant','Client-facing','Other')),
  is_admin boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}',       -- e.g. {security.review}
  timezone text NOT NULL DEFAULT 'UTC',           -- [v1.3] IANA name; "today" for due filters and due dates
  ui_prefs jsonb NOT NULL DEFAULT '{}',
    -- [v1.3] keys: motion, skip_lock, idle_minutes, glance_subjects, sidebar_collapsed, theme, densities,
    -- pop-up rules, quiet hours, reminder defaults, digest time, wallpaper rotation. Validated by M6.
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

-- Reject a time zone PostgreSQL doesn't know (a CHECK can't do this: the lookup isn't immutable). [v1.3]
CREATE FUNCTION users_check_timezone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM now() AT TIME ZONE NEW.timezone;
  RETURN NEW;
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE EXCEPTION 'unknown time zone: %', NEW.timezone USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER users_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON users
  FOR EACH ROW EXECUTE FUNCTION users_check_timezone();

CREATE TABLE mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  provider text NOT NULL DEFAULT 'gmail',
  address text NOT NULL,
  history_id text,
  refresh_token_enc text NOT NULL CHECK (secep_looks_encrypted(refresh_token_enc)),   -- [v1.3] shape guard
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked','error')),
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

-- ------------------------------------------------------------------------------------------------------------
-- Mail: threads, emails, ML outputs
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
  provider_thread_id text NOT NULL,
  subject_norm text,
  last_message_at timestamptz,
  last_message_from_self boolean NOT NULL DEFAULT false,
    -- [v1.3, PENDING team sign-off on needs_reply] true when the thread's latest message was sent by the
    -- mailbox owner. Set by M2 together with last_message_at.
  message_count int NOT NULL DEFAULT 0,
  UNIQUE (mailbox_id, provider_thread_id));

-- One row per mailbox copy: each recipient has their own row, triage and summary (triage is conditioned on the
-- recipient, FR-TRI-003). Per-person state is never a column here; it lives in email_user_state.
CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
  thread_id uuid REFERENCES threads(id),
  provider_message_id text NOT NULL,
  message_id_hdr text NOT NULL,
  in_reply_to text,
  from_addr text NOT NULL,
  from_name text,
  to_addrs text[] NOT NULL DEFAULT '{}',
  cc_addrs text[] NOT NULL DEFAULT '{}',
  recipient_position text NOT NULL CHECK (recipient_position IN ('to','cc','bcc')),
  subject text,
  subject_norm text,
  received_at timestamptz NOT NULL,
  body_text text NOT NULL,                        -- sanitized and masked, for display
  ml_text text NOT NULL,                          -- masked, quotes/signature removed
  urls jsonb NOT NULL DEFAULT '[]',               -- [{anchor, href}]; server-side only, never on the wire
  attachments jsonb NOT NULL DEFAULT '[]',        -- [{filename, mime, size, sha256}]
  auth_results jsonb,                             -- {spf, dkim, dmarc}
  raw_size int NOT NULL,
  status text NOT NULL DEFAULT 'ingested' CHECK (status IN
    ('ingested','triaged','enriched','enrich_pending','enrich_failed')),
  security_flag text NOT NULL DEFAULT 'none' CHECK (security_flag IN ('none','suspicious','malicious')),
  duplicate_of uuid REFERENCES emails(id),
  duplicate_count int NOT NULL DEFAULT 0,
  -- [v1.3] COPY of the triage labels, kept in step by a trigger on triage_results (the source of truth), so list
  -- filters, facets and glance counts read one narrow index instead of joining 100k triage rows. Never written
  -- directly. NULL until triaged.
  email_type text,
  urgency text,
  sentiment text,
  needs_review boolean,
  search tsvector GENERATED ALWAYS AS
    (to_tsvector('english', coalesce(subject,'') || ' ' || body_text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_id, message_id_hdr));           -- [v1.3] was (tenant_id, message_id_hdr)
  -- [v1.3] pinned and snoozed_until are NOT here (v1.1 put them here); they are per person, in email_user_state.
CREATE INDEX emails_inbox_idx ON emails (mailbox_id, received_at DESC)
  INCLUDE (id, email_type, urgency, sentiment, needs_review, security_flag);   -- [v1.3] covering: index-only
CREATE INDEX emails_flagged_idx ON emails (mailbox_id, received_at DESC) WHERE security_flag <> 'none';   -- [v1.3]
CREATE INDEX emails_search_idx ON emails USING gin (search);
CREATE INDEX emails_trgm_idx ON emails USING gin ((coalesce(subject,'') || ' ' || body_text) gin_trgm_ops);
CREATE INDEX emails_thread_idx ON emails (thread_id) WHERE thread_id IS NOT NULL;                    -- [v1.3]
CREATE INDEX emails_near_dup_idx ON emails (mailbox_id, subject_norm, received_at DESC);             -- [v1.3]

CREATE TABLE email_embeddings (
  email_id uuid PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  embedding vector(768) NOT NULL);
CREATE INDEX email_embeddings_hnsw ON email_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE triage_results (
  email_id uuid PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  email_type text NOT NULL CHECK (email_type IN ('Task','Info','Credentials','Meeting','Approval')),   -- [v1.3]
  type_conf numeric(5,4) NOT NULL,
  type_source text NOT NULL CHECK (type_source IN ('encoder','llm','user','rule')),   -- v1.1 'rule' folded in
  urgency text NOT NULL CHECK (urgency IN ('Low','Medium','High','Critical')),                        -- [v1.3]
  urgency_conf numeric(5,4) NOT NULL,
  sentiment text NOT NULL CHECK (sentiment IN ('Positive','Neutral','Negative','Frustrated')),        -- [v1.3]
  sentiment_score numeric(3,2) NOT NULL, sentiment_conf numeric(5,4) NOT NULL,
  needs_review boolean NOT NULL,
  model_version text NOT NULL,
  processed_at timestamptz NOT NULL);

-- [v1.3] Keep the label copy on emails in step with triage_results (M3, M4 adjudication, personal rules and
-- PATCH /emails/:id/labels all write triage_results; none of them writes the copy).
CREATE FUNCTION triage_copy_labels() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE emails SET email_type = NULL, urgency = NULL, sentiment = NULL, needs_review = NULL WHERE id = OLD.email_id;
  ELSE
    UPDATE emails SET email_type = NEW.email_type, urgency = NEW.urgency, sentiment = NEW.sentiment,
                      needs_review = NEW.needs_review
     WHERE id = NEW.email_id
       AND (email_type, urgency, sentiment, needs_review)
           IS DISTINCT FROM (NEW.email_type, NEW.urgency, NEW.sentiment, NEW.needs_review);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER triage_results_copy AFTER INSERT OR UPDATE OR DELETE ON triage_results
  FOR EACH ROW EXECUTE FUNCTION triage_copy_labels();

CREATE TABLE summaries (
  email_id uuid PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  one_line text NOT NULL, short text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

-- ------------------------------------------------------------------------------------------------------------
-- Actions (proposals, user cards) and per-person email state
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email_id uuid REFERENCES emails(id) ON DELETE CASCADE,   -- NULL = user card (FR-CNT-002)
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('create_jira_issue','add_board_card','add_calendar_event','none')),
  payload jsonb NOT NULL,
  origin text NOT NULL DEFAULT 'decoder' CHECK (origin IN ('decoder','user','rule')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN
    ('proposed','accepted','executing','done','failed','rejected')),
  board_column text CHECK (board_column IN ('todo','in_progress','done')),
  board_position int,
  pinned boolean NOT NULL DEFAULT false,          -- fine here: an action row already belongs to one user
  snoozed_until timestamptz,
  external_kind text CHECK (external_kind IN ('jira_issue','jira_comment','calendar_event')),
  external_ref text,                              -- Jira issue key; set once (FR-ORC-005: no second issue)
  external_status text,                           -- live Jira status
  error text,                                     -- Jira's message on a 400/401 failed accept
  undo_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email_id IS NOT NULL OR origin = 'user'));   -- [v1.3] only user cards lack an email
CREATE INDEX actions_user_board_idx ON actions (user_id, board_column, board_position);
CREATE INDEX actions_email_idx ON actions (email_id, user_id) WHERE email_id IS NOT NULL;            -- [v1.3]

-- [v1.3] Per-person state for an email. One table instead of email_reads + email_states + email columns.
-- No row = unread, not handled, not pinned, not snoozed, no due date.
CREATE TABLE email_user_state (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  read_at timestamptz,                            -- wire: read = read_at IS NOT NULL
  handled_at timestamptz,                         -- wire: handled ("Done" in the UI)
  pinned_at timestamptz,                          -- wire: pinned
  snoozed_until timestamptz,                      -- wire: snoozed_until
  due_date date,                                  -- DERIVED, maintained by triggers below; never written by M6
  PRIMARY KEY (user_id, email_id));
CREATE INDEX email_user_state_due_idx ON email_user_state (user_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX email_user_state_pinned_idx ON email_user_state (user_id) WHERE pinned_at IS NOT NULL;
CREATE INDEX email_user_state_handled_idx ON email_user_state (user_id, handled_at DESC)
  WHERE handled_at IS NOT NULL;
CREATE INDEX email_user_state_email_idx ON email_user_state (email_id);   -- FK cascade from emails

-- Derived due date (proposals §10.2): the earliest of every non-null action payload.due_date and the local date
-- of every non-null calendar payload.start, among the user's actions on the email, rejected ones excluded.
-- Calendar starts become dates in the user's time zone.
CREATE FUNCTION email_due_compute(p_user uuid, p_email uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT min(d) FROM (
    SELECT secep_try_date(a.payload->>'due_date') AS d
      FROM actions a
     WHERE a.email_id = p_email AND a.user_id = p_user AND a.status <> 'rejected'
    UNION ALL
    SELECT (secep_try_timestamptz(a.payload->>'start') AT TIME ZONE u.timezone)::date
      FROM actions a JOIN users u ON u.id = a.user_id
     WHERE a.email_id = p_email AND a.user_id = p_user AND a.status <> 'rejected'
  ) s
$$;

CREATE FUNCTION email_due_refresh(p_user uuid, p_email uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE d date := email_due_compute(p_user, p_email);
BEGIN
  IF d IS NULL THEN
    UPDATE email_user_state SET due_date = NULL
     WHERE user_id = p_user AND email_id = p_email AND due_date IS NOT NULL;   -- never create an empty row
  ELSE
    INSERT INTO email_user_state (user_id, email_id, due_date) VALUES (p_user, p_email, d)
    ON CONFLICT (user_id, email_id) DO UPDATE SET due_date = EXCLUDED.due_date
      WHERE email_user_state.due_date IS DISTINCT FROM EXCLUDED.due_date;
  END IF;
END $$;

CREATE FUNCTION actions_due_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.email_id IS NOT NULL THEN
    PERFORM email_due_refresh(OLD.user_id, OLD.email_id);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.email_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.email_id IS DISTINCT FROM OLD.email_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.status IS DISTINCT FROM OLD.status OR NEW.payload IS DISTINCT FROM OLD.payload) THEN
    PERFORM email_due_refresh(NEW.user_id, NEW.email_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER actions_due AFTER INSERT OR UPDATE OF email_id, user_id, status, payload OR DELETE ON actions
  FOR EACH ROW EXECUTE FUNCTION actions_due_trigger();

-- A time-zone change can move calendar-derived dates by a day: recompute that user's rows.
CREATE FUNCTION users_tz_due_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM email_due_refresh(NEW.id, x.email_id)
     FROM (SELECT DISTINCT email_id FROM actions WHERE user_id = NEW.id AND email_id IS NOT NULL) x;
  RETURN NULL;
END $$;
CREATE TRIGGER users_tz_due AFTER UPDATE OF timezone ON users
  FOR EACH ROW WHEN (OLD.timezone IS DISTINCT FROM NEW.timezone) EXECUTE FUNCTION users_tz_due_trigger();

CREATE TABLE label_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- [v1.3] was bigserial; correction_id is a UUID string
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  field text NOT NULL CHECK (field IN ('email_type','urgency','sentiment')),
  old_label text NOT NULL, new_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX label_corrections_created_idx ON label_corrections (created_at);   -- [v1.3] "200 new corrections"

CREATE TABLE user_label_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('email_type','urgency','sentiment')),
  sender text NOT NULL CHECK (sender = lower(sender)),   -- the SRS's "lower-case address", enforced
  label text NOT NULL,
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, field, sender));
-- "emails like this" (FR-ML-014) uses label_corrections + email_embeddings; no extra table.

-- ------------------------------------------------------------------------------------------------------------
-- Security
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE masked_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid REFERENCES emails(id) ON DELETE CASCADE,
  note_id uuid,                                   -- FK added after notes
  owner_user_id uuid NOT NULL REFERENCES users(id),
  secret_type text NOT NULL,
  value_enc text NOT NULL CHECK (secep_looks_encrypted(value_enc)),   -- [v1.3] shape guard
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT masked_secrets_source_check CHECK ((email_id IS NOT NULL) <> (note_id IS NOT NULL)));
CREATE INDEX masked_secrets_email_idx ON masked_secrets (email_id) WHERE email_id IS NOT NULL;      -- [v1.3]

CREATE TABLE url_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  url text NOT NULL, anchor_text text, host text NOT NULL,
  signals jsonb NOT NULL,                         -- {safe_browsing, new_domain, mismatch, lookalike, shortener, ip_host, auth_fail}
  verdict text NOT NULL CHECK (verdict IN ('clean','suspicious','malicious')),
  final_url text, redirect_chain jsonb,           -- set by the click-time resolver
  checked_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX url_checks_email_idx ON url_checks (email_id);                                         -- [v1.3]

CREATE TABLE models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  artifact_path text NOT NULL,
  metrics jsonb NOT NULL,   -- PROPOSED: {type_macro_f1, urgency_macro_f1, sentiment_macro_f1, per_class_f1, ece}
  status text NOT NULL CHECK (status IN ('candidate','promoted','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz);
CREATE UNIQUE INDEX models_one_promoted_idx ON models ((true)) WHERE status = 'promoted';           -- [v1.3]

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,                       -- stays bigserial: the order is the hash chain
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid REFERENCES users(id),
  event text NOT NULL,                            -- login, settings.update, action.execute, secret.reveal, model.promote
  target text,
  details jsonb NOT NULL DEFAULT '{}',            -- never a secret value, body, summary or note text
  prev_hash text NOT NULL,
  hash text NOT NULL,                             -- sha256(prev_hash || canonical JSON of this row)
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, id DESC);                                 -- [v1.3]

-- [v1.3] Append-only, enforced (NFR-SEC-006): no UPDATE ever; DELETE only past the 365-day retention.
CREATE FUNCTION audit_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.created_at < now() - interval '365 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
CREATE FUNCTION audit_log_no_truncate_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (TRUNCATE refused)' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate_fn();

-- ------------------------------------------------------------------------------------------------------------
-- Layouts (FR-UI-010)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE user_layouts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_class text NOT NULL CHECK (device_class IN ('desktop','tablet','phone')),
  pages jsonb NOT NULL CHECK (jsonb_typeof(pages) = 'array'
                              AND jsonb_array_length(pages) BETWEEN 1 AND 9),   -- [v1.3] cheap backstop
    -- [v1.3] ordered [{id uuid, name 1–40, widgets: [ordered, ≤ 24 per page]}]; array order is position.
    -- widget: {id uuid, type, size, hidden, title, colour (8 swatch names), icon (one emoji), filter
    -- (GET /emails query string, inbox_column only), sort, density}. Full validation: M6 (ajv) → 422.
    -- Stacks: see the data-model doc (open item 7).
  updated_at timestamptz NOT NULL DEFAULT now(),  -- the 409 check: PUT's base_updated_at must equal this
  PRIMARY KEY (user_id, device_class));

-- ------------------------------------------------------------------------------------------------------------
-- Projects, tags (FR-UI-014, 016–020)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  colour text NOT NULL,                           -- OPEN (doc): hex '#rrggbb' or a swatch name
  icon text, description text,
  deadline timestamptz, jira_project_key text, jira_epic text,
  centroid vector(768), member_count int NOT NULL DEFAULT 0,   -- AI suggestions (S)
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX projects_owner_idx ON projects (owner_user_id, archived_at);                            -- [v1.3]

CREATE TABLE email_projects (
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_id, project_id));
CREATE INDEX email_projects_project_idx ON email_projects (project_id);                            -- [v1.3]
CREATE UNIQUE INDEX email_projects_one_primary_idx ON email_projects (email_id) WHERE is_primary;  -- [v1.3]

CREATE TABLE card_projects (
  action_id uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action_id, project_id));
CREATE INDEX card_projects_project_idx ON card_projects (project_id);                              -- [v1.3]
CREATE UNIQUE INDEX card_projects_one_primary_idx ON card_projects (action_id) WHERE is_primary;   -- [v1.3]

CREATE TABLE project_rules (                      -- S
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('sender','domain','subject')),
  operator text NOT NULL CHECK (operator IN ('equals','contains')),
  value text NOT NULL);

CREATE TABLE user_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, colour text NOT NULL,       -- OPEN (doc): same hex-or-swatch question as projects
  UNIQUE (user_id, name));
CREATE TABLE email_tags (
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (email_id, tag_id));
CREATE INDEX email_tags_tag_idx ON email_tags (tag_id);                                             -- [v1.3]
CREATE TABLE card_tags (
  action_id uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (action_id, tag_id));
CREATE INDEX card_tags_tag_idx ON card_tags (tag_id);                                               -- [v1.3]

-- ------------------------------------------------------------------------------------------------------------
-- Notes and files (FR-CNT-003–008)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  target_type text CHECK (target_type IN ('email','card','project')),   -- NULL = standalone
  target_id uuid,
  body text NOT NULL,                             -- markdown-lite, masked
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_type IS NULL) = (target_id IS NULL)));   -- [v1.3]
CREATE INDEX notes_target_idx ON notes (target_type, target_id);
CREATE INDEX notes_owner_idx ON notes (owner_user_id, updated_at DESC);                             -- [v1.3]
ALTER TABLE masked_secrets ADD CONSTRAINT masked_secrets_note_fk
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE;
CREATE INDEX masked_secrets_note_idx ON masked_secrets (note_id) WHERE note_id IS NOT NULL;          -- [v1.3]

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('email','card','project','wallpaper')),
  target_id uuid,
  filename text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL,
  storage_key text NOT NULL,                      -- path in the files volume
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX files_target_idx ON files (target_type, target_id);                                    -- [v1.3]
CREATE INDEX files_owner_idx ON files (owner_user_id);                                              -- [v1.3] quota sum

-- ------------------------------------------------------------------------------------------------------------
-- Reminders, notifications, push (FR-REM)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('due','snooze','manual','meeting','digest')),
  target_type text CHECK (target_type IN ('email','card','event')),
  target_id text,                                 -- uuid, or Google event id
  title text,
  fire_at timestamptz NOT NULL,
  google_event_id text,                           -- manual reminders mirrored to Google (FR-CAL-004)
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','fired','cancelled')),
  fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reminders_due_idx ON reminders (fire_at) WHERE status = 'scheduled';
CREATE INDEX reminders_user_idx ON reminders (user_id, fire_at);                                    -- [v1.3]

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- [v1.3] was bigserial; IDs are UUID strings (§6.4.1)
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder','digest','meeting','new_email','jira_status')),   -- [v1.3]
  payload jsonb NOT NULL,                         -- {title, body, target}; title generic, never content
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL, auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now());

-- ------------------------------------------------------------------------------------------------------------
-- Calendar (FR-CAL)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE calendar_sync (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  summary text, colour text,
  visible boolean NOT NULL DEFAULT true,
  sync_token text,
  last_synced_at timestamptz,
  PRIMARY KEY (user_id, calendar_id));
CREATE TABLE calendar_events (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  event_id text NOT NULL,
  summary text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text, join_url text,
  attendees jsonb NOT NULL DEFAULT '[]',
  organizer_self boolean NOT NULL DEFAULT false,
  response_status text,
  email_id uuid REFERENCES emails(id) ON DELETE SET NULL,   -- linked meeting email
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, calendar_id, event_id));
CREATE INDEX calendar_events_range_idx ON calendar_events (user_id, start_at);

-- ------------------------------------------------------------------------------------------------------------
-- Wallpaper places (FR-WP-006–009)
-- ------------------------------------------------------------------------------------------------------------

CREATE TABLE wallpaper_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  city text,
  lat numeric(4,1), lon numeric(4,1),             -- city-level only
  timezone text NOT NULL,
  sun_mode text NOT NULL DEFAULT 'place' CHECK (sun_mode IN ('place','local')),
  photos jsonb NOT NULL DEFAULT '[]',             -- [{phase: dawn|day|golden|dusk|night, file_id, focal_x, focal_y}], max 5
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX wallpaper_places_user_idx ON wallpaper_places (user_id, position);                     -- [v1.3]
-- Limits (5 places per user, 5 photos per place, 25 MB per file, quota) are enforced by the API.

-- migrate:down
-- Drops everything this file creates. dbmate runs this only on an explicit rollback.
DROP TABLE IF EXISTS wallpaper_places, calendar_events, calendar_sync, push_subscriptions, notifications,
  reminders, files, card_tags, email_tags, user_tags, project_rules, card_projects, email_projects, projects,
  user_layouts, audit_log, models, url_checks, masked_secrets, notes, user_label_rules, label_corrections,
  email_user_state, actions, summaries, triage_results, email_embeddings, emails, threads, mailboxes, users,
  tenants CASCADE;
DROP FUNCTION IF EXISTS triage_copy_labels(), users_tz_due_trigger(), actions_due_trigger(), email_due_refresh(uuid, uuid),
  email_due_compute(uuid, uuid), audit_log_guard(), audit_log_no_truncate_fn(), users_check_timezone(),
  secep_looks_encrypted(text), secep_try_timestamptz(text), secep_try_date(text);
