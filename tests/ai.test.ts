import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Store } from '../server/db';
import { createApi } from '../server/api';
import { OpenAiProvider, localProposal, localFeedback, localSummary } from '../server/ai';
import { defaultCohort, cohortSchema, type Application, type Workspace } from '../shared/domain';
import type { EmailAdapter as Adapter, EmailMessage } from '../server/email';

const silent: Adapter = { name: 'silent', send: async (_: EmailMessage) => {} };
const origin = 'http://localhost:3100';

describe('local AI proposals', () => {
  it('produces a valid config without any provider', () => {
    const proposal = localProposal('We run a 12-week climate tech accelerator for pre-seed founders building clean energy and AI solutions for sustainability.');
    const config = { ...defaultCohort(), ...proposal, name: proposal.name || 'Proposed' };
    expect(cohortSchema.safeParse(config).success).toBe(true);
    const labels = proposal.rubric.map(c => c.label).join(' ');
    expect(labels).toContain('Climate');
    expect(labels).toContain('AI');
    expect(proposal.rubric.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(proposal.faqs.length).toBeGreaterThan(0);
  });
  it('generates local feedback and summaries from application data', () => {
    const store = new Store(':memory:');
    void store;
    const app = { startupName: 'Canopy', reviews: [], brief: { concerns: ['Weak evidence of demand.'], summary: '', strengths: [], questions: [], evidence: [], source: 'local' as const, model: '', generatedAt: '', approvedAt: null, approvedBy: null }, outcome: 'rejected' as const, submittedAt: new Date().toISOString(), industry: 'Climate' } as unknown as Application;
    const feedback = localFeedback(app, 'rejected');
    expect(feedback.text).toContain('Weak evidence');
    expect(feedback.approvedAt).toBeNull();
    const cohort = { ...defaultCohort(), name: 'Test', capacity: 20 } as ReturnType<typeof defaultCohort> & { name: string };
    const summary = localSummary(cohort as never, [app]);
    expect(summary.text).toContain('Test');
  });
});

describe('AI endpoints through the API', () => {
  let app: Express;
  let store: Store;
  let orgId = ''; let cohortId = '';

  beforeAll(() => {
    store = new Store(':memory:');
    app = createApi(store, { origin, demo: false, secure: false, email: silent, aiProvider: new OpenAiProvider('') });
  });

  it('proposes a cohort config and applies it through the normal save path', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/register').set('Origin', origin).send({ name: 'Alex Morgan', email: 'alex@example.test', password: 'correct-horse-battery', organizationName: 'Cascadia Ventures', slug: 'cascadia' });
    orgId = (await admin.get('/api/session')).body.organizations[0].id;
    const proposal = await admin.post(`/api/orgs/${orgId}/cohorts/propose`).set('Origin', origin).send({ description: 'A climate tech accelerator for pre-seed founders building AI solutions for sustainability.' });
    expect(proposal.status).toBe(200);
    expect(proposal.body.source).toBe('local');
    expect(proposal.body.proposal.rubric.length).toBeGreaterThan(3);
    const create = await admin.post(`/api/orgs/${orgId}/cohorts`).set('Origin', origin).send(proposal.body.proposal);
    expect(create.status).toBe(201);
    cohortId = create.body.id;
  });

  it('drafts, approves, and attaches feedback to declined applications', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/login').set('Origin', origin).send({ email: 'alex@example.test', password: 'correct-horse-battery' });
    // Open the cohort, then apply through the public portal.
    const workspace = (await admin.get(`/api/orgs/${orgId}/workspace`)).body as Workspace;
    const cohort = workspace.cohorts[0];
    await admin.put(`/api/orgs/${orgId}/cohorts/${cohort.id}`).set('Origin', origin).send({ config: { ...cohort, status: 'open' }, version: cohort.version });
    const pub = await request(app).get(`/api/public/cascadia/${cohort.slug}`);
    const info = pub.body;
    const data = { startupName: 'Canopy', founderName: 'Taylor Brooks', email: 'founder@example.test', industry: 'Climate', location: 'Portland', companyStage: 'MVP', consent: true, answers: Object.fromEntries(info.cohort.questions.map((q: { id: string; type: string }) => [q.id, q.type === 'url' ? 'https://example.com' : 'answer'])), qualifications: Object.fromEntries(info.cohort.qualifications.map((q: { id: string }) => [q.id, true])) };
    const draft = await request(app).post(`/api/public/cascadia/${info.cohort.slug}/drafts`).set('Origin', origin).send(data);
    await request(app).put('/api/public/application').set('Origin', origin).set('Authorization', `Bearer ${draft.body.token}`).send({ data, version: 1, submit: true });
    let current = (await admin.get(`/api/orgs/${orgId}/applications/${draft.body.id}`)).body as Application;
    await admin.post(`/api/orgs/${orgId}/applications/${draft.body.id}/decision`).set('Origin', origin).send({ outcome: 'rejected', notes: 'Not the right fit this round.', version: current.version, override: true });
    current = (await admin.get(`/api/orgs/${orgId}/applications/${draft.body.id}`)).body as Application;

    const feedback = await admin.post(`/api/orgs/${orgId}/applications/${draft.body.id}/feedback`).set('Origin', origin).send({ version: current.version });
    expect(feedback.status).toBe(200);
    const withDraft = (await admin.get(`/api/orgs/${orgId}/applications/${draft.body.id}`)).body as Application;
    expect(withDraft.feedback?.source).toBe('local');
    expect(withDraft.feedback?.approvedAt).toBeNull();
    const approve = await admin.post(`/api/orgs/${orgId}/applications/${draft.body.id}/feedback/approve`).set('Origin', origin).send({ version: withDraft.version });
    expect(approve.status).toBe(200);
    const approved = (await admin.get(`/api/orgs/${orgId}/applications/${draft.body.id}`)).body as Application;
    expect(approved.feedback?.approvedAt).not.toBeNull();
  });

  it('generates and approves a cohort summary', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/login').set('Origin', origin).send({ email: 'alex@example.test', password: 'correct-horse-battery' });
    const summary = await admin.post(`/api/orgs/${orgId}/cohorts/${cohortId}/summary`).set('Origin', origin).send({});
    expect(summary.status).toBe(200);
    const workspace = (await admin.get(`/api/orgs/${orgId}/workspace`)).body as Workspace;
    const cohort = workspace.cohorts.find(c => c.id === cohortId)!;
    expect(cohort.summary?.source).toBe('local');
    expect(cohort.summary?.approvedAt).toBeNull();
    const approve = await admin.post(`/api/orgs/${orgId}/cohorts/${cohortId}/summary/approve`).set('Origin', origin).send({});
    expect(approve.status).toBe(200);
  });
});