import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ClipboardCheck, Star, ArrowRight, CheckCircle2, Flag, Sparkles } from 'lucide-react';
import { useWorkspace, useSession } from '../App';
import { Avatar, Badge, Button, Empty, PageHeading, SectionTitle, Field, Modal, ErrorMessage } from '../ui';
import { weightedScore, label, type Application, type Recommendation } from '../../shared/domain';
import { api } from '../api';

export function ReviewerPage() {
  const { workspace, applications, cohort } = useWorkspace();
  const { user } = useSession();
  const [order, setOrder] = useState<string[] | null>(null);
  if (!cohort) return <Empty title="Nothing to review yet" description="Your review queue appears when a cohort opens for review." />;
  const mine = (a: Application) => a.reviews.find(r => r.reviewerId === user!.id);
  const queue = applications.filter(a => a.status === 'submitted' && a.scrubbedAt && !a.outcome && !a.recusedReviewerIds.includes(user!.id));
  const pending = queue.filter(a => !mine(a));
  const done = queue.filter(a => mine(a));
  const champions = queue.filter(a => mine(a)?.champion).length;
  const currentId = order?.length ? order[0] : null;
  const current = currentId ? applications.find(a => a.id === currentId) || null : null;
  return <>
    <PageHeading eyebrow={`${cohort.name}`} title="Your review workspace" description="Rate what matters, keep your judgment your own, and let the evidence speak." />
    <section className="review-welcome"><div>
      <div className="clipboard-art" aria-hidden="true"><span><Star size={11} /></span><i /><span><Star size={11} /></span><i /><span><Star size={11} /></span><i /></div>
      <h2>Great review is a conversation with the evidence.</h2>
      <p>Every application is reviewed on the same weighted rubric. Your scores, your recommendation, and your notes stay with you until the committee compares them.</p>
      <div className="review-welcome-stats"><span><b>{pending.length}</b> awaiting your review</span><span><b>{done.length}</b> completed</span><span><b>{champions}</b> championed</span></div>
    </div><div className="session-start"><Field label="Review session">{order ? <p className="muted">Reviewing {order.length} application{order.length !== 1 ? 's' : ''} in sequence.</p> : <Button className="full" onClick={() => setOrder(pending.map(a => a.id))} disabled={!pending.length}>Start review session <ArrowRight size={16} /></Button>}{order && <button className="text-button" onClick={() => setOrder(null)}>Leave session</button>}</Field></div></section>
    {current && order ? <ReviewForm key={current.id} application={current} position={done.length + 1} total={done.length + order.length} onDone={() => { const next = order.slice(1); setOrder(next.length ? next : null); }} /> :
      <><section className="panel"><SectionTitle title="Awaiting your review" description={`${pending.length} application${pending.length !== 1 ? 's' : ''} in your queue`} />
        <div className="queue-list">{pending.length ? pending.map((a, i) => <button className="queue-row" key={a.id} onClick={() => setOrder(pending.map(x => x.id).slice(i))}><span className="queue-number">{String(i + 1).padStart(2, '0')}</span><Avatar name={a.startupName} index={i + 1} /><div><strong>{a.startupName}</strong><p>{a.answers.oneliner}</p></div><span className="industry-pill">{a.industry}</span><Badge value={a.stageId} /></button>) : <Empty title="All caught up" description="No applications are waiting for your review right now." />}</div></section>
        <section className="panel"><SectionTitle title="Your completed reviews" description={`${done.length} application${done.length !== 1 ? 's' : ''} you have scored`} />
          <div className="queue-list">{done.length ? done.map((a, i) => <Link className="queue-row" key={a.id} to="../review" onClick={() => setOrder([a.id])}><span className="queue-number">{String(i + 1).padStart(2, '0')}</span><Avatar name={a.startupName} index={i} /><div><strong>{a.startupName}</strong><p>{a.answers.oneliner}</p></div><span className="score"><Star size={13} fill="currentColor" />{mine(a)!.overall.toFixed(1)}</span><Badge value={mine(a)!.recommendation} />{mine(a)!.champion && <span className="champion-star"><Star size={15} fill="currentColor" /></span>}</Link>) : <Empty title="No reviews yet" description="Your first review is one click away." />}</div></section></>}
  </>;
}

function ReviewForm({ application: app, position, total, onDone }: { application: Application; position: number; total: number; onDone: () => void }) {
  const { user } = useSession();
  const { cohort, base, act, busy } = useWorkspace();
  const mine = app.reviews.find(r => r.reviewerId === user!.id);
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores || {});
  const [recommendation, setRecommendation] = useState<Recommendation>(mine?.recommendation || 'advance');
  const [champion, setChampion] = useState(mine?.champion || false);
  const [notes, setNotes] = useState(mine?.notes || '');
  const [recusing, setRecusing] = useState(false);
  const [reason, setReason] = useState('');
  const rubric = cohort!.rubric;
  const complete = rubric.every(c => scores[c.id]);
  const overall = complete ? weightedScore(scores, rubric) : null;
  const mineChampions = app.reviews.length + (cohort!.championLimit ? 0 : 0); // server enforces the cohort limit
  const save = (next: boolean) => act(async () => api(`${base}/applications/${app.id}/review`, { stageId: app.stageId, version: mine?.version || 0, scores, recommendation, champion, notes }, 'PUT'), next ? undefined : 'Review saved').then(r => { if (r && next) onDone(); });
  return <section className="panel review-layout">
    <div className="review-context">
      <div className="review-session-bar"><div className="session-counter"><span>APPLICATION</span><strong>{position}</strong><small>of {total}</small></div><button className="text-button" onClick={onDone}>Skip for now <ArrowRight size={14} /></button></div>
      <div className="session-progress"><div style={{ width: `${Math.round(position / total * 100)}%` }} /></div>
      <div className="startup-heading"><Avatar name={app.startupName} index={position} /><div><h2>{app.startupName}</h2><p>{app.answers.oneliner}</p><div className="intro-meta"><span className="industry-pill">{app.industry}</span><Badge value={app.stageId} /><Badge value={label(app.companyStage)} /></div></div></div>
      <h4 className="step-heading">THE APPLICATION</h4>
      <div className="source-answers">{cohort!.questions.filter(q => app.answers[q.id]).map(q => <article key={q.id}><strong>{q.label}</strong><p>{app.answers[q.id]}</p></article>)}</div>
      <div className="review-footnote"><Sparkles size={15} /><span>Briefs and evidence are available to the organizing team. Review on your own judgment first.</span></div>
    </div>
    <div className="scoring-panel">
      <h4 className="step-heading">YOUR SCORES</h4>
      <div className="rubric-scores">{rubric.map(c => <div className="rating-row" key={c.id}><div><strong>{c.label}</strong><small>{c.description}</small></div><div className="stars">{[1, 2, 3, 4, 5].map(n => <button key={n} className={scores[c.id] === n ? 'filled' : ''} aria-label={`${c.label}: ${n} star${n > 1 ? 's' : ''}`} onClick={() => setScores(s => ({ ...s, [c.id]: n }))}><Star size={18} fill={scores[c.id] && scores[c.id] >= n ? 'currentColor' : 'none'} /></button>)}</div></div>)}</div>
      {overall !== null && <div className="weighted-total"><span>Weighted score</span><strong>{overall.toFixed(2)}</strong><small>out of 5, weighted by your rubric</small></div>}
      <div className="recommendation-section"><h4 className="step-heading">YOUR RECOMMENDATION</h4>
        <div className="recommendations">{(['advance', 'waitlist', 'reject'] as Recommendation[]).map(r => <button key={r} className={`recommendation ${r} ${recommendation === r ? 'selected' : ''}`} onClick={() => { setRecommendation(r); if (r !== 'advance') setChampion(false); }}>{label(r)}<small>{r === 'advance' ? 'I believe in this team' : r === 'waitlist' ? 'Strong, but not now' : 'Not the right fit'}</small></button>)}</div></div>
      <label className="champion-toggle"><input type="checkbox" checked={champion} disabled={recommendation !== 'advance'} onChange={e => setChampion(e.target.checked)} /><span><strong>Champion this application</strong><small>Your champion flag carries weight with the committee. {cohort!.championLimit ? `You can champion up to ${cohort!.championLimit} in this cohort.` : ''}</small></span></label>
      <Field label="Notes for the committee"><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What shaped your judgment? What evidence matters most?" /></Field>
      <div className="form-actions"><button className="text-button conflict-link" onClick={() => setRecusing(true)}><Flag size={14} /> Declare a conflict</button><Button variant="secondary" busy={busy} disabled={!complete} onClick={() => void save(false)}>Save draft</Button><Button busy={busy} disabled={!complete} onClick={() => void save(true)}>Save & next <ArrowRight size={16} /></Button></div>
      {!complete && <div className="notice">Rate every rubric category before saving.</div>}
      {mineChampions >= 0 && champion && cohort!.championLimit && <div className="notice">Champion spots are limited; the committee reconciles final champions.</div>}
    </div>
    {recusing && <Modal title="Declare a conflict" subtitle={app.startupName} onClose={() => setRecusing(false)}><p className="muted">You will be removed from this application's review assignments and any saved review will be discarded.</p><Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field><div className="form-actions"><Button variant="secondary" onClick={() => setRecusing(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} busy={busy} onClick={() => void act(() => api(`${base}/applications/${app.id}/recuse`, { reason }), 'Conflict recorded').then(() => { setRecusing(false); onDone(); })}>Declare conflict</Button></div></Modal>}
  </section>;
}