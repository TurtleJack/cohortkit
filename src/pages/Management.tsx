import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Users, Plus, Trash2, SlidersHorizontal, Shield, Settings, ArrowUpRight, Check, CreditCard, FileText, Star, Layers, X, CalendarDays, ListChecks, Scale, HelpCircle, Mail, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useWorkspace, useSession } from '../App';
import { Avatar, Badge, Button, Empty, PageHeading, SectionTitle, Field, Modal, LinkBox, CheckField, ErrorMessage } from '../ui';
import { canManage, plans, modules, label, defaultCohort, type Cohort, type CohortConfig, type Criterion, type Question, type Qualification, type Stage, type Module } from '../../shared/domain';
import { api } from '../api';

export function TeamPage() {
  const { workspace, base, act, busy } = useWorkspace();
  const owner = workspace.organization.role === 'owner';
  const [invite, setInvite] = useState(false);
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(workspace.invitations.filter(i => i.role !== 'founder'));
  if (!canManage(workspace.organization.role)) return <Navigate to="../review" replace />;
  const reviewers = workspace.members.filter(m => m.role === 'reviewer').length;
  const committee = workspace.members.filter(m => m.role === 'committee').length;
  return <>
    <PageHeading eyebrow="WORKSPACE" title="Reviewers & team" description="Bring the right people into the decision. Roles keep every step of the process visible to the right eyes." actions={<Button onClick={() => { setUrl(''); setInvite(true); }}><Plus size={16} /> Invite someone</Button>} />
    <section className="team-summary"><div><strong>{reviewers}</strong><span>reviewers</span></div><div><strong>{committee}</strong><span>committee members</span></div><div><strong>{pending.length}</strong><span>pending invitations</span></div></section>
    <section className="panel"><SectionTitle title="Members" description={`${workspace.members.length} people in this workspace`} />
      <div className="table-scroll"><table className="application-table"><thead><tr><th>MEMBER</th><th>ROLE</th><th>ASSIGNMENTS</th><th>COMPLETED</th><th /></tr></thead><tbody>{workspace.members.map((m, i) => <tr key={m.id}><td><div className="startup-button"><Avatar name={m.name} index={i} /><span><strong>{m.name}</strong><small>{m.email || '—'}</small></span></div></td><td>{m.role === 'owner' || !owner ? <Badge value={m.role} /> : <select aria-label={`Role for ${m.name}`} value={m.role} onChange={e => void act(() => api(`${base}/members/${m.id}`, { role: e.target.value }, 'PATCH'), `Role updated to ${e.target.value}`)}>{['admin', 'committee', 'reviewer'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select>}</td><td><Badge value={String(m.assignments)} /></td><td><Badge value={String(m.completed)} /></td><td /></tr>)}</tbody></table></div></section>
    <section className="panel"><SectionTitle title="Invitations" description="Invitations expire after 7 days. Copy the private link and share it yourself." />
      <div className="invitation-list">{pending.length ? pending.map(i => <div key={i.id}><span className="invitation-icon"><Users size={17} /></span><div><strong>{i.name} · {i.email}</strong><small>{label(i.role)} · expires {new Date(i.expiresAt).toLocaleDateString()}</small></div><Badge value={i.role} /><Button variant="ghost" aria-label={`Revoke invitation for ${i.email}`} onClick={() => void act(() => api(`${base}/invitations/${i.id}`, {}, 'DELETE'), 'Invitation revoked').then(() => setPending(p => p.filter(x => x.id !== i.id)))}><Trash2 size={15} /></Button></div>) : <Empty title="No pending invitations" description="Invite reviewers, committee members, or additional administrators." />}</div></section>
    {invite && <Modal title="Invite someone to the workspace" subtitle="They receive a private link — no email is sent automatically." onClose={() => setInvite(false)}>
      <form onSubmit={async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); const r = await act(() => api<{ url: string }>(`${base}/invitations`, { ...data, role: data.role }), 'Invitation created'); if (r) { setUrl(r.url); setPending(p => [...p, { id: crypto.randomUUID(), email: String(data.email), name: String(data.name), role: data.role as 'admin' | 'committee' | 'reviewer', cohortId: null, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), acceptedAt: null, createdAt: new Date().toISOString() }]); } }}>
        <Field label="Name"><input name="name" required /></Field>
        <Field label="Email address"><input name="email" type="email" required /></Field>
        <Field label="Role" hint="Reviewers score applications. Committee members can also move stages and record decisions. Admins manage the workspace."><select name="role" defaultValue="reviewer">{['reviewer', 'committee', 'admin'].map(r => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
        <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setInvite(false)}>Done</Button><Button type="submit" busy={busy}><Plus size={16} /> Create invitation</Button></div>
      </form>{url && <LinkBox url={url} />}</Modal>}
  </>;
}

export function SettingsPage() {
  const { workspace, base, act, busy } = useWorkspace();
  const [name, setName] = useState(workspace.organization.name);
  const [activeModules, setActiveModules] = useState<Module[]>(workspace.organization.modules);
  const [branding, setBranding] = useState(workspace.organization.branding);
  const billingNote = new URLSearchParams(location.search).get('billing');
  if (!canManage(workspace.organization.role)) return <Navigate to="../review" replace />;
  const org = workspace.organization;
  const status = org.subscriptionStatus;
  const save = (modules: Module[]) => act(() => api(`${base}/settings`, { name, modules, branding }, 'PATCH'), 'Settings saved');
  return <>
    <PageHeading eyebrow="WORKSPACE" title="Settings & billing" description="Shape your workspace, choose what is enabled, and manage your plan." />
    {billingNote && <div className={`notice ${billingNote === 'success' ? 'success-note' : ''}`}>{billingNote === 'success' ? 'Billing setup complete. Your subscription will appear here shortly.' : 'Billing setup was canceled.'}</div>}
    <div className="setup-layout">
      <section className="panel settings-card"><SectionTitle title="Workspace profile" description="This name appears throughout your workspace and application portal." />
        <div className="setup-panel" style={{ padding: 0 }}>
          <Field label="Organization name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Workspace URL"><input readOnly value={`${location.origin}/apply/${org.slug}`} onFocus={e => e.target.select()} /></Field>
          <div className="form-actions" style={{ marginTop: 0 }}><Button busy={busy} onClick={() => void save(activeModules)}>Save changes</Button></div>
        </div>
      </section>
      <section className="panel settings-card"><SectionTitle title="Portal branding" description="Colors, logo, and copy shown on your public application portal." />
        <div className="setup-panel" style={{ padding: 0 }}>
          <div className="form-grid">
            <Field label="Accent color"><input type="color" value={branding.accent} onChange={e => setBranding({ ...branding, accent: e.target.value })} /></Field>
            <Field label="Logo URL" hint="Optional. Served from any public URL."><input value={branding.logoUrl} placeholder="https://…/logo.png" onChange={e => setBranding({ ...branding, logoUrl: e.target.value })} /></Field>
          </div>
          <Field label="Portal footer"><input value={branding.footer} onChange={e => setBranding({ ...branding, footer: e.target.value })} /></Field>
          <Field label="Email sender name" hint="The 'from' name on transactional email."><input value={branding.senderName} placeholder={name} onChange={e => setBranding({ ...branding, senderName: e.target.value })} /></Field>
          <div className="form-actions" style={{ marginTop: 0 }}><Button busy={busy} onClick={() => void save(activeModules)}>Save branding</Button></div>
        </div>
      </section>
      <section className="panel settings-card"><SectionTitle title="Enabled components" description="Turn product areas on or off for this workspace." />
        <div className="setup-panel" style={{ padding: 0 }}>
          {modules.map(m => <label className="check-field" key={m}><input type="checkbox" checked={activeModules.includes(m)} onChange={e => { const next = e.target.checked ? [...activeModules, m] : activeModules.filter(x => x !== m); setActiveModules(next); void save(next); }} /><span><strong>{label(m)}</strong><small>{m === 'intake' ? 'Public application portal and intake administration.' : m === 'review' ? 'Reviewer workspace, assignments, and the selection pipeline.' : 'AI-drafted briefs and provider configuration.'}</small></span></label>)}
        </div>
      </section>
      <section className="panel settings-card"><SectionTitle title="Integrations" description="Live adapters require configured credentials." />
        <div className="setup-panel" style={{ padding: 0 }}>
          <div className="integration-row"><span className="component-icon"><Star size={16} /></span><div><strong>AI briefs</strong><small>Optional AI-drafted application briefs, always approved by a human.</small></div><Badge value={workspace.integrations.ai ? 'active' : 'pending'} /></div>
          <div className="integration-row"><span className="component-icon"><CreditCard size={16} /></span><div><strong>Subscription billing</strong><small>Stripe Checkout, customer portal, and signed webhooks.</small></div><Badge value={workspace.integrations.billing ? 'active' : 'pending'} /></div>
        </div>
      </section>
    </div>
    <section className="panel settings-card"><SectionTitle title="Plan & billing" description={status === 'trialing' ? `Your trial ends ${new Date(org.trialEndsAt).toLocaleDateString()}.` : 'Subscription status'} />
      <div className="setup-panel" style={{ padding: 0 }}>
        <div className="subscription-summary"><div><Badge value={org.plan} /><Badge value={status} /></div><p>{status === 'active' ? 'Active subscription.' : status === 'trialing' ? 'Everything is enabled during your trial.' : 'Existing data stays available to view and export.'}</p></div>
        <div className="plan-grid">{Object.entries(plans).map(([id, p]) => <div className={`pricing-card ${org.plan === id ? 'current' : ''}`} key={id}><div className="between"><h3>{p.name}</h3>{org.plan === id && <Badge value="current" />}</div><p>{p.description}</p><strong>{id === 'starter' ? '$29' : '$99'}<small>/mo</small></strong><div className="usage-grid"><span><b>{p.applications}</b><small>applications</small></span><span><b>{p.reviewers}</b><small>team seats</small></span><span><b>{p.cohorts}</b><small>cohorts</small></span></div>{org.plan !== id && org.role === 'owner' && <Button className="full" disabled={!workspace.integrations.billing} onClick={() => void act(() => api<{ url: string }>(`${base}/billing/checkout`, { plan: id })).then(r => { if (r) location.href = r.url; })}>Choose {p.name}</Button>}</div>)}</div>
        {org.role === 'owner' && org.subscriptionStatus !== 'trialing' && <div className="form-actions" style={{ justifyContent: 'flex-start' }}><Button variant="secondary" disabled={!workspace.integrations.billing} onClick={() => void act(() => api<{ url: string }>(`${base}/billing/portal`)).then(r => { if (r) location.href = r.url; })}>Manage billing <ArrowUpRight size={15} /></Button></div>}
        {!workspace.integrations.billing && <p className="help-text">Stripe is not configured on this instance. Payment is never taken; the workspace keeps full access on the starter plan.</p>}
      </div>
    </section>
  </>;
}

export function CohortEditor() {
  const { workspace, cohort, base, act, busy, selectCohort, notify } = useWorkspace();
  const isNew = !cohort;
  const [config, setConfig] = useState<CohortConfig>(() => ({ ...(cohort ? structuredClone(cohort) : defaultCohort()) }));
  const [tab, setTab] = useState<'general' | 'questions' | 'qualifications' | 'rubric' | 'stages' | 'faqs'>('general');
  const [wizard, setWizard] = useState(false);
  const [wizDesc, setWizDesc] = useState('');
  const [wizBusy, setWizBusy] = useState(false);
  const [wizResult, setWizResult] = useState<{ source: string; proposal: CohortConfig } | null>(null);
  const [wizError, setWizError] = useState('');
  const generate = async () => {
    setWizBusy(true); setWizError('');
    try {
      const r = await api<{ source: string; proposal: CohortConfig }>(`${base}/cohorts/propose`, { description: wizDesc });
      setWizResult(r);
    } catch (e) { setWizError((e as Error).message); } finally { setWizBusy(false); }
  };
  if (!canManage(workspace.organization.role)) return <Navigate to="../review" replace />;
  const locked = !isNew && cohort!.applicationCount !== undefined && cohort!.applicationCount > 0;
  const bump = (list: { id: string }[], prefix: string) => `${prefix}${list.reduce((m, x) => { const n = Number(x.id.match(/\d+$/)?.[0]); return Number.isFinite(n) ? Math.max(m, n + 1) : m; }, 1)}`;
  const save = () => void act(async () => {
    if (isNew) {
      const created = await api<Cohort>(`${base}/cohorts`, config);
      selectCohort(created.id); return;
    }
    return api(`${base}/cohorts/${cohort!.id}`, { config, version: cohort!.version }, 'PUT');
  }, isNew ? 'Cohort created' : 'Cohort saved');
  const sections: { id: 'general' | 'questions' | 'qualifications' | 'rubric' | 'stages' | 'faqs'; label: string; icon: typeof SlidersHorizontal }[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal }, { id: 'questions', label: 'Application questions', icon: FileText }, { id: 'qualifications', label: 'Qualifications', icon: ListChecks }, { id: 'rubric', label: 'Scoring rubric', icon: Star }, { id: 'stages', label: 'Workflow stages', icon: Layers }, { id: 'faqs', label: 'Portal FAQs', icon: HelpCircle },
  ];
  return <>
    <PageHeading eyebrow="COHORT SETUP" title={isNew ? 'Build your first cohort' : config.name || 'Cohort setup'} description="Everything about how you evaluate founders is configurable here — questions, checks, scoring, and stages." actions={<><Button variant="secondary" onClick={() => { setWizResult(null); setWizDesc(''); setWizard(true); }}><Sparkles size={15} /> Generate with AI</Button><Button busy={busy} onClick={save}>{isNew ? 'Create cohort' : 'Save changes'} <Check size={16} /></Button></>} />
    {isNew && <div className="notice">Start with sensible defaults and shape them to your program. Intake questions and the rubric lock once applications exist, so scores stay comparable.</div>}
    {wizard && <Modal wide title="AI setup assistant" subtitle="Describe your program; AI proposes a complete evaluation setup for you to review and edit." onClose={() => setWizard(false)}>
      <div className="setup-wizard">
        {!wizResult ? <>
          <Field label="Describe your program" hint="Mention the focus, stage, industries, and what you look for in founders."><textarea rows={4} value={wizDesc} onChange={e => setWizDesc(e.target.value)} placeholder="We run a 12-week climate tech accelerator for pre-seed founders building AI solutions for sustainability…" /></Field>
          {wizError && <div className="notice">{wizError}</div>}
          <div className="form-actions"><Button variant="secondary" onClick={() => setWizard(false)}>Cancel</Button><Button busy={wizBusy} disabled={wizDesc.trim().length < 20} onClick={() => void generate()}><Sparkles size={15} /> Propose setup</Button></div>
          <p className="help-text">Without a configured AI provider this uses a local, keyword-driven proposal generator. With OpenAI configured, the proposal is drafted by the model — either way, you review and edit everything before saving.</p>
        </> : <div className="wizard-preview">
          <div className="inline"><Badge value={wizResult.source} /><h3 style={{ flex: 1 }}>Proposed setup</h3><Button variant="primary" onClick={() => { setConfig({ ...wizResult.proposal, status: config.status }); setWizard(false); notify('Proposal applied. Review each section and save.'); }}>Use this proposal <Check size={15} /></Button></div>
          <div className="between" style={{ margin: '14px 0 4px' }}><strong>{wizResult.proposal.name || 'Untitled cohort'}</strong><small className="muted">{wizResult.proposal.rubric.reduce((s, c) => s + c.weight, 0)} total weight</small></div>
          <p className="muted">{wizResult.proposal.description}</p>
          <h4>SCORING RUBRIC</h4>
          <div className="builder-item">{wizResult.proposal.rubric.map(c => <div className="between" key={c.id} style={{ padding: '7px 0' }}><strong>{c.label}</strong><Badge value={`${c.weight}%`} /></div>)}</div>
          <h4>INTAKE ({wizResult.proposal.questions.length} QUESTIONS · {wizResult.proposal.qualifications.length} CHECKS)</h4>
          <div className="builder-item">{wizResult.proposal.questions.map(q => <p key={q.id} className="muted" style={{ padding: '4px 0' }}>· {q.label}{q.required ? ' *' : ''}</p>)}</div>
          <h4>STAGES</h4>
          <div className="builder-item">{wizResult.proposal.stages.map((s, i) => <p key={s.id} className="muted" style={{ padding: '4px 0' }}>{i + 1}. {s.label} ({s.minReviews} reviews)</p>)}</div>
          <h4>FAQ ({wizResult.proposal.faqs.length})</h4>
          <div className="builder-item">{wizResult.proposal.faqs.map(f => <p key={f.question} className="muted" style={{ padding: '4px 0' }}>· {f.question}</p>)}</div>
          <div className="form-actions"><Button variant="secondary" onClick={() => setWizResult(null)}>Describe differently</Button><Button variant="secondary" onClick={() => setWizard(false)}>Keep current setup</Button><Button onClick={() => { setConfig({ ...wizResult.proposal, status: config.status }); setWizard(false); notify('Proposal applied. Review each section and save.'); }}>Use this proposal <Check size={15} /></Button></div>
        </div>}
      </div>
    </Modal>}
    <div className="setup-layout">
      <nav className="setup-nav" aria-label="Cohort sections">{sections.map(s => <button key={s.id} className={tab === s.id ? 'active' : ''} onClick={() => setTab(s.id)}><s.icon size={16} />{s.label}<ArrowUpRight size={14} /></button>)}
        <div className="setup-tip"><Scale size={22} /><strong>Comparable scores</strong><p>Once a draft exists, questions, qualifications, the rubric, and stages are locked for that cohort. Create a new cohort to change them.</p></div>
      </nav>
      <section className="panel setup-panel">
        {tab === 'general' && <General config={config} setConfig={setConfig} />}
        {tab === 'questions' && <Questions config={config} setConfig={setConfig} bump={(q: number) => bump(config.questions, 'q')} />}
        {tab === 'qualifications' && <Qualifications config={config} setConfig={setConfig} bump={() => bump(config.qualifications, 'g')} />}
        {tab === 'rubric' && <Rubric config={config} setConfig={setConfig} bump={() => bump(config.rubric, 'c')} />}
        {tab === 'stages' && <Stages config={config} setConfig={setConfig} bump={() => bump(config.stages, 's')} />}
        {tab === 'faqs' && <Faqs config={config} setConfig={setConfig} />}
        <div className="form-actions"><Button busy={busy} onClick={save}>{isNew ? 'Create cohort' : 'Save changes'} <Check size={16} /></Button></div>
      </section>
    </div>
  </>;
}

function General({ config, setConfig }: { config: CohortConfig; setConfig: (c: CohortConfig) => void }) {
  return <>
    <SectionTitle title="General" description="Name, timeline, and how reviews are run." />
    <div className="form-grid">
      <Field label="Cohort name"><input value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} placeholder="Spring 2027 Cohort" /></Field>
      <Field label="Application deadline"><input type="datetime-local" value={config.deadline.slice(0, 16)} onChange={e => setConfig({ ...config, deadline: new Date(e.target.value).toISOString() })} /></Field>
    </div>
    <Field label="Public description" hint="Shown on the application portal."><textarea value={config.description} onChange={e => setConfig({ ...config, description: e.target.value })} /></Field>
    <div className="form-grid">
      <Field label="Cohort capacity"><input type="number" min={1} max={1000} value={config.capacity} onChange={e => setConfig({ ...config, capacity: Number(e.target.value) })} /></Field>
      <Field label="Status"><select value={config.status} onChange={e => setConfig({ ...config, status: e.target.value as CohortConfig['status'] })}>{['draft', 'open', 'closed'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
      <Field label="Champion limit per reviewer"><input type="number" min={1} max={20} value={config.championLimit} onChange={e => setConfig({ ...config, championLimit: Number(e.target.value) })} /></Field>
      <Field label="Review mode" hint="Assigned: reviewers see only their assignments. Pool: any reviewer can review any pooled application."><select value={config.reviewMode} onChange={e => setConfig({ ...config, reviewMode: e.target.value as CohortConfig['reviewMode'] })}>{['assigned', 'pool'].map(m => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
    </div>
    <CheckField label="Blind review" checked={config.blindReview} onChange={v => setConfig({ ...config, blindReview: v })} />
  </>;
}

function Questions({ config, setConfig, bump }: { config: CohortConfig; setConfig: (c: CohortConfig) => void; bump: (n: number) => string }) {
  const set = (id: string, patch: Partial<Question>) => setConfig({ ...config, questions: config.questions.map(q => q.id === id ? { ...q, ...patch } : q) });
  return <>
    <SectionTitle title="Application questions" description="Rendered in this order on the public portal. Required questions must be answered to submit." action={<Button variant="secondary" onClick={() => setConfig({ ...config, questions: [...config.questions, { id: bump(0), label: 'New question', type: 'textarea', required: true, options: [] }] })}><Plus size={15} /> Add question</Button>} />
    {config.questions.map((q, i) => <div className="builder-item" key={q.id}><span className="builder-number">{String(i + 1).padStart(2, '0')}</span><div>
      <div className="form-grid">
        <Field label="Question"><input value={q.label} onChange={e => set(q.id, { label: e.target.value })} /></Field>
        <Field label="Type"><select value={q.type} onChange={e => set(q.id, { type: e.target.value as Question['type'] })}>{['text', 'textarea', 'url', 'select'].map(t => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
      </div>
      {q.type === 'select' && <Field label="Options" hint="One option per line."><textarea value={q.options.join('\n')} onChange={e => set(q.id, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></Field>}
      <CheckField label="Required" checked={q.required} onChange={v => set(q.id, { required: v })} />
    </div><button className="icon-button" aria-label={`Remove ${q.label}`} onClick={() => setConfig({ ...config, questions: config.questions.filter(x => x.id !== q.id) })}><X size={17} /></button></div>)}
    {!config.questions.length && <Empty title="No questions yet" description="Add at least one question to open applications." />}
  </>;
}

function Qualifications({ config, setConfig, bump }: { config: CohortConfig; setConfig: (c: CohortConfig) => void; bump: () => string }) {
  const set = (id: string, patch: Partial<Qualification>) => setConfig({ ...config, qualifications: config.qualifications.map(q => q.id === id ? { ...q, ...patch } : q) });
  return <>
    <SectionTitle title="Qualifications" description="Founders confirm each statement before submitting. Required checks must all be confirmed." action={<Button variant="secondary" onClick={() => setConfig({ ...config, qualifications: [...config.qualifications, { id: bump(), label: 'New qualification', required: true }] })}><Plus size={15} /> Add check</Button>} />
    {config.qualifications.map((q, i) => <div className="builder-item" key={q.id}><span className="builder-number">{String(i + 1).padStart(2, '0')}</span><div><Field label="Statement"><input value={q.label} onChange={e => set(q.id, { label: e.target.value })} /></Field><CheckField label="Required to apply" checked={q.required} onChange={v => set(q.id, { required: v })} /></div><button className="icon-button" aria-label={`Remove ${q.label}`} onClick={() => setConfig({ ...config, qualifications: config.qualifications.filter(x => x.id !== q.id) })}><X size={17} /></button></div>)}
  </>;
}

function Rubric({ config, setConfig, bump }: { config: CohortConfig; setConfig: (c: CohortConfig) => void; bump: () => string }) {
  const set = (id: string, patch: Partial<Criterion>) => setConfig({ ...config, rubric: config.rubric.map(c => c.id === id ? { ...c, ...patch } : c) });
  const total = config.rubric.reduce((s, c) => s + c.weight, 0);
  return <>
    <div className="rubric-builder-top"><SectionTitle title="Scoring rubric" description="Each criterion is scored 1–5 stars and weighted into a single score out of 5." action={<Button variant="secondary" onClick={() => setConfig({ ...config, rubric: [...config.rubric, { id: bump(), label: 'New criterion', description: '', weight: 10 }] })}><Plus size={15} /> Add criterion</Button>} /><span className={`weighted-total ${total === 100 ? '' : 'danger'}`}>Weights: <strong>{total}</strong> / 100</span></div>
    {config.rubric.map((c, i) => <div className="builder-item" key={c.id}><span className="builder-number">{String(i + 1).padStart(2, '0')}</span><div>
      <div className="form-grid">
        <Field label="Criterion"><input value={c.label} onChange={e => set(c.id, { label: e.target.value })} /></Field>
        <Field label="Weight (0–100)"><input type="number" min={0.1} max={100} step={0.1} value={c.weight} onChange={e => set(c.id, { weight: Number(e.target.value) })} /></Field>
      </div>
      <Field label="What reviewers look for"><input value={c.description} onChange={e => set(c.id, { description: e.target.value })} /></Field>
    </div><button className="icon-button" aria-label={`Remove ${c.label}`} onClick={() => setConfig({ ...config, rubric: config.rubric.filter(x => x.id !== c.id) })}><X size={17} /></button></div>)}
    {total !== 100 && <div className="notice">Weights should add up to 100 so scores are comparable across applications.</div>}
  </>;
}

function Stages({ config, setConfig, bump }: { config: CohortConfig; setConfig: (c: CohortConfig) => void; bump: () => string }) {
  const set = (id: string, patch: Partial<Stage>) => setConfig({ ...config, stages: config.stages.map(s => s.id === id ? { ...s, ...patch } : s) });
  return <>
    <SectionTitle title="Workflow stages" description="Applications move through stages in order. Each stage defines the reviews needed to advance." action={<Button variant="secondary" onClick={() => setConfig({ ...config, stages: [...config.stages, { id: bump(), label: 'New stage', minReviews: 1 }] })}><Plus size={15} /> Add stage</Button>} />
    {config.stages.map((s, i) => <div className="builder-item" key={s.id}><span className="builder-number">{String(i + 1).padStart(2, '0')}</span><div className="form-grid">
      <Field label="Stage name"><input value={s.label} onChange={e => set(s.id, { label: e.target.value })} /></Field>
      <Field label="Reviews required to advance"><input type="number" min={0} max={10} value={s.minReviews} onChange={e => set(s.id, { minReviews: Number(e.target.value) })} /></Field>
    </div><button className="icon-button" aria-label={`Remove ${s.label}`} onClick={() => setConfig({ ...config, stages: config.stages.filter(x => x.id !== s.id) })}><X size={17} /></button></div>)}
    <p className="help-text">{config.stages.length ? `${label(config.stages[config.stages.length - 1].label)} is the final stage — that is where final decisions are recorded.` : 'Add at least two stages.'}</p>
  </>;
}

function Faqs({ config, setConfig }: { config: CohortConfig; setConfig: (c: CohortConfig) => void }) {
  const set = (i: number, patch: Partial<CohortConfig['faqs'][number]>) => setConfig({ ...config, faqs: config.faqs.map((f, n) => n === i ? { ...f, ...patch } : f) });
  return <>
    <SectionTitle title="Portal FAQs" description="Answers shown on the public application portal. Up to 8." action={<Button variant="secondary" onClick={() => setConfig({ ...config, faqs: [...config.faqs, { question: 'Who should apply?', answer: '' }] })}><Plus size={15} /> Add FAQ</Button>} />
    {config.faqs.map((f, i) => <div className="builder-item" key={i}><span className="builder-number">{String(i + 1).padStart(2, '0')}</span><div>
      <Field label="Question"><input value={f.question} onChange={e => set(i, { question: e.target.value })} /></Field>
      <Field label="Answer"><textarea value={f.answer} onChange={e => set(i, { answer: e.target.value })} /></Field>
    </div><button className="icon-button" aria-label={`Remove ${f.question}`} onClick={() => setConfig({ ...config, faqs: config.faqs.filter((_, n) => n !== i) })}><X size={17} /></button></div>)}
    {!config.faqs.length && <Empty title="No FAQs yet" description="Applicants see these answers before they start the form." />}
  </>;
}

export function EmailLogPage() {
  const { workspace, base } = useWorkspace();
  interface EmailRow { id: string; to: string; subject: string; status: 'pending' | 'sent' | 'failed'; provider: string; error: string; attempts: number; createdAt: string; sentAt: string | null }
  const [rows, setRows] = useState<EmailRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<EmailRow[]>(`${base}/emails`).then(setRows).catch(e => setError(e.message)); }, [base]);
  if (!canManage(workspace.organization.role)) return <Navigate to="../review" replace />;
  return <>
    <PageHeading eyebrow="WORKSPACE" title="Email log" description="Every transactional email queued by this workspace, with delivery status and retries." />
    {error && <div className="notice">{error}</div>}
    <section className="panel"><div className="email-log">{(rows || []).map(r => <div className="email-row" key={r.id}><span className="invitation-icon"><Mail size={16} /></span><div><strong>{r.subject}</strong><small>to {r.to} · queued {new Date(r.createdAt).toLocaleString()}</small></div><Badge value={r.status} /><small className="muted">{r.provider || '—'}{r.error ? ` · ${r.error}` : ''}</small></div>)}
      {rows && !rows.length && <Empty title="No email yet" description="Transactional email appears here as invitations, receipts, and decisions are sent." />}</div></section>
  </>;
}

export function PlatformPage() {
  const { user } = useSession();
  type PlatformOrg = { id: string; name: string; slug: string; plan: string; applications: number; members: number; createdAt: string };
  const [orgs, setOrgs] = useState<PlatformOrg[] | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  if (!user!.platformAdmin) return <Navigate to="/" replace />;
  if (!orgs) void api<PlatformOrg[]>('/platform').then(setOrgs).catch(e => setError(e.message));
  return <div className="platform-page"><PageHeading eyebrow="PLATFORM" title="Organizations" description="Every workspace running on this CohortKit instance." />
    <ErrorMessage error={error} />
    <section className="panel"><div className="table-scroll"><table className="application-table"><thead><tr><th>WORKSPACE</th><th>PLAN</th><th>APPLICATIONS</th><th>MEMBERS</th><th>CREATED</th></tr></thead><tbody>{(orgs || []).map(o => <tr key={o.id}><td><div className="startup-button"><Shield size={16} /><span><strong>{o.name}</strong><small>{o.slug}</small></span></div></td><td><Badge value={o.plan} /></td><td><Badge value={String(o.applications)} /></td><td><Badge value={String(o.members)} /></td><td>{new Date(o.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><SectionTitle title="Provision a workspace" description="Create an organization and generate an owner invitation link." />
      <div className="setup-panel" style={{ padding: 0 }}>
        <form onSubmit={async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); try { const r = await api<{ url: string }>('/platform/organizations', data); setUrl(r.url); if (orgs) setOrgs([...orgs, { id: crypto.randomUUID(), name: String(data.name), slug: String(data.slug), plan: 'starter', applications: 0, members: 0, createdAt: new Date().toISOString() }]); } catch (err) { setError((err as Error).message); } }}>
          <div className="form-grid"><Field label="Organization name"><input name="name" required /></Field><Field label="Workspace URL"><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} /></Field><Field label="Owner name"><input name="ownerName" required /></Field><Field label="Owner email"><input name="ownerEmail" type="email" required /></Field></div>
          <div className="form-actions"><Button type="submit"><Plus size={16} /> Provision workspace</Button></div>
        </form>{url && <LinkBox url={url} label="Owner invitation link" />}
      </div>
    </section></div>;
}