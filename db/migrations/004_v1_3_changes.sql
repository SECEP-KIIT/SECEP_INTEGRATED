-- migrate:up
-- 004: changes decided after the 16 Nov handover (proposals §17–§29, 19 Nov 2026). Applies on top of 001_init.sql.
-- Five schema changes plus comments. Nothing here touches the due-date or triage triggers.

-- 1. A user card can be the target of a Jira or Calendar action (proposals §27.2, FR-CNT-002 "same actions").
--    The action has no email (email_id NULL), origin 'user', and points at the card with card_id.
--    It is not placed on the board: the card is already there.
ALTER TABLE actions ADD COLUMN card_id uuid REFERENCES actions(id) ON DELETE CASCADE;
ALTER TABLE actions ADD CONSTRAINT actions_card_id_check CHECK (
  card_id IS NULL
  OR (card_id <> id AND email_id IS NULL AND origin = 'user' AND type IN ('create_jira_issue','add_calendar_event')));
CREATE INDEX actions_card_idx ON actions (card_id) WHERE card_id IS NOT NULL;   -- GET /actions?card=

-- The target must be one of the same person's own user cards. M6 answers 404 or 409 first; this is the backstop,
-- so a bug can never attach a Jira action to another person's card.
CREATE FUNCTION actions_card_target_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.card_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM actions c
        WHERE c.id = NEW.card_id AND c.user_id = NEW.user_id
          AND c.email_id IS NULL AND c.type = 'add_board_card') THEN
    RAISE EXCEPTION 'card_id must point at one of the same user''s own user cards' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER actions_card_target BEFORE INSERT OR UPDATE OF card_id, user_id ON actions
  FOR EACH ROW WHEN (NEW.card_id IS NOT NULL) EXECUTE FUNCTION actions_card_target_guard();

COMMENT ON COLUMN actions.card_id IS
  'v1.3 (004): set only on a Jira or Calendar action sent from one of the user''s own cards; points at that card. NULL for every other action.';

-- 2. No Reveal, and notes are stored as typed (proposals §18.4, §20.1).
--    SECEP never holds a credential's value, and a note is the user's own text. So masked_secrets holds email rows
--    only, and value_enc is optional (the pipeline writes the type, not the value). Rows that hung on a note (made
--    under the old masking rule) are removed.
DELETE FROM masked_secrets WHERE email_id IS NULL;
ALTER TABLE masked_secrets DROP CONSTRAINT masked_secrets_source_check;
DROP INDEX masked_secrets_note_idx;
ALTER TABLE masked_secrets DROP CONSTRAINT masked_secrets_note_fk;
ALTER TABLE masked_secrets DROP COLUMN note_id;
ALTER TABLE masked_secrets ALTER COLUMN email_id SET NOT NULL;
ALTER TABLE masked_secrets ALTER COLUMN value_enc DROP NOT NULL;   -- the shape CHECK still applies when it is set
COMMENT ON COLUMN masked_secrets.value_enc IS
  'v1.3 (004): normally NULL. SECEP never stores or reveals a credential''s value (proposals §18.4); only secret_type is used. Candidate to drop once the demo seeder stops writing a placeholder.';
COMMENT ON COLUMN notes.body IS
  'Markdown-lite, stored as typed. Notes are not masked (proposals §20.1).';

-- 3. An email in a project is a task (proposals §23): one rule-made board card per email, shared by every
--    project the email is in.
CREATE UNIQUE INDEX actions_one_rule_card_idx ON actions (email_id, user_id)
  WHERE origin = 'rule' AND type = 'add_board_card';

-- 4. Project colour is hex, lower case (proposals §18.1). Settles open item 4 for projects; tag colour is still open.
ALTER TABLE projects ADD CONSTRAINT projects_colour_hex CHECK (colour ~ '^#[0-9a-f]{6}$');
COMMENT ON COLUMN projects.colour IS 'Hex #rrggbb, lower case (proposals §18.1).';

-- 5. Subject-only search (proposals §26, q_in=subject). The existing emails_trgm_idx covers subject + body, so it
--    cannot serve a search on the subject alone. M6 filters on coalesce(subject,'') ILIKE '%term%', same expression.
CREATE INDEX emails_subject_trgm_idx ON emails USING gin ((coalesce(subject,'')) gin_trgm_ops);

-- Comment-only: shapes that live in jsonb and are validated by M6 (422).
COMMENT ON COLUMN users.ui_prefs IS
  'Validated by M6. Keys: theme (light|dark|auto), motion (full|reduced|off or null), sidebar_collapsed, skip_lock, idle_minutes, glance_subjects, popup_rules {normal,focus,quiet: {urgency: all|medium|high|critical|none, sentiment: off|frustrated|negative}}, quiet_hours {start,end} "HH:MM" or null (null = off, the default), keybinds {action: combo} (overrides only), onboarding {tour, tour_step, checklist_hidden, done[], hints[]}.';
COMMENT ON COLUMN user_layouts.pages IS
  'Ordered [{id uuid, name 1-40, widgets: [ordered, max 24 per page]}]. Widget: {id, type, size small|medium|large, hidden, stacked boolean, title, colour (8 swatch names), icon (one emoji), filter (inbox_column only), sort, density}. stacked = true shares the slot of the widget before it at half height; at most two per slot. Replaces the {kind:stack} idea in the 16 Nov doc (open item 7).';
COMMENT ON COLUMN emails.attachments IS
  '[{filename, mime, size, sha256, attachment_id}]. attachment_id is Gmail''s id, kept by ingestion so M6 can stream the file (FR-CNT-007).';

-- migrate:down
-- Restores the 001 shape. Rows made after 004 that rely on it (card sends, nullable secrets) are removed or filled.
COMMENT ON COLUMN emails.attachments IS NULL;
COMMENT ON COLUMN user_layouts.pages IS NULL;
COMMENT ON COLUMN users.ui_prefs IS NULL;

DROP INDEX IF EXISTS emails_subject_trgm_idx;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_colour_hex;
COMMENT ON COLUMN projects.colour IS NULL;

DROP INDEX IF EXISTS actions_one_rule_card_idx;

COMMENT ON COLUMN notes.body IS NULL;
COMMENT ON COLUMN masked_secrets.value_enc IS NULL;
UPDATE masked_secrets SET value_enc = repeat('QUJD', 20) WHERE value_enc IS NULL;
ALTER TABLE masked_secrets ALTER COLUMN value_enc SET NOT NULL;
ALTER TABLE masked_secrets ALTER COLUMN email_id DROP NOT NULL;
ALTER TABLE masked_secrets ADD COLUMN note_id uuid;
ALTER TABLE masked_secrets ADD CONSTRAINT masked_secrets_note_fk FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE;
ALTER TABLE masked_secrets ADD CONSTRAINT masked_secrets_source_check CHECK ((email_id IS NOT NULL) <> (note_id IS NOT NULL));
CREATE INDEX masked_secrets_note_idx ON masked_secrets (note_id) WHERE note_id IS NOT NULL;

DROP TRIGGER IF EXISTS actions_card_target ON actions;
DROP FUNCTION IF EXISTS actions_card_target_guard();
DROP INDEX IF EXISTS actions_card_idx;
COMMENT ON COLUMN actions.card_id IS NULL;
DELETE FROM actions WHERE card_id IS NOT NULL;
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_card_id_check;
ALTER TABLE actions DROP COLUMN IF EXISTS card_id;
