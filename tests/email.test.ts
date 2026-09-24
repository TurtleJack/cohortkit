import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Store } from '../server/db';
import { createApi } from '../server/api';
import { defaultCohort } from '../shared/domain';
import { enqueue, flushOutbox, queueDeadlineReminders, type EmailAdapter, type EmailMessage } from '../server/email';

const origin = 'http://localhost:3100';

class CapturingAdapter implements EmailAdapter {
  name = 'capture';
  sent: EmailMessage[] = [];
  failNext = 0;
  async send(message: EmailMessage) {
    if (this.failNext > 0) { this.failNext--; throw new Error('synthetic delivery failure'); }
    this.sent.push(message);
  }
}

describe('outbox delivery', () => {
  it('delivers pending email and marks it sent', async () => {
    const store = new Store(':memory:');
    const adapter = new CapturingAdapter();
    enqueue(store, 'org1', { to: 'a@example.test', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });
    expect(await flushOutbox(store, adapter)).toBe(1);
    expect(adapter.sent).toHaveLength(1);
    const row = store.get<{ status: string; provider: string }>('SELECT status,provider FROM emails');
    expect(row).toMatchObject({ status: 'sent', provider: 'capture' });
  });

  it('retries failures with bounded attempts', async () => {
    const store = new Store(':memory:');
    const adapter = new CapturingAdapter();
    adapter.failNext = 10;
    enqueue(store, 'org1', { to: 'b@example.test', subject: 'X', html: '', text: '' });
    for (let i = 0; i < 5; i++) await flushOutbox(store, adapter);
    const row = store.get<{ status: string; attempts: number }>('SELECT status,attempts FROM emails');
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('deduplicates reminder keys', () => {
    const store = new Store(':memory:');
    const msg = { to: 'c@example.test', subject: 'R', html: '', text: '' };
    expect(enqueue(store, 'org1', msg, 'reminder:x')).toBe(true);
    expect(enqueue(store, 'org1', msg, 'reminder:x')).toBe(false);
    expect(store.get<{ n: number }>('SELECT count(*) n FROM emails')!.n).toBe(1);
  });
});

describe('email triggers through the API', () => {
  let app: Express;
  let store: Store;
  let orgId = ''; let cohortId = ''; let cohortSlug = '';

  beforeAll(() => {
    store = new Store(':memory:');
    app = createApi(store, { origin, demo: false, secure: false, email: new CapturingAdapter() });
  });

  it('queues invitation, draft, receipt, and decision emails', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/register').set('Origin', origin).send({ name: 'Alex Morgan', email: 'alex@example.test', password: 'correct-horse-battery', organizationName: 'Cascadia Ventures', slug: 'cascadia' });
    orgId = (await admin.get('/api/session')).body.organizations[0].id;
    const cohort = (await admin.post(`/api/orgs/${orgId}/cohorts`).set('Origin', origin).send({ ...defaultCohort(), name: 'Test Cohort', status: 'open' })).body;
    cohortId = cohort.id; cohortSlug = cohort.slug;

    // Founder invitation email
    await admin.post(`/api/orgs/${orgId}/invitations`).set('Origin', origin).send({ name: 'Taylor Brooks', email: 'taylor@example.test', role: 'founder', cohortId });

    // Application draft + receipt emails
    const data = { startupName: 'Canopy', founderName: 'Taylor Brooks', email: 'founder@example.test', industry: 'Climate', location: 'Portland', companyStage: 'MVP', consent: true, answers: Object.fromEntries(cohort.questions.map((q: { id: string; type: string }) => [q.id, q.type === 'url' ? 'https://example.com' : 'answer'])), qualifications: { commitment: true } };
    const draft = await request(app).post(`/api/public/cascadia/${cohortSlug}/drafts`).set('Origin', origin).send(data);
    await request(app).put('/api/public/application').set('Origin', origin).set('Authorization', `Bearer ${draft.body.token}`).send({ data, version: 1, submit: true });

    // Decision email
    const appId = draft.body.id;
    let current = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body;
    await admin.post(`/api/orgs/${orgId}/applications/${appId}/scrub`).set('Origin', origin).send({ notes: 'Complete', version: current.version });
    current = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body;
    await admin.post(`/api/orgs/${orgId}/applications/${appId}/decision`).set('Origin', origin).send({ outcome: 'rejected', notes: 'Not the right fit this round.', version: current.version, override: true });

    const emails = (await admin.get(`/api/orgs/${orgId}/emails`)).body as { subject: string; to: string; status: string }[];
    expect(emails.length).toBeGreaterThanOrEqual(4);
    const subjects = emails.map(e => e.subject).join(' | ');
    expect(subjects).toContain('invited you to apply');
    expect(subjects).toContain('private application link');
    expect(subjects).toContain('application received');
    expect(subjects).toContain('decision for Canopy');
    expect(emails.some(e => e.to === 'founder@example.test')).toBe(true);
  });

  it('queues deadline reminders for cohorts closing soon', async () => {
    const store = new Store(':memory:');
    const app2 = createApi(store, { origin, demo: false, secure: false, email: new CapturingAdapter() });
    const admin = request.agent(app2);
    await admin.post('/api/auth/register').set('Origin', origin).send({ name: 'Alex Morgan', email: 'alex@example.test', password: 'correct-horse-battery', organizationName: 'Cascadia Ventures', slug: 'cascadia' });
    const orgId = (await admin.get('/api/session')).body.organizations[0].id;
    const config = { ...defaultCohort(), name: 'Urgent Cohort', status: 'open' as const, deadline: new Date(Date.now() + 24 * 3600000).toISOString() };
    const cohort = (await admin.post(`/api/orgs/${orgId}/cohorts`).set('Origin', origin).send(config)).body;
    const data = { startupName: 'Canopy', founderName: 'T', email: 'founder@example.test', industry: 'X', location: 'Y', companyStage: 'Idea', consent: true, answers: Object.fromEntries(cohort.questions.map((q: { id: string; type: string }) => [q.id, q.type === 'url' ? 'https://example.com' : 'answer'])), qualifications: { commitment: true } };
    const draft = await request(app2).post(`/api/public/cascadia/${cohort.slug}/drafts`).set('Origin', origin).send(data);
    await request(app2).put('/api/public/application').set('Origin', origin).set('Authorization', `Bearer ${draft.body.token}`).send({ data, version: 1, submit: true });

    expect(queueDeadlineReminders(store, origin, 48)).toBe(1);
    expect(queueDeadlineReminders(store, origin, 48)).toBe(0); // deduplicated
  });
});