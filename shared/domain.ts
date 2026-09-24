import { z } from 'zod';

export const roles = ['owner', 'admin', 'committee', 'reviewer'] as const;
export type Role = typeof roles[number];
export const pools = ['unassigned', 'contenders', 'shortlist', 'fringe', 'likely_decline'] as const;
export const outcomes = ['accepted', 'waitlist', 'rejected'] as const;
export type Outcome = typeof outcomes[number];
export type Recommendation = 'advance' | 'waitlist' | 'reject';
export const plans = {
  starter: { name: 'Starter', applications: 250, reviewers: 10, cohorts: 2, description: 'For your next great cohort' },
  growth: { name: 'Growth', applications: 2500, reviewers: 50, cohorts: 20, description: 'For programs building momentum' },
} as const;
export type Plan = keyof typeof plans;
export const modules = ['intake', 'review', 'ai'] as const;
export type Module = typeof modules[number];
export interface Criterion { id: string; label: string; description: string; weight: number }
export interface Question { id: string; label: string; type: 'text' | 'textarea' | 'url' | 'select'; required: boolean; options: string[] }
export interface Qualification { id: string; label: string; required: boolean }
export interface Stage { id: string; label: string; minReviews: number }
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const text = (max = 200) => z.string().trim().min(1).max(max);
export const criterionSchema = z.object({ id: identifier, label: text(80), description: z.string().trim().max(500), weight: z.number().min(0.1).max(100) });
export const questionSchema = z.object({ id: identifier, label: text(200), type: z.enum(['text','textarea','url','select']), required: z.boolean(), options: z.array(text(100)).max(30) }).refine(q => q.type !== 'select' || q.options.length > 0, 'Select questions need options');
export const qualificationSchema = z.object({ id: identifier, label: text(300), required: z.boolean() });
export const stageSchema = z.object({ id: identifier, label: text(60), minReviews: z.number().int().min(0).max(10) });
const unique = <T extends { id: string }>(items: T[]) => new Set(items.map(x => x.id)).size === items.length;
export const cohortSchema = z.object({
  name: text(120), description: text(3000), deadline: z.iso.datetime(), capacity: z.number().int().min(1).max(1000),
  status: z.enum(['draft','open','closed']), rubric: z.array(criterionSchema).min(1).max(12).refine(unique, 'Rubric IDs must be unique'),
  questions: z.array(questionSchema).min(1).max(40).refine(unique, 'Question IDs must be unique'),
  qualifications: z.array(qualificationSchema).max(20).refine(unique, 'Qualification IDs must be unique'),
  stages: z.array(stageSchema).min(2).max(8).refine(unique, 'Stage IDs must be unique'),
  championLimit: z.number().int().min(1).max(20), reviewMode: z.enum(['assigned','pool']), blindReview: z.boolean(),
});
export type CohortConfig = z.infer<typeof cohortSchema>;
export interface Cohort extends CohortConfig { id: string; orgId: string; slug: string; version: number; createdAt: string; applicationCount?: number }
export interface Organization { id: string; name: string; slug: string; plan: Plan; subscriptionStatus: 'trialing'|'active'|'past_due'|'canceled'; trialEndsAt: string; modules: Module[]; role: Role; stripeCustomerId?: string; createdAt: string }
export interface User { id: string; email: string; name: string; platformAdmin: boolean }
export interface Brief { source: 'local'|'openai'; summary: string; strengths: string[]; concerns: string[]; questions: string[]; evidence: { field: string; quote: string }[]; generatedAt: string; model: string; approvedAt: string|null; approvedBy: string|null }
export interface Review { id: string; appId: string; reviewerId: string; reviewerName: string; stageId: string; scores: Record<string,number>; recommendation: Recommendation; champion: boolean; notes: string; overall: number; version: number; createdAt: string }
export interface ApplicantData { startupName: string; founderName: string; email: string; industry: string; location: string; companyStage: string; answers: Record<string,string>; qualifications: Record<string,boolean>; consent: boolean }
export const applicantSchema = z.object({ startupName: text(150), founderName: text(120), email: z.email().max(250).transform(s => s.toLowerCase()), industry: text(100), location: text(120), companyStage: z.enum(['Idea','Prototype','MVP','Revenue','Growth']), answers: z.record(identifier,z.string().trim().max(10000)), qualifications: z.record(identifier,z.boolean()), consent: z.literal(true) });
export interface Application extends ApplicantData {
  id: string; orgId: string; cohortId: string; stageId: string; status: 'draft'|'submitted'; pool: typeof pools[number];
  scrubbedAt: string|null; scrubNotes: string; brief: Brief|null; outcome: Outcome|null; decisionNotes: string;
  interview: { status: 'none'|'ready'|'invited'|'scheduled'|'completed'|'no_show'|'canceled'; scheduledAt: string; notes: string };
  createdAt: string; submittedAt: string|null; version: number; reviews: Review[]; assignedReviewerIds: string[]; recusedReviewerIds: string[];
}
export interface Member { id: string; name: string; email: string; role: Role; assignments: number; completed: number }
export interface Invitation { id: string; email: string; name: string; role: Role|'founder'; cohortId: string|null; expiresAt: string; acceptedAt: string|null; createdAt: string }
export interface Audit { id: string; actor: string; action: string; targetId: string; detail: string; createdAt: string }
export interface Workspace { organization: Organization; cohorts: Cohort[]; members: Member[]; invitations: Invitation[]; audits: Audit[]; usage: { applications: number; reviewers: number; cohorts: number }; integrations: { ai: boolean; billing: boolean }; }

export const defaultRubric: Criterion[] = [
  { id: 'team', label: 'Team', description: 'Experience, commitment and complementary skills', weight: 25 },
  { id: 'market', label: 'Market opportunity', description: 'Problem clarity, market size and timing', weight: 20 },
  { id: 'product', label: 'Product & innovation', description: 'Differentiation, defensibility and technical approach', weight: 25 },
  { id: 'traction', label: 'Traction', description: 'Customer evidence, validation and progress', weight: 20 },
  { id: 'fit', label: 'Program fit', description: 'Alignment with program goals and ability to benefit', weight: 10 },
];
export const defaultQuestions: Question[] = [
  { id: 'oneliner', label: 'Describe your startup in one sentence', type: 'text', required: true, options: [] },
  { id: 'problem', label: 'What problem are you solving, and for whom?', type: 'textarea', required: true, options: [] },
  { id: 'product', label: 'Tell us about your solution and what makes it different', type: 'textarea', required: true, options: [] },
  { id: 'team', label: 'Why is your team the right team to build this?', type: 'textarea', required: true, options: [] },
  { id: 'traction', label: 'What traction or customer validation do you have?', type: 'textarea', required: true, options: [] },
  { id: 'fit', label: 'What would you like to achieve in this program?', type: 'textarea', required: true, options: [] },
  { id: 'website', label: 'Company website', type: 'url', required: false, options: [] },
  { id: 'deck', label: 'Pitch deck link (accessible to reviewers)', type: 'url', required: false, options: [] },
];
export const defaultStages: Stage[] = [
  { id: 'screening', label: 'Screening', minReviews: 2 }, { id: 'contenders', label: 'Contenders', minReviews: 2 },
  { id: 'shortlist', label: 'Shortlist', minReviews: 1 }, { id: 'interviews', label: 'Interviews', minReviews: 1 },
  { id: 'selection', label: 'Final selection', minReviews: 0 },
];
export function defaultCohort(): CohortConfig { return { name: '', description: 'A focused program for ambitious founders. Build alongside a community of operators, mentors and fellow entrepreneurs.', deadline: new Date(Date.now()+45*86400000).toISOString(), capacity: 20, status: 'draft', rubric: structuredClone(defaultRubric), questions: structuredClone(defaultQuestions), qualifications: [{ id: 'commitment', label: 'At least one founder can actively participate for the full program.', required: true }], stages: structuredClone(defaultStages), championLimit: 3, reviewMode: 'assigned', blindReview: false }; }
export function weightedScore(scores: Record<string,number>, rubric: Criterion[]): number { const total = rubric.reduce((s,c) => s+c.weight,0); return Math.round(rubric.reduce((s,c)=>s+(scores[c.id]||0)*c.weight,0)/total*100)/100; }
export function currentReviews(app: Application) { return app.reviews.filter(r => r.stageId === app.stageId); }
export function averageScore(reviews: Review[]) { return reviews.length ? reviews.reduce((s,r)=>s+r.overall,0)/reviews.length : 0; }
export function canManage(role: Role) { return role === 'owner' || role === 'admin'; }
export function canDecide(role: Role) { return canManage(role) || role === 'committee'; }
export function label(value: string) { return value.replace(/_/g,' ').replace(/^./,x=>x.toUpperCase()); }
export function submissionIssues(data: ApplicantData, cohort: CohortConfig): string[] {
  const issues: string[] = [];
  for (const q of cohort.questions) {
    const value = data.answers[q.id]?.trim();
    if (q.required && !value) issues.push(`${q.label} is required`);
    if (value && q.type === 'url') { try { const u = new URL(value); if (!['https:','http:'].includes(u.protocol)) throw new Error(); } catch { issues.push(`${q.label} must be an HTTP or HTTPS URL`); } }
    if (value && q.type === 'select' && !q.options.includes(value)) issues.push(`${q.label} has an invalid option`);
  }
  for (const q of cohort.qualifications) if (q.required && data.qualifications[q.id] !== true) issues.push(`Qualification not confirmed: ${q.label}`);
  return issues;
}
