import type { Store } from './db';
import { id, now } from './db';

export interface EmailMessage { to: string; subject: string; html: string; text: string }
export interface EmailAdapter { name: string; send(message: EmailMessage): Promise<void> }

// Console adapter: used in demo mode and when no provider is configured.
export class ConsoleAdapter implements EmailAdapter {
  name = 'console';
  async send(message: EmailMessage) { console.log(`[email:console] to=${message.to} subject="${message.subject}"\n${message.text}`); }
}

// Resend adapter: https://resend.com — transactional email API.
export class ResendAdapter implements EmailAdapter {
  name = 'resend';
  constructor(private apiKey: string, private sender: string) {}
  async send(message: EmailMessage) {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: this.sender, to: [message.to], subject: message.subject, html: message.html, text: message.text }) });
    if (!response.ok) throw new Error(`Resend rejected the email (${response.status})`);
  }
}

// SMTP adapter: any standard mail server. Avoids provider lock-in.
export function createSmtpAdapter(config: { host: string; port: number; user: string; pass: string; from: string }): EmailAdapter {
  return {
    name: 'smtp',
    async send(message: EmailMessage) {
      // Lazy-require so SMTP users are the only ones who need nodemailer.
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.port === 465, auth: config.user ? { user: config.user, pass: config.pass } : undefined });
      try { await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, html: message.html, text: message.text }); } finally { transport.close(); }
    },
  };
}

export function createEmailAdapter(env: NodeJS.ProcessEnv): EmailAdapter {
  if (env.RESEND_API_KEY) return new ResendAdapter(env.RESEND_API_KEY, env.EMAIL_FROM || 'CohortKit <no-reply@cohortkit.local>');
  if (env.SMTP_HOST) return createSmtpAdapter({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.EMAIL_FROM || env.SMTP_USER || 'no-reply@cohortkit.local' });
  return new ConsoleAdapter();
}

const MAX_ATTEMPTS = 5;

export interface EmailRow { id: string; org_id: string; email_to: string; subject: string; html: string; body_text: string; status: 'pending' | 'sent' | 'failed'; provider: string; error: string; attempts: number; dedupe_key: string | null; created_at: string; sent_at: string | null }

// Enqueue an email for delivery. Dedupe keys make reminder emails idempotent.
export function enqueue(store: Store, orgId: string, message: EmailMessage, dedupeKey?: string): boolean {
  if (dedupeKey) {
    const existing = store.get('SELECT id FROM emails WHERE dedupe_key=?', dedupeKey);
    if (existing) return false;
  }
  store.run('INSERT INTO emails(id,org_id,email_to,subject,html,body_text,status,provider,error,attempts,dedupe_key,created_at,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id(), orgId, message.to, message.subject, message.html, message.text, 'pending', '', '', 0, dedupeKey || null, now(), null);
  return true;
}

// Deliver pending email with bounded retries. Returns the number attempted.
export async function flushOutbox(store: Store, adapter: EmailAdapter): Promise<number> {
  const pending = store.all<EmailRow>(`SELECT * FROM emails WHERE status='pending' AND attempts<? ORDER BY created_at LIMIT 20`, MAX_ATTEMPTS);
  for (const row of pending) {
    try {
      await adapter.send({ to: row.email_to, subject: row.subject, html: row.html, text: row.body_text });
      store.run('UPDATE emails SET status=?,provider=?,error=?,sent_at=? WHERE id=?', 'sent', adapter.name, '', now(), row.id);
    } catch (e) {
      const failed = row.attempts + 1 >= MAX_ATTEMPTS;
      store.run('UPDATE emails SET status=?,provider=?,error=?,attempts=attempts+1,sent_at=? WHERE id=?', failed ? 'failed' : 'pending', adapter.name, String((e as Error).message || e), failed ? now() : null, row.id);
    }
  }
  return pending.length;
}

export function pendingEmails(store: Store) { return store.get<{ n: number }>("SELECT count(*) n FROM emails WHERE status='pending'")?.n ?? 0; }

// Queue deadline reminders for open cohorts closing within 48 hours.
// Cohort configs are scanned in the application layer so this works on both SQLite and Postgres.
export function queueDeadlineReminders(store: Store, origin: string, hoursAhead = 48) {
  const nowMs = Date.now();
  const soonMs = nowMs + hoursAhead * 3600000;
  const cohorts = store.all<{ id: string; org_id: string; config: string }>("SELECT id,org_id,config FROM cohorts");
  const orgs = store.all<{ id: string; name: string; branding: string }>('SELECT id,name,branding FROM organizations');
  const orgById = new Map(orgs.map(o => [o.id, o]));
  let queued = 0;
  for (const cohort of cohorts) {
    const config = JSON.parse(cohort.config);
    if (config.status !== 'open') continue;
    const deadline = Date.parse(config.deadline);
    if (!(deadline > nowMs && deadline < soonMs)) continue;
    const org = orgById.get(cohort.org_id);
    const apps = store.all<{ id: string; email: string; data: string }>("SELECT id,email,data FROM applications WHERE org_id=? AND cohort_id=? AND status='submitted' AND outcome IS NULL", cohort.org_id, cohort.id);
    for (const app of apps) {
      const startup = JSON.parse(app.data).startupName;
      const message = reminderMessage(org?.name || 'Cohort', config.name, config.deadline, startup, `${origin}/application/`);
      if (enqueue(store, cohort.org_id, { to: app.email, ...message }, `reminder:${cohort.id}:${app.id}`)) queued++;
    }
  }
  return queued;
}

// --- Templates -----------------------------------------------------------

const shell = (body: string) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#25332e">${body}<hr style="border:0;border-top:1px solid #e4e8e1;margin:28px 0"/><p style="font-size:11px;color:#8a958a">Sent by CohortKit — open-source software for accelerator and incubator programs.</p></div>`;

export function invitationMessage(orgName: string, role: string, url: string): Omit<EmailMessage,'to'> {
  const subject = role === 'founder' ? `${orgName} invited you to apply` : `${orgName} invited you to join as ${role}`;
  const body = role === 'founder'
    ? `<p>${orgName} invited you to apply to their cohort.</p><p><a href="${url}">Open your application</a></p>`
    : `<p>${orgName} invited you to join their workspace as ${role}.</p><p><a href="${url}">Accept the invitation</a></p><p>The link expires in 7 days.</p>`;
  return { subject, html: shell(body), text: body.replace(/<[^>]+>/g, ' ') + '\n' + url };
}

export function draftLinkMessage(orgName: string, cohortName: string, url: string): Omit<EmailMessage,'to'> {
  const subject = `${cohortName}: your private application link`;
  const body = `<p>Your draft application for <strong>${cohortName}</strong> is saved. Use your private link to continue any time:</p><p><a href="${url}">Continue your application</a></p><p>Keep this link private — it identifies you.</p>`;
  return { subject, html: shell(body), text: `Your draft for ${cohortName} is saved. Continue here: ${url}` };
}

export function receiptMessage(orgName: string, cohortName: string, startupName: string, deadline: string, url: string): Omit<EmailMessage,'to'> {
  const subject = `${cohortName}: application received`;
  const body = `<p>We received your application from <strong>${startupName}</strong> to ${cohortName}.</p><p>Applications close ${new Date(deadline).toLocaleDateString()}. Decisions are shared through your private status link — save it somewhere safe:</p><p><a href="${url}">Your private status link</a></p>`;
  return { subject, html: shell(body), text: `Application received for ${cohortName}. Your private status link: ${url}` };
}

export function decisionMessage(orgName: string, cohortName: string, startupName: string, outcome: string, notes: string, feedback: string): Omit<EmailMessage,'to'> {
  const subject = `${cohortName}: decision for ${startupName}`;
  const body = `<p>${orgName} has recorded a decision for <strong>${startupName}</strong> in ${cohortName}:</p><p style="font-size:18px;font-weight:bold">${outcome.toUpperCase()}</p><p>${notes}</p>${feedback ? `<p><strong>Feedback from the review team:</strong></p><p>${feedback}</p>` : ''}`;
  return { subject, html: shell(body), text: `${orgName} decision for ${startupName}: ${outcome}\n${notes}${feedback ? '\nFeedback: ' + feedback : ''}` };
}

export function reminderMessage(orgName: string, cohortName: string, deadline: string, startupName: string, statusLinkBase: string): Omit<EmailMessage,'to'> {
  const subject = `${cohortName}: applications close soon`;
  const body = `<p>Applications for ${cohortName} close on ${new Date(deadline).toLocaleString()}. We received your application from <strong>${startupName}</strong> — no action is needed unless you want to review it.</p>`;
  return { subject, html: shell(body), text: `Applications for ${cohortName} close soon.` };
}