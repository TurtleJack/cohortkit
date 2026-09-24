import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Store } from '../server/db';
import { createApi } from '../server/api';
import { defaultCohort, type Workspace, type Application } from '../shared/domain';
import { type EmailAdapter, type EmailMessage } from '../server/email';
import { OpenAiProvider } from '../server/ai';

class SilentAdapter implements EmailAdapter {
  name = 'silent';
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) { this.sent.push(message); }
}
const email = new SilentAdapter();

type PublicCohort = { organization: { name: string; slug: string }; cohort: { id: string; name: string; slug: string; questions: { id: string; label: string; type: string }[]; qualifications: { id: string }[] }; accepting: boolean };

const origin = 'http://localhost:3100';
let app: Express;
let store: Store;
let orgId = ''; let cohortId = ''; let appId = ''; let applicantToken = '';

function agent() { return request.agent(app); }

beforeAll(() => {
  store = new Store(':memory:');
  app = createApi(store, { origin, demo: false, secure: false, email, aiProvider: new OpenAiProvider('') });
});

const config = () => ({ ...defaultCohort(), name: 'Test Cohort', status: 'open' as const });

describe('health and auth', () => {
  it('reports health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ ok: true, demo: false });
  });
  it('requires sign-in for workspace routes', async () => {
    const res = await request(app).get('/api/orgs/anything/workspace');
    expect(res.status).toBe(401);
  });
  it('registers a workspace and opens a session', async () => {
    const a = agent();
    const res = await a.post('/api/auth/register').set('Origin', origin).send({ name: 'Alex Morgan', email: 'alex@example.test', password: 'correct-horse-battery', organizationName: 'Cascadia Ventures', slug: 'cascadia' });
    expect(res.status).toBe(201);
    const session = await a.get('/api/session');
    expect(session.body.user.email).toBe('alex@example.test');
    expect(session.body.organizations).toHaveLength(1);
    expect(session.body.organizations[0].role).toBe('owner');
  });
  it('rejects weak passwords and duplicate slugs', async () => {
    const weak = await agent().post('/api/auth/register').set('Origin', origin).send({ name: 'B', email: 'b@example.test', password: 'short', organizationName: 'B Org', slug: 'borg' });
    expect(weak.status).toBe(400);
    const dup = await agent().post('/api/auth/register').set('Origin', origin).send({ name: 'B Name', email: 'b@example.test', password: 'correct-horse-battery', organizationName: 'B Org', slug: 'cascadia' });
    expect(dup.status).toBe(409);
  });
});

describe('intake, preparation, review, and decision', () => {
  let admin: ReturnType<typeof agent>;
  let cohortSlug = '';

  it('creates a cohort', async () => {
    admin = agent();
    await admin.post('/api/auth/login').set('Origin', origin).send({ email: 'alex@example.test', password: 'correct-horse-battery' });
    const session = await admin.get('/api/session');
    orgId = session.body.organizations[0].id;
    const res = await admin.post(`/api/orgs/${orgId}/cohorts`).set('Origin', origin).send(config());
    expect(res.status).toBe(201);
    cohortId = res.body.id;
    cohortSlug = res.body.slug;
  });

  it('serves the public cohort and accepts a submitted application', async () => {
    const pub = await request(app).get(`/api/public/cascadia/${cohortSlug}`);
    expect(pub.status).toBe(200);
    const info = pub.body as PublicCohort;
    expect(info.accepting).toBe(true);
    expect(info.cohort.questions.length).toBeGreaterThan(0);

    const data = {
      startupName: 'Canopy', founderName: 'Taylor Brooks', email: 'founder@example.test', industry: 'Climate tech', location: 'Portland, OR', companyStage: 'MVP', consent: true,
      answers: Object.fromEntries(info.cohort.questions.map(q => [q.id, q.type === 'url' ? 'https://example.com' : 'A thoughtful answer to ' + q.label])),
      qualifications: Object.fromEntries(info.cohort.qualifications.map(q => [q.id, true])),
    };
    const draft = await request(app).post(`/api/public/cascadia/${cohortSlug}/drafts`).set('Origin', origin).send(data);
    expect(draft.status).toBe(201);
    applicantToken = draft.body.token;
    const submit = await request(app).put('/api/public/application').set('Origin', origin).set('Authorization', `Bearer ${applicantToken}`).send({ data, version: 1, submit: true });
    expect(submit.status).toBe(200);
    expect(submit.body.version).toBe(2);
    appId = draft.body.id;
  });

  it('blocks duplicate applications for the same email', async () => {
    const res = await request(app).post(`/api/public/cascadia/${cohortSlug}/drafts`).set('Origin', origin).send({ startupName: 'Again', founderName: 'T', email: 'founder@example.test', industry: 'X', location: 'Y', companyStage: 'Idea', consent: true, answers: {}, qualifications: {} });
    expect(res.status).toBe(409);
  });

  it('scrubs, generates, and approves a brief', async () => {
    const workspace = await admin.get(`/api/orgs/${orgId}/workspace`);
    const w = workspace.body as Workspace;
    const application = (await admin.get(`/api/orgs/${orgId}/cohorts/${cohortId}/applications`)).body[0] as Application;
    expect(w.usage.applications).toBe(1);
    expect(application.version).toBe(2);

    const scrub = await admin.post(`/api/orgs/${orgId}/applications/${appId}/scrub`).set('Origin', origin).send({ notes: 'Complete and eligible', version: application.version });
    expect(scrub.status).toBe(200);

    const brief = await admin.post(`/api/orgs/${orgId}/applications/${appId}/brief`).set('Origin', origin).send({ source: 'local' });
    expect(brief.status).toBe(200);
    const withBrief = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body as Application;
    expect(withBrief.brief?.source).toBe('local');
    expect(withBrief.brief?.evidence.length).toBeGreaterThan(0);
    const approve = await admin.post(`/api/orgs/${orgId}/applications/${appId}/brief/approve`).set('Origin', origin).send({ version: withBrief.version });
    expect(approve.status).toBe(200);
  });

  it('onboards a reviewer by invitation and balances assignments', async () => {
    const invite = await admin.post(`/api/orgs/${orgId}/invitations`).set('Origin', origin).send({ name: 'Jordan Lee', email: 'jordan@example.test', role: 'reviewer' });
    expect(invite.status).toBe(201);
    const inviteToken = invite.body.url.split('/').pop();

    const reviewer = agent();
    const accept = await reviewer.post(`/api/invitations/${inviteToken}/accept`).set('Origin', origin).send({ name: 'Jordan Lee', password: 'correct-horse-battery' });
    expect(accept.status).toBe(200);
    expect(accept.body.orgId).toBe(orgId);

    const workspace = await admin.get(`/api/orgs/${orgId}/workspace`);
    const reviewerId = (workspace.body as Workspace).members.find(m => m.role === 'reviewer')!.id;
    const assign = await admin.post(`/api/orgs/${orgId}/cohorts/${cohortId}/assignments`).set('Origin', origin).send({ reviewerIds: [reviewerId], perApplication: 1 });
    expect(assign.status).toBe(200);
    expect(assign.body.added).toBe(1);

    const queue = await reviewer.get(`/api/orgs/${orgId}/cohorts/${cohortId}/applications`);
    expect(queue.status).toBe(200);
    expect(queue.body).toHaveLength(1);
    const scoped = queue.body[0] as Application;
    expect(scoped.email).toBe(''); // reviewer view hides applicant contact details
    expect(scoped.assignedReviewerIds).toEqual([reviewerId]);
  });

  it('enforces complete scoring and saves an atomic review', async () => {
    const reviewer = agent();
    await reviewer.post('/api/auth/login').set('Origin', origin).send({ email: 'jordan@example.test', password: 'correct-horse-battery' });
    const queue = await reviewer.get(`/api/orgs/${orgId}/cohorts/${cohortId}/applications`);
    const scoped = queue.body[0] as Application;

    const incomplete = await reviewer.put(`/api/orgs/${orgId}/applications/${appId}/review`).set('Origin', origin).send({ stageId: scoped.stageId, version: 0, scores: { team: 4 }, recommendation: 'advance', champion: false, notes: '' });
    expect(incomplete.status).toBe(400);

    const rubric = (await admin.get(`/api/orgs/${orgId}/workspace`)).body.cohorts[0].rubric as { id: string }[];
    const full = Object.fromEntries(rubric.map(c => [c.id, 4]));
    const save = await reviewer.put(`/api/orgs/${orgId}/applications/${appId}/review`).set('Origin', origin).send({ stageId: scoped.stageId, version: 0, scores: full, recommendation: 'advance', champion: true, notes: 'Strong team.' });
    expect(save.status).toBe(200);

    const stale = await reviewer.put(`/api/orgs/${orgId}/applications/${appId}/review`).set('Origin', origin).send({ stageId: scoped.stageId, version: 0, scores: full, recommendation: 'waitlist', champion: false, notes: 'Changed mind' });
    expect(stale.status).toBe(409);
  });

  it('moves stages with coverage rules and records a final decision', async () => {
    const before = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body as Application;
    const short = await admin.post(`/api/orgs/${orgId}/applications/${appId}/stage`).set('Origin', origin).send({ stageId: 'contenders', version: before.version, reason: 'Coverage incomplete', override: false });
    expect(short.status).toBe(409);
    const moved = await admin.post(`/api/orgs/${orgId}/applications/${appId}/stage`).set('Origin', origin).send({ stageId: 'contenders', version: before.version, reason: 'Fast-track by committee chair', override: true });
    expect(moved.status).toBe(200);

    const interview = await admin.post(`/api/orgs/${orgId}/applications/${appId}/interview`).set('Origin', origin).send({ status: 'scheduled', scheduledAt: new Date(Date.now() + 86400000).toISOString(), notes: 'Explore validation', version: before.version + 1 });
    expect(interview.status).toBe(200);

    const current = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body as Application;
    const decide = await admin.post(`/api/orgs/${orgId}/applications/${appId}/decision`).set('Origin', origin).send({ outcome: 'accepted', notes: 'Selected by the committee.', version: current.version, override: true });
    expect(decide.status).toBe(200);
    const done = (await admin.get(`/api/orgs/${orgId}/applications/${appId}`)).body as Application;
    expect(done.outcome).toBe('accepted');

    const exportCsv = await admin.get(`/api/orgs/${orgId}/cohorts/${cohortId}/export`);
    expect(exportCsv.status).toBe(200);
    expect(exportCsv.text).toContain('Canopy');
    expect(exportCsv.text).toContain('accepted');
  });
});

describe('isolation and permissions', () => {
  it('keeps workspaces separate', async () => {
    const outsider = agent();
    await outsider.post('/api/auth/register').set('Origin', origin).send({ name: 'Casey Chen', email: 'casey@example.test', password: 'correct-horse-battery', organizationName: 'Other Org', slug: 'other' });
    const res = await outsider.get('/api/orgs/anything/workspace');
    expect(res.status).toBe(404);
  });
  it('denies committee actions to reviewers', async () => {
    const reviewer = agent();
    await reviewer.post('/api/auth/login').set('Origin', origin).send({ email: 'jordan@example.test', password: 'correct-horse-battery' });
    const session = await reviewer.get('/api/session');
    const reviewerOrgId = session.body.organizations[0].id;
    const decide = await reviewer.post(`/api/orgs/${reviewerOrgId}/applications/${appId}/decision`).set('Origin', origin).send({ outcome: 'rejected', notes: 'Nope.', version: 1, override: false });
    expect(decide.status).toBe(403);
  });
});