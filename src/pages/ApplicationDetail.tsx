import { useEffect, useState } from 'react';
import { FileText, Sparkles, Star, CheckCircle2, Clock, ArrowRight, RotateCcw, Users } from 'lucide-react';
import { useWorkspace } from '../App';
import { Badge, Button, Field, CheckField, Modal, Empty, date } from '../ui';
import { canManage, canDecide, averageScore, label, pools, outcomes, type Application, type Outcome } from '../../shared/domain';
import { api } from '../api';

export function ApplicationDetail({ application: app, onClose }: { application: Application; onClose: () => void }) {
  const { workspace, cohort, base, act, busy } = useWorkspace();
  const manage = canManage(workspace.organization.role);
  const decide = canDecide(workspace.organization.role);
  const [tab, setTab] = useState<'application' | 'preparation' | 'reviews' | 'decision'>('application');
  const [scrubNotes, setScrubNotes] = useState(app.scrubNotes);
  const reviews = app.reviews.filter(r => r.stageId === app.stageId);
  const tabs: ['application' | 'preparation' | 'reviews' | 'decision', string][] = [['application', 'Application'], ['preparation', 'Preparation'], ['reviews', `Reviews (${reviews.length})`], ['decision', 'Decision']];
  return <Modal wide title={app.startupName} subtitle={app.answers.oneliner || app.industry} onClose={onClose}>
    <div className="detail-summary">
      <Badge value={app.status} /><Badge value={app.stageId} /><Badge value={app.pool} />
      {app.outcome && <Badge value={app.outcome} />}
      {app.reviews.some(r => r.champion) && <Badge value="champion" />}
      <span><Clock size={13} /> {app.submittedAt ? `Submitted ${date(app.submittedAt)}` : 'Not submitted'}</span>
      {reviews.length > 0 && <span><Star size={13} /> {averageScore(reviews).toFixed(2)} avg</span>}
    </div>
    <div className="detail-tabs">{tabs.filter(([id]) => id !== 'preparation' || manage).filter(([id]) => id !== 'reviews' || decide).filter(([id]) => id !== 'decision' || decide).map(([id, name]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{name}</button>)}</div>
    {tab === 'application' && <ApplicationTab app={app} />}
    {tab === 'preparation' && manage && <PreparationTab app={app} scrubNotes={scrubNotes} setScrubNotes={setScrubNotes} base={base} act={act} busy={busy} />}
    {tab === 'reviews' && decide && <ReviewsTab app={app} />}
    {tab === 'decision' && decide && <DecisionTab app={app} base={base} act={act} busy={busy} manage={manage} />}
  </Modal>;
}

function ApplicationTab({ app }: { app: Application }) {
  const { cohort, base } = useWorkspace();
  const [access, setAccess] = useState<{ count: number; lastAt: string | null } | null>(null);
  useEffect(() => { void api<{ count: number; lastAt: string | null }>(`${base}/applications/${app.id}/access`).then(setAccess).catch(() => {}); }, [base, app.id]);
  return <div>
    <section className="application-intro"><div className="startup-heading"><FileText size={22} /><div><h3>{app.startupName}</h3><p>{app.founderName} · {app.email || 'Email hidden'} · {app.location}</p><div className="intro-meta"><span className="industry-pill">{app.industry}</span><Badge value={label(app.companyStage)} /></div>{access && access.count > 0 && <small className="muted">Status link viewed {access.count} time{access.count !== 1 ? 's' : ''}{access.lastAt ? ` · last ${date(access.lastAt)}` : ''}</small>}</div></div></section>
    <div className="source-answers">{cohort!.questions.filter(q => app.answers[q.id]).map(q => <article key={q.id}><strong>{q.label}</strong><p>{app.answers[q.id]}</p></article>)}</div>
    {cohort!.qualifications.length > 0 && <section className="qualification-check">{cohort!.qualifications.map(q => <label className="check-field" key={q.id}><input type="checkbox" checked={!!app.qualifications[q.id]} readOnly /><span><strong>{q.label}</strong></span></label>)}</section>}
  </div>;
}

function PreparationTab({ app, scrubNotes, setScrubNotes, base, act, busy }: { app: Application; scrubNotes: string; setScrubNotes: (s: string) => void; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean }) {
  const { workspace } = useWorkspace();
  return <div className="preparation-grid">
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Eligibility check</h2><p>Confirm the application is complete and eligible before review.</p></div>{app.scrubbedAt && <Badge value="approved" />}</div>
      <div style={{ padding: '0 22px 22px' }}>
        <Field label="Scrub notes" hint="Record completeness and eligibility findings."><textarea value={scrubNotes} onChange={e => setScrubNotes(e.target.value)} /></Field>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}><Button busy={busy} disabled={app.status !== 'submitted' || !!app.outcome} onClick={() => void act(() => api(`${base}/applications/${app.id}/scrub`, { notes: scrubNotes, version: app.version }), 'Eligibility check saved')}>{app.scrubbedAt ? 'Update check' : 'Mark as prepared'} <CheckCircle2 size={15} /></Button></div>
      </div></section>
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Application brief</h2><p>An evidence-based summary for reviewers. AI drafts always require your approval.</p></div>{app.brief && (app.brief.approvedAt ? <Badge value="approved" /> : <Badge value="pending" />)}</div>
      <div style={{ padding: '0 22px 22px' }}>
        {!app.brief ? <>
          <div className="notice">Briefs are generated after the eligibility check. The extractive brief only quotes the source; an AI draft summarizes and flags gaps.</div>
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="secondary" disabled={!app.scrubbedAt || !!app.outcome} busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/brief`, { source: 'local' }), 'Brief generated')}>Generate extractive brief <FileText size={15} /></Button>
            <Button disabled={!app.scrubbedAt || !!app.outcome || !workspace.integrations.ai} busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/brief`, { source: 'openai' }), 'AI draft generated')}>Generate AI draft <Sparkles size={15} /></Button>
          </div>
          {!workspace.integrations.ai && <p className="help-text">Live AI is not configured on this instance. The extractive brief needs no provider.</p>}
        </> : <BriefCard app={app} base={base} act={act} busy={busy} />}
      </div></section>
  </div>;
}

function BriefCard({ app, base, act, busy }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean }) {
  const b = app.brief!;
  return <div className="brief-card">
    <div className="brief-summary"><div><Badge value={b.source} />{b.approvedAt && <Badge value="approved" />}</div><h3>{b.summary}</h3><small>{b.model} · generated {date(b.generatedAt)}</small></div>
    <div className="brief-columns">
      <div><h4>STRENGTHS</h4>{b.strengths.map((s, i) => <p key={i} className="signal">{s}</p>)}</div>
      <div><h4>CONCERNS</h4>{b.concerns.map((s, i) => <p key={i} className="consideration">{s}</p>)}</div>
    </div>
    {b.questions.length > 0 && <div><h4>QUESTIONS FOR THE FOUNDERS</h4>{b.questions.map((q, i) => <p key={i} className="consideration">{q}</p>)}</div>}
    {b.evidence.length > 0 && <div className="source-answers" style={{ marginTop: 14 }}>{b.evidence.map((e, i) => <article key={i}><strong>{label(e.field)}</strong><p>{e.quote}</p></article>)}</div>}
    {!b.approvedAt && <div className="form-actions"><Button busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/brief/approve`, { version: app.version }), 'Brief approved')}>Approve brief <CheckCircle2 size={15} /></Button></div>}
  </div>;
}

function ReviewsTab({ app }: { app: Application }) {
  const { cohort } = useWorkspace();
  const reviews = app.reviews.filter(r => r.stageId === app.stageId);
  if (!reviews.length) return <Empty title="No reviews yet" description="Reviews appear as soon as reviewers save their scores." />;
  return <div className="review-report">{reviews.map(r => <section className="panel" style={{ marginBottom: 18 }} key={r.id}>
    <div className="section-title"><div><h2>{r.reviewerName}</h2><p>Saved {date(r.createdAt)}</p></div><div className="inline"><Badge value={r.recommendation} />{r.champion && <Badge value="champion" />}</div></div>
    <div className="review-score-breakdown">{cohort!.rubric.map(c => <div className="rating-row" key={c.id}><div><strong>{c.label}</strong><small>weight {c.weight}</small></div><div className="stars" aria-label={`${c.label}: ${r.scores[c.id]} of 5`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} fill={r.scores[c.id] >= n ? 'currentColor' : 'none'} />)}</div></div>)}</div>
    <div className="weighted-total"><span>Overall</span><strong>{r.overall.toFixed(2)}</strong><small>weighted by rubric</small></div>
    {r.notes && <div className="source-answers" style={{ padding: '0 22px 22px' }}><article><strong>Reviewer notes</strong><p>{r.notes}</p></article></div>}
  </section>)}</div>;
}

function DecisionTab({ app, base, act, busy, manage }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean; manage: boolean }) {
  const { cohort } = useWorkspace();
  const stageIndex = cohort!.stages.findIndex(s => s.id === app.stageId);
  const last = stageIndex === cohort!.stages.length - 1;
  const [interview, setInterview] = useState(app.interview);
  return <div className="decision-grid">
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Stage</h2><p>Applications advance one stage at a time; skipping or short coverage needs an administrator override.</p></div></div>
      <div style={{ padding: '0 22px 22px' }}><StageControls app={app} base={base} act={act} busy={busy} manage={manage} /></div></section>
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Interview</h2><p>Track readiness, scheduling, and outcomes.</p></div><Badge value={interview.status} /></div>
      <div style={{ padding: '0 22px 22px' }}>
        <Field label="Status"><select value={interview.status} onChange={e => setInterview({ ...interview, status: e.target.value as Application['interview']['status'] })}>{['none', 'ready', 'invited', 'scheduled', 'completed', 'no_show', 'canceled'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
        {interview.status === 'scheduled' && <Field label="Date and time"><input type="datetime-local" value={interview.scheduledAt.slice(0, 16)} onChange={e => setInterview({ ...interview, scheduledAt: new Date(e.target.value).toISOString() })} /></Field>}
        <Field label="Notes"><textarea value={interview.notes} onChange={e => setInterview({ ...interview, notes: e.target.value })} /></Field>
        <div className="form-actions"><Button variant="secondary" busy={busy} disabled={!!app.outcome} onClick={() => void act(() => api(`${base}/applications/${app.id}/interview`, { ...interview, version: app.version }), 'Interview saved')}>Save interview</Button></div>
      </div></section>
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Pool</h2><p>Pools organize review beyond stages: contenders, shortlist, fringe, likely decline.</p></div><Badge value={app.pool} /></div>
      <div style={{ padding: '0 22px 22px' }}><PoolControls app={app} base={base} act={act} busy={busy} /></div></section>
    <section className="panel" style={{ margin: 0 }}><div className="section-title"><div><h2>Final decision</h2><p>Recorded at the final stage. Capacity is enforced; overrides need an administrator.</p></div></div>
      <div style={{ padding: '0 22px 22px' }}>{app.outcome ? <OutcomeRecorded app={app} base={base} act={act} busy={busy} manage={manage} /> : <DecisionForm app={app} base={base} act={act} busy={busy} manage={manage} last={last} />}</div></section>
  </div>;
}

function StageControls({ app, base, act, busy, manage }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean; manage: boolean }) {
  const { cohort } = useWorkspace();
  const current = cohort!.stages.findIndex(s => s.id === app.stageId);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  return <>
    <div className="button-row">
      {cohort!.stages.slice(current + 1).map((s, i) => <Button key={s.id} variant="secondary" busy={busy} disabled={!!app.outcome} onClick={() => setTo(s.id)}>{i === 0 ? `Advance to ${s.label}` : s.label} <ArrowRight size={14} /></Button>)}
      {current >= cohort!.stages.length - 1 && <p className="muted">This is the final stage.</p>}
    </div>
    {to && <>
      <Field label={`Reason for moving to ${cohort!.stages.find(s => s.id === to)!.label}`}><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {manage && <CheckField label="Administrator override (skip stages or bypass review coverage)" checked={override} onChange={setOverride} />}
      <div className="form-actions"><Button variant="secondary" onClick={() => setTo('')}>Cancel</Button><Button busy={busy} disabled={reason.trim().length < 3} onClick={() => void act(() => api(`${base}/applications/${app.id}/stage`, { stageId: to, reason, version: app.version, override: manage && override }), 'Stage updated').then(() => setTo(''))}>Move application <ArrowRight size={14} /></Button></div>
    </>}
  </>;
}

function PoolControls({ app, base, act, busy }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean }) {
  const [pool, setPool] = useState(app.pool);
  return <><Field label="Pool"><select value={pool} onChange={e => setPool(e.target.value as Application['pool'])}>{pools.map(p => <option key={p} value={p}>{label(p)}</option>)}</select></Field>
    <div className="form-actions"><Button variant="secondary" busy={busy} disabled={pool === app.pool || !!app.outcome} onClick={() => void act(() => api(`${base}/applications/${app.id}/pool`, { pool, version: app.version }), 'Pool updated')}>Save pool</Button></div></>;
}

function DecisionForm({ app, base, act, busy, manage, last }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean; manage: boolean; last: boolean }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);
  const ready = !!outcome && notes.trim().length >= 3;
  return <>
    <div className="recommendations">{(outcomes as readonly Outcome[]).map(o => <button key={o} className={`recommendation ${o} ${outcome === o ? 'selected' : ''}`} onClick={() => setOutcome(o)}>{label(o)}<small>{o === 'accepted' ? 'Offer a seat' : o === 'waitlist' ? 'Hold for now' : 'Decline'}</small></button>)}</div>
    <Field label="Decision notes" hint="Required. Recorded in the audit trail with your name."><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    {manage && <CheckField label="Administrator override (decision before the final stage)" checked={override} onChange={setOverride} />}
    <div className="form-actions"><Button busy={busy} disabled={!ready || !(last || manage && override)} onClick={() => void act(() => api(`${base}/applications/${app.id}/decision`, { outcome, notes, version: app.version, override: manage && override }), 'Decision recorded')}>Record decision <CheckCircle2 size={15} /></Button></div>
    {!last && !(manage && override) && <p className="help-text">Move the application to the final stage first, or use an administrator override.</p>}
  </>;
}

function OutcomeRecorded({ app, base, act, busy, manage }: { app: Application; base: string; act: ReturnType<typeof useWorkspace>['act']; busy: boolean; manage: boolean }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const declined = app.outcome === 'rejected' || app.outcome === 'waitlist';
  return <div className="final-decision">
    <div className="inline"><Badge value={app.outcome!} /><p>{app.decisionNotes}</p></div>
    {manage && !open && <button className="text-button" onClick={() => setOpen(true)}><RotateCcw size={14} /> Reopen decision</button>}
    {open && <><Field label="Reason for reopening"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="form-actions"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={() => void act(() => api(`${base}/applications/${app.id}/reopen`, { reason, version: app.version }), 'Decision reopened').then(() => setOpen(false))}>Reopen decision</Button></div></>}
    {manage && declined && <div className="summary-card" style={{ marginTop: 16 }}>
      {app.feedback ? <>
        <p>{app.feedback.text}</p>
        <div className="inline" style={{ marginTop: 12 }}>
          <Badge value={app.feedback.source} />
          {app.feedback.approvedAt ? <Badge value="approved" /> : <Button variant="secondary" busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/feedback/approve`, { version: app.version }), 'Feedback approved')}>Approve feedback</Button>}
          <Button variant="ghost" busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/feedback`, { version: app.version }), 'Feedback regenerated')}>Regenerate</Button>
        </div>
      </> : <>
        <p className="muted">Approved feedback is included when the decision email is sent. AI drafts are respectful and specific — always review before approving.</p>
        <Button busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/feedback`, { version: app.version }), 'Feedback drafted')}><Sparkles size={15} /> Draft feedback</Button>
      </>}
    </div>}
  </div>;
}