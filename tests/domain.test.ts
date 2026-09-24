import { describe, it, expect } from 'vitest';
import { cohortSchema, defaultCohort, submissionIssues, weightedScore, applicantSchema, type ApplicantData } from '../shared/domain';

describe('cohort config validation', () => {
  const valid = () => ({ ...defaultCohort(), name: 'Test Cohort' });
  it('accepts a completed default cohort', () => {
    expect(cohortSchema.safeParse(valid()).success).toBe(true);
  });
  it('rejects duplicate rubric ids', () => {
    const config = valid();
    config.rubric[1] = { ...config.rubric[0] };
    expect(cohortSchema.safeParse(config).success).toBe(false);
  });
  it('rejects select questions without options', () => {
    const config = valid();
    config.questions.push({ id: 'empty_select', label: 'Pick one', type: 'select', required: false, options: [] });
    expect(cohortSchema.safeParse(config).success).toBe(false);
  });
  it('rejects invalid identifiers', () => {
    const config = valid();
    config.questions.push({ id: '9bad', label: 'Bad id', type: 'text', required: false, options: [] });
    expect(cohortSchema.safeParse(config).success).toBe(false);
  });
  it('caps rubric and question counts', () => {
    const config = valid();
    for (let i = 0; i < 13; i++) config.rubric.push({ id: `c${i}`, label: `C ${i}`, description: '', weight: 1 });
    expect(cohortSchema.safeParse(config).success).toBe(false);
  });
});

describe('weighted scoring', () => {
  const rubric = defaultCohort().rubric;
  it('computes a weighted score out of 5', () => {
    const all = Object.fromEntries(rubric.map(c => [c.id, 5]));
    expect(weightedScore(all, rubric)).toBe(5);
    const mixed = Object.fromEntries(rubric.map(c => [c.id, 3]));
    expect(weightedScore(mixed, rubric)).toBe(3);
  });
});

describe('submission validation', () => {
  const cohort = defaultCohort();
  const base: ApplicantData = {
    startupName: 'Canopy', founderName: 'Taylor', email: 't@example.test', industry: 'Climate', location: 'Portland', companyStage: 'MVP', consent: true,
    answers: Object.fromEntries(cohort.questions.map(q => [q.id, q.type === 'url' ? 'https://example.com' : 'answer'])),
    qualifications: { commitment: true },
  };
  it('passes a complete application', () => {
    expect(submissionIssues(base, cohort)).toEqual([]);
  });
  it('flags missing required answers and qualifications', () => {
    const missing = { ...base, answers: {}, qualifications: {} };
    const issues = submissionIssues(missing, cohort);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toContain('required');
  });
  it('rejects non-HTTP URLs', () => {
    const bad = { ...base, answers: { ...base.answers, website: 'javascript:alert(1)' } };
    expect(submissionIssues(bad, cohort).join(' ')).toContain('URL');
  });
  it('requires consent in the schema', () => {
    expect(applicantSchema.safeParse({ ...base, consent: false }).success).toBe(false);
  });
});