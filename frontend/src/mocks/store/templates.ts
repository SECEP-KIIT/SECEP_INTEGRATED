// Email templates for the generated mailbox. All names and domains are fictional (.example). Bodies are already
// "sanitized and masked", as M2 would store them: secrets appear only as [MASKED:<type>] tokens (FR-SEC-006).
import type { EmailType, JiraPriority, RoleCategory, Sentiment, Urgency } from '../../api/types'

export interface Sender {
  name: string
  address: string
  /** PROPOSED from.role_category (proposals §8.5): what M6 would know from the tenant directory. Unset = unknown. */
  role?: RoleCategory
}

export const SENDERS: Sender[] = [
  { name: 'R. Sen', address: 'r.sen@northwind.example', role: 'Executive' },
  { name: 'Priya Nair', address: 'priya.nair@northwind.example', role: 'Manager' },
  { name: 'Arjun Mehta', address: 'arjun.mehta@northwind.example', role: 'Engineer' },
  { name: 'Lena Fischer', address: 'lena.fischer@northwind.example', role: 'Analyst' },
  { name: 'Kenji Ito', address: 'kenji.ito@northwind.example', role: 'Consultant' },
  { name: 'IT Helpdesk', address: 'it-helpdesk@northwind.example' },
  { name: 'Finance Ops', address: 'finance-ops@northwind.example' },
  { name: 'Maya Brooks', address: 'maya@contoso-client.example' },
  { name: 'Diego Alvarez', address: 'diego@fabrikam-partners.example' },
  { name: 'Travel Desk', address: 'travel@northwind.example' },
  { name: 'Calendar', address: 'calendar-noreply@northwind.example' },
  { name: 'Ops Alerts', address: 'alerts@status.northwind.example' },
]

export interface LinkSpec {
  anchor: string
  url: string
  verdict: 'clean' | 'suspicious' | 'malicious' | 'pending'
  signals?: string[]
  /** Redirect chain the click-time resolver would find; defaults to [url]. */
  chain?: string[]
  /** Mock only: the click-time resolver finds a worse verdict than delivery did (a redirect that changed since). */
  clickVerdict?: 'suspicious' | 'malicious'
  /** Mock only: the click-time check takes this long (exercises the popup-blocking fallback, proposals §11.2). */
  clickDelayMs?: number
}

export interface ActionSpec {
  type: 'create_jira_issue' | 'add_board_card' | 'add_calendar_event'
  title: string
  description: string
  priority?: JiraPriority
  /** Due date, days from the received date (for "today", "within 5 days", "no rush"). */
  dueInDays?: number
  /** Due date on the next given weekday on or after the received date (0 = Sunday), for "by Friday". */
  dueOn?: number
  /**
   * Meeting start as the summary states it, in local wall-clock time: the same day as received ("today at 3 pm") or
   * the next given weekday ("Thu 11:00"). If that moment has passed when the email arrives, the next day or week.
   */
  startAt?: { day: 'same' | number; hour: number; minute?: number }
  minutes?: number
}

export interface Template {
  type: EmailType
  urgency: Urgency
  sentiment: Sentiment
  /** Index into SENDERS, or a one-off sender (phishing). */
  from: number | Sender
  subject: string
  body: string
  oneLine: string
  short: string
  action?: ActionSpec
  links?: LinkSpec[]
  secrets?: { type: string; value: string }[]
  attachments?: { filename: string; mime: string; size: number }[]
  auth?: { spf: string; dkim: string; dmarc: string }
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * One email whose links cover every click-time outcome (FR-SEC-004), so the link flow can be checked by hand: open
 * (clean), an interstitial found only at click time (delivered clean, the redirect now lands elsewhere), suspicious
 * (interstitial with the inline warning), malicious (blocked), and a slow check (6 s, past the browser's popup window).
 */
export const LINK_SAMPLES: Template = {
  type: 'Info', urgency: 'Low', sentiment: 'Neutral', from: 3,
  subject: 'Links for this week’s planning',
  body: 'Hi,\n\nEverything for Thursday’s planning in one place: the sprint board, the shared slides, the vendor portal for the renewal quote, the invoice viewer Finance sent round, and last year’s archive (that server is slow).\n\nLena',
  oneLine: 'Lena collected the planning links: board, slides, vendor portal, invoice viewer, archive.',
  short: 'Lena shares the links for Thursday’s planning: the sprint board, the shared slides, the vendor portal for the renewal quote, an invoice viewer from Finance, and last year’s archive, which is slow to load.',
  links: [
    { anchor: 'Sprint board', url: 'https://boards.northwind.example/sprint-42', verdict: 'clean' },
    { anchor: 'Shared slides', url: 'https://lnk.example/q3-slides', verdict: 'clean', clickVerdict: 'suspicious', signals: ['shortener', 'redirect_changed', 'new_domain'], chain: ['https://lnk.example/q3-slides', 'https://slides-share.example/view/88'] },
    { anchor: 'Vendor portal', url: 'https://northwlnd-vendors.example/login', verdict: 'suspicious', signals: ['lookalike'] },
    { anchor: 'Invoice viewer', url: 'https://invoice-view.example/open', verdict: 'malicious', signals: ['safe_browsing', 'new_domain'] },
    { anchor: 'Last year’s archive', url: 'https://archive.northwind.example/2025', verdict: 'clean', clickDelayMs: 6_000 },
  ],
}

export const TEMPLATES: Template[] = [
  {
    type: 'Task', urgency: 'Critical', sentiment: 'Neutral', from: 0,
    subject: 'Q3 board deck: final numbers by Friday 5 pm',
    body: 'Hi,\n\nFinance signed off the Q3 numbers this morning. Can you put the final revenue and churn figures into slides 4–7 of the attached board deck and send it back by Friday 5 pm?\n\nThanks,\nR. Sen',
    oneLine: 'Add the final Q3 revenue and churn figures to slides 4–7 and send the deck by Friday 5 pm.',
    short: 'R. Sen needs the board deck finished before Friday’s meeting. Finance has signed off the Q3 revenue and churn numbers; they go on slides 4–7. Send the updated deck back by Friday 5 pm.',
    action: { type: 'create_jira_issue', title: 'Finalise Q3 board deck (slides 4–7)', description: 'Add the signed-off Q3 revenue and churn figures to slides 4–7 and send the deck to R. Sen.', priority: 'Highest', dueOn: 5 },
    attachments: [{ filename: 'board-deck-q3.pptx', mime: PPTX, size: 482113 }],
  },
  {
    type: 'Task', urgency: 'High', sentiment: 'Negative', from: 7,
    subject: 'Export still failing for the March report',
    body: 'Hello,\n\nThe CSV export of the March report has failed again this morning, third time this week. Our auditors need the file by Thursday. Can someone on your side look at it today?\n\nMaya',
    oneLine: 'Client’s March CSV export keeps failing; auditors need it by Thursday.',
    short: 'Maya at Contoso reports the March report export failed for the third time this week. Their auditors need the file by Thursday, so she asks for someone to investigate today.',
    action: { type: 'create_jira_issue', title: 'Fix failing CSV export for Contoso March report', description: 'Contoso’s March report CSV export fails repeatedly; auditors need it by Thursday.', priority: 'High', dueOn: 4 },
  },
  {
    type: 'Task', urgency: 'Medium', sentiment: 'Neutral', from: 2,
    subject: 'Can you review my PR for the billing retry logic?',
    body: 'Hey,\n\nI pushed the retry/backoff change for the billing worker. It’s small, mostly the 429 handling. Could you review it this week?\n\nArjun',
    oneLine: 'Arjun asks for a review of his billing retry/backoff PR this week.',
    short: 'Arjun has pushed a small change to the billing worker’s retry and backoff handling, mostly for 429 responses, and asks for a code review this week.',
    action: { type: 'create_jira_issue', title: 'Review billing retry/backoff PR', description: 'Review Arjun’s PR for 429 handling in the billing worker.', priority: 'Medium', dueInDays: 4 },
  },
  {
    type: 'Task', urgency: 'Low', sentiment: 'Positive', from: 3,
    subject: 'Small favour: update the onboarding FAQ',
    body: 'Hi!\n\nWhen you get a moment, could you add the two new questions about SSO to the onboarding FAQ? No rush at all.\n\nThanks so much,\nLena',
    oneLine: 'Add two SSO questions to the onboarding FAQ; no rush.',
    short: 'Lena asks you to add the two new SSO questions to the onboarding FAQ whenever you have time.',
    action: { type: 'add_board_card', title: 'Add SSO questions to onboarding FAQ', description: 'Two new SSO questions from Lena.', dueInDays: 10 },
  },
  {
    type: 'Task', urgency: 'High', sentiment: 'Frustrated', from: 8,
    subject: 'Still waiting on the signed contract',
    body: 'Hi,\n\nThis is the third reminder. We still haven’t received the countersigned contract and our legal team is blocking the kickoff. Please send it today.\n\nDiego',
    oneLine: 'Partner is blocked: the countersigned contract is overdue, needed today.',
    short: 'Diego from Fabrikam says this is the third reminder: their legal team is blocking the kickoff until they receive the countersigned contract. He asks for it today.',
    action: { type: 'create_jira_issue', title: 'Send countersigned Fabrikam contract', description: 'Fabrikam legal is blocking kickoff until they receive the countersigned contract.', priority: 'High', dueInDays: 0 },
  },
  {
    type: 'Meeting', urgency: 'Medium', sentiment: 'Positive', from: 1,
    subject: 'Design review for the onboarding flow, Thu 11:00',
    body: 'Hi both,\n\nCould we review the new onboarding screens on Thursday at 11:00? 45 minutes should do. Please bring your notes on the sign-up step.\n\nPriya',
    oneLine: 'Design review of the onboarding flow on Thursday, 11:00–11:45.',
    short: 'Priya invites you to review the new onboarding screens on Thursday at 11:00 for 45 minutes. Bring notes on the sign-up step.',
    action: { type: 'add_calendar_event', title: 'Onboarding flow design review', description: 'Review the new onboarding screens; bring notes on the sign-up step.', startAt: { day: 4, hour: 11 }, minutes: 45 },
  },
  {
    type: 'Meeting', urgency: 'Low', sentiment: 'Neutral', from: 10,
    subject: 'Invitation: Weekly sync @ Mon 10:00',
    body: 'You have been invited to Weekly sync.\nWhen: Monday 10:00–10:30\nWhere: Room 4B / video link in the invite\n\nThis is an automated message.',
    oneLine: 'Invitation to the 30-minute weekly sync on Monday at 10:00.',
    short: 'Calendar invitation for the weekly sync, Monday 10:00–10:30 in room 4B or by video.',
    action: { type: 'add_calendar_event', title: 'Weekly sync', description: 'Room 4B or video.', startAt: { day: 1, hour: 10 }, minutes: 30 },
  },
  {
    type: 'Meeting', urgency: 'High', sentiment: 'Neutral', from: 7,
    subject: 'Quick call today about the renewal?',
    body: 'Hi,\n\nCould we do a 20-minute call this afternoon about the renewal terms? 3 pm works for me.\n\nBest,\nMaya',
    oneLine: 'Client wants a 20-minute renewal call this afternoon at 3 pm.',
    short: 'Maya proposes a 20-minute call at 3 pm today to discuss the renewal terms.',
    action: { type: 'add_calendar_event', title: 'Contoso renewal call', description: 'Discuss renewal terms with Maya.', startAt: { day: 'same', hour: 15 }, minutes: 20 },
  },
  {
    type: 'Approval', urgency: 'High', sentiment: 'Positive', from: 0,
    subject: 'Please approve: travel request for the Pune client visit',
    body: 'Hi,\n\nI’ve raised the travel request for the Pune client visit (12–13 Nov). Could you approve it in the portal before Wednesday so we can book?\n\nThanks,\nR. Sen',
    oneLine: 'Approve the travel request for the Pune client visit on 12–13 Nov before Wednesday.',
    short: 'R. Sen asks you to approve the travel request for the Pune client visit on 12–13 November. Bookings close on Wednesday.',
    action: { type: 'add_board_card', title: 'Approve Pune travel request', description: 'Approve the 12–13 Nov travel request in the portal before Wednesday.', dueOn: 3 },
  },
  {
    type: 'Approval', urgency: 'Medium', sentiment: 'Neutral', from: 6,
    subject: 'Expense report #4471 awaiting your approval',
    body: 'Expense report #4471 (team offsite, 3 items) is waiting for your approval. Reports not approved within 5 days are returned to the submitter.\n\nFinance Ops',
    oneLine: 'Expense report #4471 (team offsite) needs approval within 5 days.',
    short: 'Finance Ops reminds you that expense report #4471 for the team offsite is awaiting approval; it will be returned after 5 days.',
    action: { type: 'add_board_card', title: 'Approve expense report #4471', description: 'Team offsite, 3 items.', dueInDays: 5 },
  },
  {
    type: 'Approval', urgency: 'Low', sentiment: 'Neutral', from: 4,
    subject: 'OK to publish the release notes?',
    body: 'Hi,\n\nDraft release notes for 2.14 are in the shared folder. OK to publish them on Friday?\n\nKenji',
    oneLine: 'Kenji asks for sign-off to publish the 2.14 release notes on Friday.',
    short: 'Kenji has drafted the 2.14 release notes and asks whether he can publish them on Friday.',
    action: { type: 'add_board_card', title: 'Sign off 2.14 release notes', description: 'Draft in the shared folder.', dueOn: 5 },
  },
  {
    type: 'Credentials', urgency: 'Medium', sentiment: 'Neutral', from: 5,
    subject: 'Your VPN account is ready',
    body: 'Hello,\n\nYour VPN account has been created.\n\nUsername: demo\nPassword: [MASKED:password]\n\nPlease change the password after your first sign-in.\n\nIT Helpdesk',
    oneLine: 'Your new VPN account is ready; change the password after first sign-in.',
    short: 'IT Helpdesk created your VPN account and sent the initial password. Change it after your first sign-in.',
    secrets: [{ type: 'password', value: 'Lantern-Orbit-58' }],
  },
  {
    type: 'Credentials', urgency: 'High', sentiment: 'Neutral', from: 2,
    subject: 'Staging API key for the partner sandbox',
    body: 'Here’s the staging key for the partner sandbox:\n\n[MASKED:api_key]\n\nIt expires in 7 days. Don’t paste it into tickets.\n\nArjun',
    oneLine: 'Staging API key for the partner sandbox, valid for 7 days.',
    short: 'Arjun shares a staging API key for the partner sandbox. It expires in 7 days and must not be pasted into tickets.',
    secrets: [{ type: 'api_key', value: 'sk_demo_7Qk2-not-a-real-key' }],
  },
  {
    type: 'Credentials', urgency: 'Critical', sentiment: 'Neutral', from: 5,
    subject: 'Your sign-in code',
    body: 'Your one-time sign-in code is [MASKED:otp]. It expires in 10 minutes. If you didn’t request it, contact IT Helpdesk.',
    oneLine: 'One-time sign-in code, expires in 10 minutes.',
    short: 'IT Helpdesk sent a one-time sign-in code that expires in 10 minutes.',
    secrets: [{ type: 'otp', value: '482 913' }],
  },
  {
    type: 'Info', urgency: 'High', sentiment: 'Negative',
    from: { name: 'Northwind Security', address: 'security@northwlnd.example' },
    subject: 'Unusual sign-in detected: verify your account',
    body: 'Dear user,\n\nWe detected an unusual sign-in to your account. To keep access, verify your account within 24 hours using the button below.\n\nNorthwind Security Team',
    oneLine: 'Claims an unusual sign-in and asks you to verify your account within 24 hours.',
    short: 'The sender says an unusual sign-in was detected and asks you to verify your account through a link within 24 hours or lose access.',
    links: [{ anchor: 'Verify your account', url: 'https://bit.example/x7Kq', verdict: 'suspicious', signals: ['lookalike', 'shortener', 'auth_fail'], chain: ['https://bit.example/x7Kq', 'https://northwlnd-login.example/verify'] }],
    auth: { spf: 'pass', dkim: 'none', dmarc: 'fail' },
  },
  {
    type: 'Info', urgency: 'Critical', sentiment: 'Negative',
    from: { name: 'Payroll Team', address: 'payroll@paystub-update.example' },
    subject: 'Action required: confirm your salary account today',
    body: 'Your salary payment is on hold. Confirm your bank details before 6 pm today to avoid a delay.',
    oneLine: 'Claims your salary is on hold and asks you to confirm bank details today.',
    short: 'The sender claims your salary payment is on hold and urges you to confirm your bank details before 6 pm.',
    links: [{ anchor: 'Confirm bank details', url: 'https://paystub-update.example/confirm', verdict: 'malicious', signals: ['safe_browsing', 'new_domain'] }],
    auth: { spf: 'fail', dkim: 'none', dmarc: 'fail' },
  },
  {
    type: 'Info', urgency: 'Low', sentiment: 'Positive', from: 3,
    subject: 'Team lunch on Friday 🎉',
    body: 'Hi all,\n\nWe’re doing a team lunch on Friday at 1 pm to celebrate the launch. Menu and RSVP form here.\n\nLena',
    oneLine: 'Team lunch on Friday at 1 pm to celebrate the launch.',
    short: 'Lena invites the team to a lunch on Friday at 1 pm to celebrate the launch, with the menu and RSVP form linked.',
    links: [{ anchor: 'Menu and RSVP form', url: 'https://forms.northwind.example/lunch', verdict: 'clean' }],
  },
  {
    type: 'Info', urgency: 'Medium', sentiment: 'Neutral', from: 11,
    subject: 'Resolved: elevated API latency in eu-west',
    body: 'The incident affecting API latency in eu-west between 08:10 and 08:42 UTC is resolved. A post-incident review will follow.',
    oneLine: 'The eu-west API latency incident (08:10–08:42 UTC) is resolved.',
    short: 'Ops reports the elevated API latency in eu-west between 08:10 and 08:42 UTC has been resolved; a review will follow.',
    links: [{ anchor: 'Status page', url: 'https://status.northwind.example/incidents/311', verdict: 'clean' }],
  },
  {
    type: 'Info', urgency: 'Low', sentiment: 'Neutral', from: 9,
    subject: 'Your itinerary for 12 Nov',
    body: 'Your itinerary for the 12 Nov trip to Pune is attached. Check-in opens 24 hours before departure.',
    oneLine: 'Itinerary for the 12 Nov Pune trip; check-in opens 24 h before.',
    short: 'The travel desk sent your itinerary for the 12 November trip to Pune. Online check-in opens 24 hours before departure.',
    attachments: [{ filename: 'itinerary-pune.pdf', mime: 'application/pdf', size: 88213 }],
  },
  {
    type: 'Info', urgency: 'Low', sentiment: 'Neutral', from: 6,
    subject: 'October budget report',
    body: 'The October budget report is attached. Spend is 4 % under plan.',
    oneLine: 'October budget report attached; spend is 4 % under plan.',
    short: 'Finance Ops shares the October budget report. Spend came in 4 % under plan.',
    attachments: [{ filename: 'budget-oct.xlsx', mime: XLSX, size: 51200 }],
  },
  {
    type: 'Info', urgency: 'Medium', sentiment: 'Positive', from: 4,
    subject: 'Release 2.13 shipped',
    body: 'Release 2.13 is live for all customers. Highlights and the changelog are on the wiki.',
    oneLine: 'Release 2.13 is live; changelog on the wiki.',
    short: 'Kenji announces that release 2.13 is live for all customers, with highlights and the changelog on the wiki.',
    links: [{ anchor: 'Changelog', url: 'https://wiki.northwind.example/releases/2-13', verdict: 'pending' }],
  },
  {
    type: 'Info', urgency: 'Low', sentiment: 'Neutral', from: 1,
    subject: 'Notes from Tuesday’s design crit',
    body: 'Sharing my notes from Tuesday’s design crit. Main themes: fewer steps in sign-up, clearer error copy.',
    oneLine: 'Priya’s notes from Tuesday’s design crit: fewer sign-up steps, clearer errors.',
    short: 'Priya shares notes from the design critique. Main themes were reducing sign-up steps and clearer error messages.',
  },
]

/** The five §7.2 demo emails, in order: task, meeting, approval, password, lookalike link. */
export const DEMO_TEMPLATES = [0, 5, 8, 11, 14]
