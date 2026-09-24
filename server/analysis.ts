import type { Application, Brief, Cohort } from '../shared/domain';
import { now } from './db';

// Extractive source brief: quotes only. Works with no AI provider.
export function localBrief(app: Application, cohort: Cohort): Brief {
  const evidence = cohort.questions.filter(q => app.answers[q.id]).slice(0, 6).map(q => ({ field: q.id, quote: app.answers[q.id].slice(0, 800) }));
  return { source: 'local', summary: app.answers.oneliner || `${app.startupName} is a ${app.companyStage.toLowerCase()} startup in ${app.industry}.`, strengths: app.answers.traction ? [`Founder-reported traction: ${app.answers.traction.slice(0, 400)}`] : [], concerns: ['Founder statements have not been independently verified.'], questions: ['Which customer claims can the team substantiate?', 'What milestones are achievable during the program?'], evidence, generatedAt: now(), model: 'Extractive source brief', approvedAt: null, approvedBy: null };
}