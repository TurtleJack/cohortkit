import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, ClipboardCheck, Layers, Lock, Sprout, ArrowRight } from 'lucide-react';
import { Brand, Button, Field, CheckField, ErrorMessage, Loading, date } from '../ui';
import { label, type ApplicantData } from '../../shared/domain';
import { api } from '../api';

interface PublicCohort { organization: { name: string; slug: string }; cohort: { id: string; name: string; description: string; deadline: string; capacity: number; questions: { id: string; label: string; type: string; required: boolean; options: string[] }[]; qualifications: { id: string; label: string; required: boolean }[]; status: string; slug: string }; accepting: boolean }
interface DraftState { application: ApplicantData & { status: string; submittedAt: string | null; version: number }; cohortName: string; orgSlug: string; cohortSlug: string }

function draftKey(orgSlug?: string, cohortSlug?: string) { return `ck-draft-${orgSlug}-${cohortSlug}`; }

export function ApplyPage() {
  const { orgSlug, cohortSlug } = useParams();
  const [info, setInfo] = useState<PublicCohort | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [token, setToken] = useState(localStorage.getItem(draftKey(orgSlug, cohortSlug)) || '');
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<ApplicantData>({ startupName: '', founderName: '', email: '', industry: '', location: '', companyStage: 'Idea', answers: {}, qualifications: {}, consent: false });
  const loadingDraft = useRef(false);
  useEffect(() => { api<PublicCohort>(`/public/${orgSlug}/${cohortSlug}`).then(setInfo).catch(e => setError(e.message)); }, [orgSlug, cohortSlug]);
  useEffect(() => {
    if (!token || loadingDraft.current) return;
    loadingDraft.current = true;
    api<DraftState>('/public/application', undefined, 'GET', token).then(d => { setData(d.application); setVersion(d.application.version); setSubmitted(d.application.status === 'submitted'); }).catch(() => { localStorage.removeItem(draftKey(orgSlug, cohortSlug)); setToken(''); });
  }, [token, orgSlug, cohortSlug]);
  if (error && !info) return <div className="center-screen"><ErrorMessage error={error} /><Link to="/" className="text-link">Back to CohortKit</Link></div>;
  if (!info) return <div className="center-screen"><Loading /></div>;
  const { cohort, organization, accepting } = info;
  const set = (patch: Partial<ApplicantData>) => setData(d => ({ ...d, ...patch }));
  const setAnswer = (id: string, value: string) => setData(d => ({ ...d, answers: { ...d.answers, [id]: value } }));
  const run = async (submit: boolean) => {
    setBusy(true); setError('');
    try {
      let nextToken = token; let nextVersion = version;
      if (!token) {
        const created = await api<{ id: string; token: string }>(`/public/${orgSlug}/${cohortSlug}/drafts`, data);
        nextToken = created.token; setToken(created.token); localStorage.setItem(draftKey(orgSlug, cohortSlug), created.token);
      }
      const result = await api<{ version: number }>('/public/application', { data, version: nextVersion, submit }, 'PUT', nextToken);
      nextVersion = result.version; setVersion(result.version);
      if (submit) setSubmitted(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (submitted) return <div className="center-screen"><div className="status-page"><div className="completion-icon"><CheckCircle2 size={30} /></div><h1>Application submitted.</h1><p>Thank you for applying to <strong>{cohort.name}</strong>. The organizing team will review your application. Decisions are shared through your private status link — save it somewhere safe.</p>
    <div className="private-link"><span><Lock size={15} /> Your private status link</span><input readOnly value={`${location.origin}/application/${token}`} onFocus={e => e.target.select()} /><small>Applications received before {date(cohort.deadline)} are considered for the cohort.</small></div>
    <Link className="btn secondary" to={`/application/${token}`}>Open status page <ArrowRight size={15} /></Link></div></div>;
  return <div className="intake-layout">
    <aside className="intake-story"><Link to="/" className="brand-link"><Brand light /></Link><div><div className="eyebrow">APPLICATIONS FOR</div><h1>{cohort.name}</h1><p>{cohort.description}</p><div className="intake-facts"><span><ClipboardCheck size={15} /> {cohort.questions.length} questions</span><span><Sprout size={15} /> {cohort.capacity} cohort spots</span><span>Closes {date(cohort.deadline)}</span></div></div><div className="intake-note"><Layers size={18} /><p><strong>Your answers stay private.</strong> Only the organizing team and assigned reviewers see them.</p></div><p className="powered-by">Powered by CohortKit — open-source software for programs that back what's next.</p></aside>
    <main className="intake-form">
      <div className="public-header"><div><h2>Apply to {cohort.name}</h2><p>Drafts save automatically to this browser. You can leave and continue later.</p></div></div>
      {!accepting && <div className="notice">Applications for this cohort are currently closed.</div>}
      <ErrorMessage error={error} />
      <div className="intake-steps"><span className="current"><b>1</b> About your startup</span><ChevronRight size={14} /><span><b>2</b> Your answers</span><ChevronRight size={14} /><span><b>3</b> Review & submit</span></div>
      <form onSubmit={e => { e.preventDefault(); if (accepting) void run(true); }}>
        <h4 className="step-heading">ABOUT YOUR STARTUP</h4>
        <div className="form-grid">
          <Field label="Startup name"><input required value={data.startupName} onChange={e => set({ startupName: e.target.value })} /></Field>
          <Field label="Founder name"><input required value={data.founderName} onChange={e => set({ founderName: e.target.value })} /></Field>
          <Field label="Email address" hint="We use this to create your private application link."><input required type="email" value={data.email} disabled={!!token} onChange={e => set({ email: e.target.value })} /></Field>
          <Field label="Company stage"><select value={data.companyStage} onChange={e => set({ companyStage: e.target.value as ApplicantData['companyStage'] })}>{['Idea', 'Prototype', 'MVP', 'Revenue', 'Growth'].map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Industry"><input required value={data.industry} onChange={e => set({ industry: e.target.value })} /></Field>
          <Field label="Location"><input required value={data.location} onChange={e => set({ location: e.target.value })} /></Field>
        </div>
        <h4 className="step-heading">YOUR ANSWERS</h4>
        {cohort.questions.map(q => <Field key={q.id} label={q.required ? `${q.label} *` : q.label}>
          {q.type === 'textarea' ? <textarea required={q.required} value={data.answers[q.id] || ''} onChange={e => setAnswer(q.id, e.target.value)} /> : q.type === 'select' ? <select required={q.required} value={data.answers[q.id] || ''} onChange={e => setAnswer(q.id, e.target.value)}><option value="">Choose…</option>{q.options.map(o => <option key={o}>{o}</option>)}</select> : <input required={q.required} type={q.type === 'url' ? 'url' : 'text'} value={data.answers[q.id] || ''} onChange={e => setAnswer(q.id, e.target.value)} />}
        </Field>)}
        <h4 className="step-heading">QUALIFICATIONS</h4>
        {cohort.qualifications.map(q => <CheckField key={q.id} label={q.label} checked={!!data.qualifications[q.id]} onChange={v => setData(d => ({ ...d, qualifications: { ...d.qualifications, [q.id]: v } }))} />)}
        <CheckField label="I confirm the information in this application is accurate, and I agree to the program's terms." checked={data.consent} onChange={v => set({ consent: v })} />
        <div className="intake-actions"><Button variant="secondary" type="button" disabled={!accepting} busy={busy} onClick={() => void run(false)}>Save draft</Button><Button type="submit" disabled={!accepting || !data.consent} busy={busy}>Submit application <ArrowRight size={16} /></Button></div>
      </form>
    </main>
  </div>;
}

export function StatusPage() {
  const { token } = useParams();
  const [state, setState] = useState<DraftState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (token) api<DraftState>('/public/application', undefined, 'GET', token).then(setState).catch(e => setError(e.message)); }, [token]);
  if (error) return <div className="center-screen"><ErrorMessage error={error} /><p className="muted">Paste the private link you saved when you applied.</p><Link to="/" className="text-link">Back to CohortKit</Link></div>;
  if (!state) return <div className="center-screen"><Loading /></div>;
  const a = state.application;
  const resume = () => { if (token) localStorage.setItem(draftKey(state.orgSlug, state.cohortSlug), token); };
  return <div className="center-screen"><div className="status-page"><div className="completion-icon"><CheckCircle2 size={30} /></div><h1>{a.status === 'submitted' ? 'Application received.' : 'Application in progress.'}</h1><p>{a.status === 'submitted' ? `Submitted ${a.submittedAt ? date(a.submittedAt) : ''} to ${state.cohortName}. The organizing team will review your application and share a decision here.` : 'Your draft is saved. Return to this page to keep working on it.'}</p>
    {a.status === 'draft' && <Link className="btn primary" to={`/apply/${state.orgSlug}/${state.cohortSlug}`} onClick={resume}>Continue application <ArrowRight size={16} /></Link>}
    <div className="receipt-details"><span><strong>Startup</strong>{a.startupName}</span><span><strong>Founder</strong>{a.founderName}</span><span><strong>Stage</strong>{label(a.companyStage)}</span><span><strong>Industry</strong>{a.industry}</span></div></div></div>;
}

export function InvitePage() {
  const { token } = useParams();
  const nav = useNavigate();
  interface InviteInfo { organization: string; name: string; email: string; role: string; orgSlug: string; cohortSlug: string | null }
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (token) api<InviteInfo>(`/invitations/${token}`).then(setInfo).catch(e => setError(e.message)); }, [token]);
  if (error) return <div className="center-screen"><ErrorMessage error={error} /><Link to="/login" className="text-link">Sign in to CohortKit</Link></div>;
  if (!info) return <div className="center-screen"><Loading /></div>;
  if (info.role === 'founder') return <div className="center-screen"><div className="standalone-card"><Brand /><h1>You're invited to apply.</h1><p>{info.organization} invited you to apply to their cohort. Use this link — it is tied to you personally.</p>{info.cohortSlug && <Link className="btn primary" to={`/apply/${info.orgSlug}/${info.cohortSlug}`}>Open application <ArrowRight size={16} /></Link>}</div></div>;
  return <div className="center-screen"><div className="standalone-card"><Brand /><h1>Join {info.organization}.</h1><p>You've been invited as <strong>{label(info.role)}</strong>. {error || 'Accept to join the workspace.'}</p>
    <ErrorMessage error={error} />
    <form onSubmit={async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); try { const r = await api<{ orgId: string }>(`/invitations/${token}/accept`, data); nav(`/workspace/${r.orgId}/overview`); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
      <Field label="Your name"><input name="name" required defaultValue={info.name} /></Field>
      <Field label="Email address"><input type="email" readOnly value={info.email} /></Field>
      <Field label="Password" hint="Only needed if you don't have an account yet. At least 12 characters."><input name="password" type="password" minLength={12} /></Field>
      <Button type="submit" busy={busy} className="full">Accept invitation <ArrowRight size={16} /></Button>
    </form><Link to="/login" className="text-link">Already have an account? Sign in first</Link></div></div>;
}