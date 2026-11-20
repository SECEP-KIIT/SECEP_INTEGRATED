// Email reads for one user: the list query (GET /emails, §6.5 + PROPOSED view/due/needs_review) and the wire
// shapes (§6.4.1 EmailListItem / EmailDetail). Per-person state comes from email_user_state, never from emails.
import { Fail, UUID, csv, isDate } from '../http.js';
import { query } from './db.js';

export const TYPES = ['Task', 'Info', 'Credentials', 'Meeting', 'Approval'];
export const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
export const SENTIMENTS = ['Positive', 'Neutral', 'Negative', 'Frustrated'];
const FLAGS = ['none', 'suspicious', 'malicious'];
const VIEWS = ['unread', 'due_today', 'needs_reply', 'overdue', 'handled'];
const DUE = ['overdue', 'today', 'next_7_days', 'later', 'none'];
const SORTS = ['smart', 'newest', 'oldest', 'due', 'urgency', 'sender', 'confidence'];
export const FILTER_PARAMS = ['project', 'type', 'urgency', 'sentiment', 'flag', 'due', 'needs_review', 'sender', 'received_after', 'received_before', 'view'];

/** The columns every list item needs. $1 is always the user id. */
const ITEM_SELECT = `
  SELECT e.id, e.thread_id, e.from_addr, e.from_name, e.to_addrs, e.cc_addrs, e.recipient_position, e.subject,
         e.received_at, e.status, e.security_flag, e.duplicate_count, e.attachments,
         t.email_type, t.type_conf, t.type_source, t.urgency, t.urgency_conf, t.sentiment, t.sentiment_score,
         t.sentiment_conf, t.needs_review, t.model_version, t.processed_at,
         su.one_line, su.short,
         coalesce(th.message_count, 1) AS message_count,
         (s.read_at IS NOT NULL) AS read, (s.handled_at IS NOT NULL) AS handled, (s.pinned_at IS NOT NULL) AS pinned,
         s.snoozed_until, s.due_date,
         sender.role_category AS from_role,
         EXISTS (SELECT 1 FROM masked_secrets ms WHERE ms.email_id = e.id) AS has_masked_secret,
         -- PROPOSED (proposals §4, §18): the email's projects for its card, primary first, then in the order added.
         coalesce((SELECT json_agg(json_build_object('id', pr.id, 'name', pr.name, 'colour', pr.colour, 'is_primary', ep.is_primary)
                     ORDER BY ep.is_primary DESC, ep.added_at)
                     FROM email_projects ep JOIN projects pr ON pr.id = ep.project_id
                    WHERE ep.email_id = e.id AND pr.owner_user_id = $1), '[]'::json) AS projects,
         -- PROPOSED (proposals §19.2): the 📝 count.
         (SELECT count(*)::int FROM notes n WHERE n.target_type = 'email' AND n.target_id = e.id AND n.owner_user_id = $1) AS note_count,
         (SELECT count(*)::int FROM actions a WHERE a.email_id = e.id AND a.user_id = $1 AND a.status = 'proposed') AS proposed_action_count,
         (SELECT a.external_ref FROM actions a WHERE a.email_id = e.id AND a.user_id = $1 AND a.type = 'create_jira_issue'
           AND a.external_ref IS NOT NULL ORDER BY a.updated_at DESC LIMIT 1) AS jira_key
    FROM emails e
    JOIN mailboxes m ON m.id = e.mailbox_id AND m.user_id = $1
    JOIN users me ON me.id = $1
    LEFT JOIN email_user_state s ON s.email_id = e.id AND s.user_id = $1
    LEFT JOIN triage_results t ON t.email_id = e.id
    LEFT JOIN summaries su ON su.email_id = e.id
    LEFT JOIN threads th ON th.id = e.thread_id
    LEFT JOIN users sender ON sender.tenant_id = e.tenant_id AND sender.email = lower(e.from_addr)`;

/** Display names for addresses in to/cc: the stored ones are bare addresses (§6.6 to_addrs text[]). */
const person = (address) => ({ address, name: null });

export function toListItem(r) {
  return {
    id: r.id,
    thread_id: r.thread_id,
    from: { address: r.from_addr, name: r.from_name, role_category: r.from_role ?? null },
    to: r.to_addrs.map(person),
    cc: r.cc_addrs.map(person),
    recipient_position: r.recipient_position,
    subject: r.subject,
    received_at: r.received_at.toISOString(),
    status: r.status,
    security_flag: r.security_flag,
    duplicate_count: r.duplicate_count,
    attachment_count: r.attachments.length,
    reply_count: Math.max(0, r.message_count - 1),
    has_masked_secret: r.has_masked_secret,
    triage: r.email_type
      ? {
          email_type: { label: r.email_type, confidence: r.type_conf, source: r.type_source },
          urgency: { label: r.urgency, confidence: r.urgency_conf },
          sentiment: { label: r.sentiment, score: r.sentiment_score, confidence: r.sentiment_conf },
          needs_review: r.needs_review,
          model_version: r.model_version,
          processed_at: r.processed_at.toISOString(),
        }
      : null,
    summary_one_line: r.one_line ?? null,
    proposed_action_count: r.proposed_action_count,
    jira_key: r.jira_key ?? null,
    pinned: r.pinned,
    snoozed_until: r.snoozed_until?.toISOString() ?? null,
    due_date: r.due_date ?? null,
    handled: r.handled,
    read: r.read,
    projects: r.projects,
    tags: [],
    note_count: r.note_count,
  };
}

/**
 * PROPOSED (proposals §19.1): a user card's projects, primary first. Select it as `a.*, ${CARD_PROJECTS}` from
 * `actions a`; rows without it serialise with [] (an email's actions: the email carries its projects).
 */
export const CARD_PROJECTS = `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'colour', p.colour, 'is_primary', cp.is_primary)
    ORDER BY cp.is_primary DESC, cp.added_at), '[]'::jsonb) FROM card_projects cp JOIN projects p ON p.id = cp.project_id WHERE cp.action_id = a.id) AS projects`;

export const toAction = (a) => ({
  id: a.id,
  email_id: a.email_id,
  type: a.type,
  origin: a.origin,
  status: a.status,
  payload: a.payload,
  board_column: a.board_column,
  board_position: a.board_position,
  external_ref: a.external_ref,
  external_status: a.external_status,
  error: a.error,
  created_at: a.created_at.toISOString(),
  updated_at: a.updated_at.toISOString(),
  projects: a.projects ?? [],
});

export const toLink = (c) => ({
  check_id: c.id,
  anchor_text: c.anchor_text,
  host: c.host,
  verdict: c.verdict,
  go_url: `/api/v1/links/${c.id}/go`,
});

/**
 * PROPOSED open_url (proposals §18.4): the message in Gmail on the web, in the mailbox's own account. SECEP never
 * holds a credential's value; the user opens the original here to see it. null when the message id is unknown.
 */
export const gmailUrl = (address, providerMessageId) =>
  providerMessageId ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#all/${encodeURIComponent(providerMessageId)}` : null;

/** One email's list item for this user, or null if it isn't theirs. */
export async function listItem(userId, emailId) {
  const { rows } = await query(`${ITEM_SELECT} WHERE e.id = $2`, [userId, emailId]);
  return rows[0] ? toListItem(rows[0]) : null;
}

/** EmailDetail (§6.4.1): the list item plus body, actions, links, attachments, secrets and the thread. */
export async function detail(userId, emailId) {
  const { rows } = await query(`${ITEM_SELECT} WHERE e.id = $2`, [userId, emailId]);
  const r = rows[0];
  if (!r) return null;
  const [body, actions, links, secrets, thread] = await Promise.all([
    query('SELECT e.body_text, e.auth_results, e.provider_message_id, m.address FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1', [emailId]),
    query('SELECT * FROM actions WHERE email_id = $1 AND user_id = $2 ORDER BY created_at', [emailId, userId]),
    query('SELECT * FROM url_checks WHERE email_id = $1 ORDER BY checked_at, id', [emailId]),
    // Same order as the [MASKED:<type>] tokens in body_text (inserted in that order).
    query('SELECT id, secret_type FROM masked_secrets WHERE email_id = $1 ORDER BY created_at, id', [emailId]),
    r.thread_id
      ? query('SELECT id, from_addr, from_name, subject, received_at FROM emails WHERE thread_id = $1 ORDER BY received_at', [r.thread_id])
      : { rows: [] },
  ]);
  return {
    ...toListItem(r),
    body_text: body.rows[0].body_text,
    summary_short: r.short ?? null,
    actions: actions.rows.map(toAction),
    links: links.rows.map(toLink),
    attachments: r.attachments.map((a, index) => ({ index, filename: a.filename, mime: a.mime, size: a.size })),
    masked_secrets: secrets.rows,
    open_url: gmailUrl(body.rows[0].address, body.rows[0].provider_message_id),
    auth_results: body.rows[0].auth_results,
    thread: r.thread_id
      ? {
          id: r.thread_id,
          message_count: Math.max(r.message_count, thread.rows.length),
          messages: thread.rows.map((m) => ({ id: m.id, from: { address: m.from_addr, name: m.from_name }, subject: m.subject, received_at: m.received_at.toISOString() })),
        }
      : null,
  };
}

function views(params) {
  const raw = params.get('view');
  if (!raw) return [];
  const list = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const bad = list.filter((v) => !VIEWS.includes(v));
  if (bad.length) throw new Fail(422, 'invalid_parameter', `Unknown view: ${bad.join(', ')}`, { parameter: 'view', allowed: VIEWS });
  return list;
}

function dateParam(params, name) {
  const v = params.get(name);
  if (v === null || v === '') return null;
  if (!isDate(v)) throw new Fail(400, 'bad_request', `${name} must be YYYY-MM-DD`);
  return v;
}

/** Parses and checks the filter parameters (one vocabulary for GET /emails and saved widget filters). */
export function parseFilters(params) {
  const nr = params.get('needs_review');
  if (nr !== null && nr !== '' && nr !== 'true' && nr !== 'false') throw new Fail(400, 'bad_request', 'needs_review must be true or false');
  const project = params.get('project')?.split(',').map((v) => v.trim()).filter(Boolean) ?? null;
  if (project?.some((v) => !UUID.test(v))) throw new Fail(422, 'invalid_parameter', 'project must be project ids', { parameter: 'project' });
  return {
    project: project?.length ? project : null,
    type: csv(params, 'type', TYPES),
    urgency: csv(params, 'urgency', URGENCIES),
    sentiment: csv(params, 'sentiment', SENTIMENTS),
    flag: csv(params, 'flag', FLAGS),
    due: csv(params, 'due', DUE),
    needsReview: nr === 'true' ? true : nr === 'false' ? false : null,
    sender: params.get('sender')?.trim().toLowerCase() || null,
    after: dateParam(params, 'received_after'),
    before: dateParam(params, 'received_before'),
    view: views(params),
  };
}

/** Checks a saved widget filter (layouts); an error message, or null when valid. */
export function filterError(filter) {
  const params = new URLSearchParams(filter);
  const extra = [...params.keys()].find((k) => !FILTER_PARAMS.includes(k));
  if (extra) return `Not a filter parameter: ${extra}`;
  try {
    parseFilters(params);
    return null;
  } catch (err) {
    return err instanceof Fail ? err.message : 'Invalid filter';
  }
}

const ORDER = {
  newest: 'e.received_at DESC',
  oldest: 'e.received_at ASC',
  urgency: `CASE e.urgency WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 9 END, e.received_at DESC`,
  sender: 'lower(coalesce(e.from_name, e.from_addr)), e.received_at DESC',
  confidence: 'coalesce(t.type_conf, 2), e.received_at DESC',
};

/**
 * GET /emails for one user: filters are SQL (OR within a parameter, AND across), "today" is the user's own date
 * (users.timezone), handled mail leaves every list except view=handled, pinned first (FR-UI-023).
 * `smart` and `due` sorts are served as newest until built (as in the mock).
 */
export async function list(userId, params, { limit, offset }) {
  const f = parseFilters(params);
  const sort = params.get('sort') || 'newest';
  if (!SORTS.includes(sort)) throw new Fail(422, 'invalid_parameter', 'sort must be smart, newest, oldest, due, urgency, sender or confidence', { parameter: 'sort' });
  const q = params.get('q')?.trim() || null;
  // PROPOSED (proposals §26): q_in=subject searches subjects only; all (default) also the masked body (FR-UI-026).
  const qIn = params.get('q_in') ?? 'all';
  if (qIn !== 'subject' && qIn !== 'all') throw new Fail(422, 'invalid_parameter', 'q_in must be subject or all', { parameter: 'q_in' });
  // PROPOSED (proposals §27): include_handled=true keeps handled mail in the list (search), same order and paging.
  const ih = params.get('include_handled');
  if (ih !== null && ih !== 'true' && ih !== 'false') throw new Fail(422, 'invalid_parameter', 'include_handled must be true or false', { parameter: 'include_handled' });

  const args = [userId];
  const arg = (v) => (args.push(v), `$${args.length}`);
  const where = [];
  const today = `(now() AT TIME ZONE me.timezone)::date`;
  // FR-UI-021 Project: emails in any of these projects.
  if (f.project) where.push(`EXISTS (SELECT 1 FROM email_projects ep WHERE ep.email_id = e.id AND ep.project_id = ANY(${arg(f.project)}::uuid[]))`);
  if (f.type) where.push(`e.email_type = ANY(${arg(f.type)})`);
  if (f.urgency) where.push(`e.urgency = ANY(${arg(f.urgency)})`);
  if (f.sentiment) where.push(`e.sentiment = ANY(${arg(f.sentiment)})`);
  if (f.flag) where.push(`e.security_flag = ANY(${arg(f.flag)})`);
  if (f.needsReview !== null) where.push(`e.needs_review = ${arg(f.needsReview)}`);
  if (f.sender) {
    const s = arg(f.sender.replace(/^@/, ''));
    where.push(`(lower(e.from_addr) = ${s} OR lower(e.from_addr) LIKE '%@' || ${s})`);
  }
  if (f.after) where.push(`(e.received_at AT TIME ZONE me.timezone)::date >= ${arg(f.after)}`);
  if (f.before) where.push(`(e.received_at AT TIME ZONE me.timezone)::date <= ${arg(f.before)}`);
  if (f.due) {
    const bucket = {
      overdue: `s.due_date < ${today}`,
      today: `s.due_date = ${today}`,
      next_7_days: `s.due_date BETWEEN ${today} AND ${today} + 6`,
      later: `s.due_date > ${today} + 6`,
      none: 's.due_date IS NULL',
    };
    where.push(`(${f.due.map((b) => bucket[b]).join(' OR ')})`);
  }
  // Keyword search over masked text only (FR-UI-026): every term in the subject or the stored body.
  if (q) for (const term of q.split(/\s+/).slice(0, 8)) where.push(`${qIn === 'subject' ? "coalesce(e.subject,'')" : "(coalesce(e.subject,'') || ' ' || e.body_text)"} ILIKE ${arg(`%${term.replace(/[\\%_]/g, '\\$&')}%`)}`);
  if (!f.view.includes('handled') && ih !== 'true') where.push('s.handled_at IS NULL');
  for (const v of f.view) {
    if (v === 'unread') where.push('s.read_at IS NULL');
    if (v === 'handled') where.push('s.handled_at IS NOT NULL');
    if (v === 'due_today') where.push(`s.due_date = ${today}`);
    if (v === 'overdue') where.push(`s.due_date < ${today}`);
    // Demo rule (proposals §10.1, pending team sign-off): latest message inbound, a reply-type email, nothing accepted.
    if (v === 'needs_reply') {
      where.push(`NOT coalesce(th.last_message_from_self, false) AND e.email_type IN ('Task','Approval','Meeting')
        AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.email_id = e.id AND a.user_id = $1 AND a.status IN ('accepted','executing','done'))`);
    }
  }
  const order = ORDER[sort] ?? ORDER.newest;
  const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (s.pinned_at IS NOT NULL) DESC, ${order}, e.id LIMIT ${arg(limit + 1)} OFFSET ${arg(offset)}`;
  const { rows } = await query(sql, args);
  return rows.map(toListItem);
}
