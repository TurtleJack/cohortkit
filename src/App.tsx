import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useParams, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, LayoutDashboard, Files, Workflow, Users, SlidersHorizontal, Settings, PanelLeftClose, Menu, ChevronDown, Plus, LogOut, ClipboardCheck, Sprout, ArrowUpRight, Command, Shield, Activity, ExternalLink } from 'lucide-react';
import { api } from './api';
import { Brand, Button, Loading, ErrorMessage, Avatar, Badge, Modal, Field, LinkBox, ActionErrorContext } from './ui';
import { canManage, canDecide, type User, type Organization, type Workspace, type Application, type Cohort } from '../shared/domain';
import { Overview, ApplicationsPage, WorkflowPage, ActivityPage } from './pages/Dashboard';
import { ReviewerPage } from './pages/Reviewer';
import { TeamPage, SettingsPage, CohortEditor, PlatformPage } from './pages/Management';
import { ApplyPage, StatusPage, InvitePage } from './pages/Intake';

interface Session {user:User|null;organizations:Organization[];demo:boolean}
interface SessionContext extends Session {refresh:()=>Promise<void>}
const SessionCtx=createContext<SessionContext>(null!);
export const useSession=()=>useContext(SessionCtx);
export interface WorkspaceContext {workspace:Workspace;cohort:Cohort|null;applications:Application[];base:string;refresh:()=>Promise<void>;notify:(message:string)=>void;act:<T>(action:()=>Promise<T>,message?:string)=>Promise<T|undefined>;busy:boolean;openApp:(id:string)=>void;selectCohort:(id:string)=>void;}
const WorkspaceCtx=createContext<WorkspaceContext>(null!);
export const useWorkspace=()=>useContext(WorkspaceCtx);

export function App() {
  const [session,setSession]=useState<Session|null>(null);const [error,setError]=useState('');
  const refresh=useCallback(async()=>{const s=await api<Session>('/session');setSession(s);},[]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  if(error)return <div className="center-screen"><ErrorMessage error={error}/><Button onClick={()=>location.reload()}>Try again</Button></div>;
  if(!session)return <Loading/>;
  return <SessionCtx.Provider value={{...session,refresh}}><Routes>
    <Route path="/" element={session.user?<Navigate to={session.organizations.length?`/workspace/${session.organizations[0].id}/overview`:'/new-workspace'}/>:<AuthPage/>}/>
    <Route path="/login" element={<AuthPage/>}/>
    <Route path="/new-workspace" element={session.user?<NewWorkspace/>:<Navigate to="/login"/>}/>
    <Route path="/apply/:orgSlug/:cohortSlug" element={<ApplyPage/>}/>
    <Route path="/application/:token" element={<StatusPage/>}/>
    <Route path="/invite/:token" element={<InvitePage/>}/>
    <Route path="/platform" element={session.user?<PlatformPage/>:<Navigate to="/login"/>}/>
    <Route path="/workspace/:orgId" element={session.user?<WorkspaceLayout/>:<Navigate to="/login"/>}>
      <Route index element={<Navigate to="overview" replace/>}/><Route path="overview" element={<Overview/>}/><Route path="applications" element={<ApplicationsPage/>}/><Route path="workflow" element={<WorkflowPage/>}/><Route path="review" element={<ReviewerPage/>}/><Route path="team" element={<TeamPage/>}/><Route path="cohort" element={<CohortEditor/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="activity" element={<ActivityPage/>}/>
    </Route>
    <Route path="*" element={<div className="center-screen"><h1>That page isn’t here.</h1><Link to="/">Return to your workspace</Link></div>}/>
  </Routes></SessionCtx.Provider>;
}
function AuthPage() {
  const session=useSession();const nav=useNavigate();const [register,setRegister]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await session.refresh();nav('/');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="auth-page"><section className="auth-story"><Brand light/><div><div className="eyebrow">FROM APPLICATION TO POSSIBILITY</div><h1>Great founders.<br/>Thoughtful decisions.<br/><em>Your next cohort.</em></h1><p>One workspace to welcome applications, bring your reviewers together, and find the founders you believe in.</p><div className="story-tags"><span><ClipboardCheck size={17}/> Purposeful review</span><span><Users size={17}/> Human decisions</span></div></div><p className="auth-footer">Built for the people who back what’s next.</p></section><section className="auth-form"><div className="auth-inner"><span className="eyebrow">WELCOME TO COHORTKIT</span><h2>{register?'Start something great.':'Your next cohort awaits.'}</h2><p>{register?'Create your organization and start a 14-day trial.':'Sign in to your organization’s workspace.'}</p><ErrorMessage error={error}/><form onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));void run(()=>api(register?'/auth/register':'/auth/login',data));}}>
    {register&&<><Field label="Your name"><input name="name" required autoComplete="name"/></Field><Field label="Organization name"><input name="organizationName" required/></Field><Field label="Workspace URL" hint="Lowercase letters, numbers, and hyphens."><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3}/></Field></>}
    <Field label="Email address"><input name="email" type="email" required autoComplete="email"/></Field><Field label="Password"><input name="password" type="password" required minLength={register?12:1} autoComplete={register?'new-password':'current-password'}/></Field><Button busy={busy} type="submit" className="full">{register?'Create workspace':'Sign in'}<ArrowRight size={16}/></Button></form>
    <button className="text-button auth-switch" onClick={()=>setRegister(!register)}>{register?'Already have an account? Sign in':'New here? Create your workspace'}</button>
    {session.demo&&<div className="demo-entry"><Badge value="demo">LOCAL DEMO</Badge><p>Explore with 36 fictional applications. Your changes persist on this computer.</p><Button variant="secondary" busy={busy} className="full" onClick={()=>void run(()=>api('/auth/demo',{persona:'admin'}))}>Explore admin workspace <ArrowRight size={16}/></Button><button className="text-button" disabled={busy} onClick={()=>void run(()=>api('/auth/demo',{persona:'reviewer'}))}>Try the reviewer experience <ArrowUpRight size={14}/></button></div>}
  </div></section></div>;
}
function NewWorkspace() {const session=useSession();const nav=useNavigate();const [error,setError]=useState('');const [busy,setBusy]=useState(false);return <div className="center-screen"><div className="standalone-card"><Brand/><h1>A home for your next cohort.</h1><p>Each workspace keeps its people, applications, and subscription separate.</p><ErrorMessage error={error}/><form onSubmit={async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);try{const result=await api<{orgId:string}>('/orgs',data);await session.refresh();nav(`/workspace/${result.orgId}/cohort`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><Field label="Organization name"><input required name="name"/></Field><Field label="Workspace URL"><input required name="slug" minLength={3} pattern="[a-z0-9]+(-[a-z0-9]+)*"/></Field><Button type="submit" busy={busy}>Create workspace <Plus size={16}/></Button></form><Link to="/">Back to workspaces</Link></div></div>;}

function WorkspaceLayout() {
  const {orgId}=useParams();const session=useSession();const navigate=useNavigate();const location=useLocation();
  const [workspace,setWorkspace]=useState<Workspace|null>(null);const [cohortId,setCohortId]=useState('');const [applications,setApplications]=useState<Application[]>([]);const [error,setError]=useState('');const [toast,setToast]=useState('');const [busy,setBusy]=useState(false);const [mobile,setMobile]=useState(false);const [selectedApp,setSelectedApp]=useState<string|null>(null);const [inviteFounders,setInviteFounders]=useState(false);
  const base=`/orgs/${orgId}`;const refresh=useCallback(async()=>{const data=await api<Workspace>(`${base}/workspace`);setWorkspace(data);const saved=localStorage.getItem(`aos-cohort-${orgId}`);const chosen=data.cohorts.find(c=>c.id===cohortId)||data.cohorts.find(c=>c.id===saved)||data.cohorts[0];if(chosen){setCohortId(chosen.id);setApplications(await api<Application[]>(`${base}/cohorts/${chosen.id}/applications`));}else{setCohortId('');setApplications([]);}},[base,orgId,cohortId]);
  useEffect(()=>{setError('');refresh().catch(e=>setError(e.message));},[refresh]);
  useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timeout);},[toast]);
  useEffect(()=>{setMobile(false);setSelectedApp(null);},[location.pathname]);
  const act=async<T,>(action:()=>Promise<T>,message?:string):Promise<T|undefined>=>{setBusy(true);setError('');try{const result=await action();await refresh();if(message)setToast(message);return result;}catch(e){setError((e as Error).message);return undefined;}finally{setBusy(false);}};
  const cohort=workspace?.cohorts.find(c=>c.id===cohortId)||null;
  if(!workspace)return <div className="center-screen">{error?<><ErrorMessage error={error}/><Link to="/">Back to workspaces</Link></>:<Loading/>}</div>;
  const manager=canManage(workspace.organization.role);const committee=canDecide(workspace.organization.role);const prefix=`/workspace/${orgId}`;
  const links=[{to:'overview',label:'Overview',icon:LayoutDashboard,show:committee},{to:'applications',label:'Applications',icon:Files,show:committee,count:applications.filter(a=>a.status==='submitted').length},{to:'workflow',label:'Selection pipeline',icon:Workflow,show:committee},{to:'review',label:'Review workspace',icon:ClipboardCheck,show:true}];
  return <WorkspaceCtx.Provider value={{workspace,cohort,applications,base,refresh,notify:setToast,act,busy,openApp:setSelectedApp,selectCohort:(id)=>{localStorage.setItem(`aos-cohort-${orgId}`,id);setCohortId(id);}}}><ActionErrorContext.Provider value={error}><div className="app-shell"><aside className={`sidebar ${mobile?'is-open':''}`}><Link to="/" className="brand-link"><Brand light/></Link><div className="workspace-switch"><Avatar name={workspace.organization.name}/><div><small>YOUR WORKSPACE</small><select aria-label="Organization" value={orgId} onChange={e=>{setWorkspace(null);setCohortId('');navigate(`/workspace/${e.target.value}/overview`);}}>{session.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div></div><div className="nav-label">PROGRAM MANAGEMENT</div><nav>{links.filter(l=>l.show).map(l=><NavLink key={l.to} to={`${prefix}/${l.to}`}><l.icon size={19}/><span>{l.label}</span>{l.count!==undefined&&<b>{l.count}</b>}</NavLink>)}</nav>{manager&&<><div className="nav-label">WORKSPACE</div><nav><NavLink to={`${prefix}/team`}><Users size={19}/>Reviewers & team</NavLink><NavLink to={`${prefix}/cohort`}><SlidersHorizontal size={19}/>Cohort setup</NavLink><NavLink to={`${prefix}/settings`}><Settings size={19}/>Settings & billing</NavLink><NavLink to={`${prefix}/activity`}><Activity size={19}/>Activity log</NavLink></nav></>}
    <div className="sidebar-bottom"><div className="plan-card"><Sprout size={21}/><div><strong>{workspace.organization.plan==='starter'?'Starter':'Growth'} workspace</strong><small>{workspace.organization.subscriptionStatus==='trialing'?'14-day trial · room to grow':workspace.organization.subscriptionStatus}</small></div>{manager&&<Link to={`${prefix}/settings`} aria-label="View plan"><ArrowUpRight size={18}/></Link>}</div>{session.user?.platformAdmin&&<Link className="platform-link" to="/platform"><Shield size={16}/>Platform administration <ArrowUpRight size={14}/></Link>}<div className="user-menu"><Avatar name={session.user!.name} small/><div><strong>{session.user!.name}</strong><small>{workspace.organization.role}</small></div><button className="icon-button" aria-label="Sign out" onClick={()=>void act(async()=>{await api('/auth/logout',{});await session.refresh();navigate('/login');})}><LogOut size={17}/></button></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(!mobile)}><Menu size={20}/></button><span>Workspace</span><span>/</span><strong>{links.find(l=>location.pathname.endsWith(l.to))?.label||({team:'Reviewers & team',cohort:'Cohort setup',settings:'Settings & billing',activity:'Activity log'} as Record<string,string>)[location.pathname.split('/').at(-1)!]}</strong></div><div className="topbar-right">{session.demo&&<Badge value="demo">Demo workspace</Badge>}{cohort&&<div className="cohort-selector"><span className="status-dot"/><select aria-label="Active cohort" value={cohortId} onChange={e=>{localStorage.setItem(`aos-cohort-${orgId}`,e.target.value);setCohortId(e.target.value);}}>{workspace.cohorts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><ChevronDown size={14}/></div>}<Avatar name={session.user!.name} small/></div></header><main className="page-content"><ErrorMessage error={error}/>{workspace.organization.subscriptionStatus!=='active'&&new Date(workspace.organization.trialEndsAt)<new Date()&&<div className="notice">Your trial has ended. View or export existing data, or activate a subscription in Settings.</div>}<Outlet/></main><footer className="app-footer"><span>Better decisions. Stronger cohorts.</span><span>CohortKit <span className="footer-dot">•</span> Self-hosted</span></footer></div></div>
    {toast&&<div className="toast" role="status">{toast}</div>}
    {selectedApp&&cohort&&<ApplicationModalBridge id={selectedApp} onClose={()=>setSelectedApp(null)}/>}
  </ActionErrorContext.Provider></WorkspaceCtx.Provider>;
}
// Kept separate so opening an application never resets the surrounding queue.
import { ApplicationDetail } from './pages/ApplicationDetail';
function ApplicationModalBridge({id,onClose}:{id:string;onClose:()=>void}) {const {applications}=useWorkspace();const app=applications.find(a=>a.id===id);return app?<ApplicationDetail key={id} application={app} onClose={onClose}/>:null;}
