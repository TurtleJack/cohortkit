import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import Stripe from 'stripe';
import { applicantSchema, cohortSchema, brandingSchema, roles, modules, pools, outcomes, plans, canManage, canDecide, submissionIssues, weightedScore, currentReviews, type User, type Organization, type Role, type Application, type Cohort, type ApplicantData } from '../shared/domain';
import { Store, id, now } from './db';
import { Repository, type OrgRow, type AppRow } from './repository';
import { assert, HttpError, hashPassword, verifyPassword, token, digest, cookie, issueSession, sessionUser } from './auth';
import { demoUsers } from './seed';
import { localBrief } from './analysis';
import { aiBrief, localProposal, proposeProgramConfig, localFeedback, aiFeedback, localSummary, aiSummary, type AiProvider } from './ai';
import { enqueue, invitationMessage, draftLinkMessage, receiptMessage, decisionMessage, type EmailAdapter, type EmailRow } from './email';

export interface Config { origin: string; demo: boolean; secure: boolean; email: EmailAdapter; aiProvider: AiProvider; stripeKey?:string; stripeWebhookSecret?:string; stripePrices?:Partial<Record<'starter'|'growth',string>> }
type Authed = Request & { user:User; organization:Organization };
const str=(req:Request,key:string)=>String(req.params[key]);
const emailSchema=z.email().max(250).transform(x=>x.toLowerCase());
const passwordSchema=z.string().min(12,'Use at least 12 characters').max(200);
const versionSchema=z.number().int().min(1);
const slugSchema=z.string().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const invitationSchema=z.object({email:emailSchema,name:z.string().trim().min(1).max(120),role:z.enum(['admin','committee','reviewer','founder']),cohortId:z.string().optional()});

export function createApi(store:Store,config:Config) {
  const app=express(); const repo=new Repository(store);
  const stripe=config.stripeKey&&!config.demo?new Stripe(config.stripeKey):null;
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:config.secure?{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}:false,strictTransportSecurity:config.secure?undefined:false}));
  app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
    assert(stripe&&config.stripeWebhookSecret,503,'Billing is not configured');
    let event:Stripe.Event;
    try { event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'] as string,config.stripeWebhookSecret); } catch { throw new HttpError(400,'Invalid webhook signature'); }
    if(store.get('SELECT id FROM webhook_events WHERE id=?',event.id)) {res.json({received:true});return;}
    if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) {
      const received=event.data.object as Stripe.Subscription;
      const sub=event.type==='customer.subscription.deleted'?received:await stripe.subscriptions.retrieve(received.id);
      const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;
      const row=store.get<OrgRow>('SELECT * FROM organizations WHERE stripe_customer_id=?',customer);
      if(row) {
        const price=sub.items.data[0]?.price.id;
        const plan=Object.entries(config.stripePrices||{}).find(([,p])=>p===price)?.[0];
        assert(plan,400,'Unknown subscription price');
        assert(!row.stripe_subscription_id||row.stripe_subscription_id===sub.id,409,'Subscription does not match the organization');
        const status=sub.status==='active'?'active':sub.status==='trialing'?'trialing':sub.status==='canceled'||sub.status==='incomplete_expired'?'canceled':'past_due';
        store.transaction(()=>{
          if(store.get('SELECT id FROM webhook_events WHERE id=?',event.id)) return;
          store.run('UPDATE organizations SET plan=?,subscription_status=?,stripe_subscription_id=?,trial_ends_at=? WHERE id=?',plan,status,sub.id,sub.trial_end?new Date(sub.trial_end*1000).toISOString():row.trial_ends_at,row.id);
          store.audit(row.id,'stripe','subscription.updated',sub.id,status);
          store.run('INSERT INTO webhook_events VALUES(?,?)',event.id,now());
        });
      } else { throw new HttpError(409,'Subscription customer has not been linked to a workspace'); }
    } else store.run('INSERT INTO webhook_events VALUES(?,?) ON CONFLICT(id) DO NOTHING',event.id,now());
    res.json({received:true});
  });
  app.use(express.json({limit:'750kb'}));
  app.use('/api',(req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin=req.headers.origin;
      if(origin&&origin!==config.origin || cookie(req)&&!origin) {res.status(403).json({error:'This request must come from the application origin.'});return;}
      if(!req.is('application/json')) {res.status(415).json({error:'Use application/json.'});return;}
    }
    next();
  });
  const authLimit=rateLimit({windowMs:15*60000,limit:config.demo?200:25,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many attempts. Please try again later.'}});
  const publicLimit=rateLimit({windowMs:15*60000,limit:config.demo?500:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests. Please try again later.'}});
  app.use('/api/auth',authLimit); app.use('/api/public',publicLimit);
  app.get('/api/health',(_req,res)=>res.json({ok:true,demo:config.demo}));
  app.get('/api/session',(req,res)=>{const user=sessionUser(store,req);const organizations=user?store.all<OrgRow&{role:Role}>('SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.created_at',user.id).map(r=>repo.orgDto(r,r.role)):[];res.json({user:user||null,organizations,demo:config.demo});});
  app.post('/api/auth/demo',(req,res)=>{assert(config.demo,404,'Not found'); const {persona}=z.object({persona:z.enum(['admin','reviewer','committee'])}).parse(req.body);assert(store.get('SELECT id FROM users WHERE id=?',demoUsers[persona]),404,'Demo data is not available');issueSession(store,res,demoUsers[persona],false);res.json({ok:true});});
  app.post('/api/auth/login',(req,res)=>{const {email,password}=z.object({email:emailSchema,password:z.string().max(200)}).parse(req.body);const user=store.get<{id:string;password:string}>('SELECT id,password FROM users WHERE email=?',email);assert(user&&verifyPassword(password,user.password),401,'Email or password is incorrect');issueSession(store,res,user.id,config.secure);res.json({ok:true});});
  app.post('/api/auth/logout',(req,res)=>{store.run('DELETE FROM sessions WHERE token_hash=?',digest(cookie(req)));res.clearCookie('aos_session',{path:'/',httpOnly:true,sameSite:'lax',secure:config.secure});res.json({ok:true});});
  app.post('/api/auth/register',(req,res)=>{
    const data=z.object({name:z.string().trim().min(2).max(120),email:emailSchema,password:passwordSchema,organizationName:z.string().trim().min(2).max(120),slug:slugSchema}).parse(req.body);
    assert(!store.get('SELECT id FROM users WHERE email=?',data.email),409,'An account already exists for this email. Sign in instead.');
    assert(!store.get('SELECT id FROM organizations WHERE slug=?',data.slug),409,'That workspace URL is already in use');
    const userId=id(); const orgId=store.transaction(()=>{store.run('INSERT INTO users VALUES(?,?,?,?,?,?)',userId,data.email,data.name,hashPassword(data.password),0,now());return repo.createOrg(data.organizationName,data.slug,userId);});
    issueSession(store,res,userId,config.secure);res.status(201).json({orgId});
  });

  function publicCohort(orgSlug:string,cohortSlug:string) { const org=store.get<OrgRow>('SELECT * FROM organizations WHERE slug=?',orgSlug);assert(org,404,'Program not found');const c=store.get<{id:string}>('SELECT id FROM cohorts WHERE org_id=? AND slug=?',org.id,cohortSlug);assert(c,404,'Program not found');const cohort=repo.cohort(org.id,c.id);assert(cohort.status!=='draft',404,'This program is not published yet');return {org:repo.orgDto(org,'owner'),cohort}; }
  function accepting(org:Organization,cohort:Cohort) { repo.active(org,'intake'); assert(cohort.status==='open'&&cohort.deadline>now(),409,'Applications for this cohort are closed'); }
  app.get('/api/public/:orgSlug/:cohortSlug',(req,res)=>{const {org,cohort}=publicCohort(str(req,'orgSlug'),str(req,'cohortSlug'));res.json({organization:{name:org.name,slug:org.slug,branding:org.branding},cohort:{id:cohort.id,name:cohort.name,description:cohort.description,deadline:cohort.deadline,capacity:cohort.capacity,questions:cohort.questions,qualifications:cohort.qualifications,faqs:cohort.faqs,status:cohort.status,slug:cohort.slug},accepting:cohort.status==='open'&&cohort.deadline>now()&&org.modules.includes('intake')&&(org.subscriptionStatus==='active'||org.subscriptionStatus==='trialing'&&org.trialEndsAt>now())});});
  const draftSchema=applicantSchema.extend({startupName:z.string().trim().min(1).max(150),founderName:z.string().trim().max(120),industry:z.string().trim().max(100),location:z.string().trim().max(120),consent:z.boolean()});
  app.post('/api/public/:orgSlug/:cohortSlug/drafts',(req,res)=>{
    const {org,cohort}=publicCohort(str(req,'orgSlug'),str(req,'cohortSlug'));accepting(org,cohort);
    const data=draftSchema.parse(req.body);const raw=token();
    const application=store.transaction(()=>{
      assert(repo.count('SELECT count(*) n FROM applications WHERE org_id=?',org.id)<plans[org.plan].applications,402,'This program has reached its application limit. Contact the organizer.');
      assert(!store.get('SELECT id FROM applications WHERE cohort_id=? AND email=?',cohort.id,data.email),409,'An application already exists for this email. Use your saved continuation link.');
      return repo.insertApp(org.id,cohort,data as ApplicantData,digest(raw));
    });
    enqueue(store,org.id,{to:data.email,...draftLinkMessage(org.name,cohort.name,`${config.origin}/application/${raw}`)},`draft:${application.id}`);
    res.status(201).json({id:application.id,token:raw});
  });
  function tokenApp(req:Request) { const raw=req.headers.authorization?.replace(/^Bearer /,'');assert(raw,401,'Use your private application link');const row=store.get<AppRow>('SELECT * FROM applications WHERE token_hash=?',digest(raw));assert(row,404,'Application link not found');return repo.appDto(row); }
  app.get('/api/public/application',(req,res)=>{const a=tokenApp(req);store.run('INSERT INTO status_access VALUES(?,?,?,?)',id(),a.orgId,a.id,now());const c=repo.cohort(a.orgId,a.cohortId);const org=store.get<OrgRow>('SELECT * FROM organizations WHERE id=?',a.orgId)!;res.json({application:{id:a.id,startupName:a.startupName,founderName:a.founderName,email:a.email,industry:a.industry,location:a.location,companyStage:a.companyStage,answers:a.answers,qualifications:a.qualifications,consent:a.consent,status:a.status,submittedAt:a.submittedAt,version:a.version},cohortSlug:c.slug,orgSlug:org.slug,cohortName:c.name});});
  app.put('/api/public/application',(req,res)=>{const a=tokenApp(req);const org=repo.orgDto(store.get<OrgRow>('SELECT * FROM organizations WHERE id=?',a.orgId)!,'owner');const c=repo.cohort(a.orgId,a.cohortId);accepting(org,c);assert(a.status==='draft',409,'Submitted applications cannot be edited');const {data,version,submit}=z.object({data:draftSchema,version:versionSchema,submit:z.boolean()}).parse(req.body);assert(a.version===version,409,'This draft was changed in another window. Reload before saving.');assert(data.email===a.email,400,'The application email cannot change');if(submit) {const complete=applicantSchema.parse(data);const issues=submissionIssues(complete,c);assert(!issues.length,400,issues.join('. '));}
    store.transaction(()=>{const result=store.run('UPDATE applications SET data=?,status=?,submitted_at=?,version=version+1 WHERE id=? AND version=?',JSON.stringify(data),submit?'submitted':'draft',submit?now():null,a.id,version);assert(result.changes===1,409,'Application changed. Reload before saving.');if(submit)store.audit(a.orgId,'applicant','application.submitted',a.id,data.startupName);});
    if(submit) {const raw=req.headers.authorization?.replace(/^Bearer /,'')||'';enqueue(store,a.orgId,{to:data.email,...receiptMessage(org.name,c.name,data.startupName,c.deadline,`${config.origin}/application/${raw}`)},`receipt:${a.id}`);}
    res.json({ok:true,version:version+1});});

  app.get('/api/invitations/:token',(req,res)=>{const invitation=store.get<{org_id:string;cohort_id:string|null;name:string;email:string;role:string;expires_at:string;accepted_at:string|null}>('SELECT * FROM invitations WHERE token_hash=?',digest(str(req,'token')));assert(invitation&&!invitation.accepted_at&&invitation.expires_at>now(),404,'This invitation has expired or has already been used');const org=store.get<OrgRow>('SELECT * FROM organizations WHERE id=?',invitation.org_id)!;res.json({organization:org.name,name:invitation.name,email:invitation.email,role:invitation.role,orgSlug:org.slug,cohortSlug:invitation.cohort_id?repo.cohort(org.id,invitation.cohort_id).slug:null});});
  app.post('/api/invitations/:token/accept',authLimit,(req,res)=>{
    const data=z.object({name:z.string().trim().min(2).max(120),password:passwordSchema.optional()}).parse(req.body);
    const user=sessionUser(store,req);
    const result=store.transaction(()=>{
      const invitation=store.get<{id:string;org_id:string;email:string;role:Role|'founder';expires_at:string;accepted_at:string|null}>('SELECT * FROM invitations WHERE token_hash=?',digest(str(req,'token')));assert(invitation&&!invitation.accepted_at&&invitation.expires_at>now(),404,'This invitation has expired or has already been used');assert(invitation.role!=='founder',400,'Use the application link to apply');
      const existing=store.get<{id:string}>('SELECT id FROM users WHERE email=?',invitation.email);
      if(existing) assert(user?.id===existing.id,401,'Sign in to your existing account before accepting this invitation');
      else assert(data.password,400,'Choose a password to create your account');
      const userId=existing?.id||id();
      if(!existing)store.run('INSERT INTO users VALUES(?,?,?,?,?,?)',userId,invitation.email,data.name,hashPassword(data.password!),0,now());
      store.run('INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO NOTHING',invitation.org_id,userId,invitation.role);
      store.run('UPDATE invitations SET accepted_at=? WHERE id=?',now(),invitation.id);store.audit(invitation.org_id,userId,'invitation.accepted',invitation.id,invitation.role);return {userId,orgId:invitation.org_id};
    });issueSession(store,res,result.userId,config.secure);res.json(result);
  });

  const requireUser=(req:Request,_res:Response,next:NextFunction)=>{const user=sessionUser(store,req);assert(user,401,'Please sign in');(req as Authed).user=user;next();};
  app.use('/api/orgs',requireUser);
  app.post('/api/orgs',(req,res)=>{const user=(req as Authed).user;const data=z.object({name:z.string().trim().min(2).max(120),slug:slugSchema}).parse(req.body);assert(!store.get('SELECT id FROM organizations WHERE slug=?',data.slug),409,'Workspace URL is already in use');const orgId=store.transaction(()=>repo.createOrg(data.name,data.slug,user.id));res.status(201).json({orgId});});
  app.use('/api/orgs/:orgId',(req:Request,_res:Response,next:NextFunction)=>{(req as Authed).organization=repo.org(str(req,'orgId'),(req as Authed).user);next();});
  const ctx=(req:Request)=>{const {user,organization:org}=req as Authed;return {user,org};};
  const manage=(req:Request)=>{const c=ctx(req);assert(canManage(c.org.role),403,'An administrator is required');return c;};
  const decide=(req:Request)=>{const c=ctx(req);assert(canDecide(c.org.role),403,'Committee access is required');return c;};
  const appContext=(req:Request)=>{const c=ctx(req);const application=repo.app(c.org.id,str(req,'appId'));const cohort=repo.cohort(c.org.id,application.cohortId);return {...c,application,cohort};};
  const reviewerAccess=(req:Request)=>{const c=appContext(req);if(!canDecide(c.org.role)) assert(repo.reviewerVisible(c.application,c.cohort,c.user),404,'Application is not available in your review queue');return c;};

  app.get('/api/orgs/:orgId/workspace',(req,res)=>{
    const {user,org}=ctx(req);const manager=canManage(org.role);
    const members=store.all<{id:string;name:string;email:string;role:Role}>('SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.org_id=?',org.id).filter(m=>canDecide(org.role)||m.id===user.id).map(m=>({...m,email:manager?m.email:'',assignments:repo.count('SELECT count(*) n FROM assignments x JOIN applications a ON a.id=x.app_id WHERE x.org_id=? AND x.reviewer_id=? AND x.recused=0 AND x.stage_id=a.stage_id AND a.outcome IS NULL',org.id,m.id),completed:repo.count('SELECT count(*) n FROM reviews WHERE org_id=? AND reviewer_id=?',org.id,m.id)}));
    const invitations=manager?store.all<{id:string;email:string;name:string;role:string;cohort_id:string|null;expires_at:string;accepted_at:string|null;created_at:string}>('SELECT * FROM invitations WHERE org_id=? ORDER BY created_at DESC LIMIT 100',org.id).map(i=>({id:i.id,email:i.email,name:i.name,role:i.role,cohortId:i.cohort_id,expiresAt:i.expires_at,acceptedAt:i.accepted_at,createdAt:i.created_at})):[];
    const audits=canDecide(org.role)?store.all<{id:string;actor:string;action:string;target_id:string;detail:string;created_at:string}>('SELECT a.id,COALESCE(u.name,a.actor) actor,a.action,a.target_id,a.detail,a.created_at FROM audit_events a LEFT JOIN users u ON u.id=a.actor WHERE a.org_id=? ORDER BY a.created_at DESC LIMIT 100',org.id).map(a=>({id:a.id,actor:a.actor,action:a.action,targetId:a.target_id,detail:a.detail,createdAt:a.created_at})):[];
    res.json({organization:org,cohorts:repo.cohorts(org.id),members,invitations,audits,usage:{applications:repo.count('SELECT count(*) n FROM applications WHERE org_id=?',org.id),reviewers:repo.count("SELECT count(*) n FROM memberships WHERE org_id=? AND role<>'owner'",org.id),cohorts:repo.cohorts(org.id).length},integrations:{ai:config.aiProvider.available&&!config.demo,billing:!!stripe}});
  });
  app.patch('/api/orgs/:orgId/settings',(req,res)=>{const {user,org}=manage(req);const data=z.object({name:z.string().trim().min(2).max(120),modules:z.array(z.enum(modules)).min(1).refine(x=>new Set(x).size===x.length),branding:brandingSchema}).parse(req.body);store.transaction(()=>{store.run('UPDATE organizations SET name=?,modules=?,branding=? WHERE id=?',data.name,JSON.stringify(data.modules),JSON.stringify(data.branding),org.id);store.audit(org.id,user.id,'organization.settings_updated',org.id);});res.json({ok:true});});
  app.post('/api/orgs/:orgId/cohorts',(req,res)=>{const {user,org}=manage(req);repo.active(org);const data=cohortSchema.parse(req.body);const cohort=store.transaction(()=>repo.createCohort(org,data,user.id));res.status(201).json(cohort);});
  app.put('/api/orgs/:orgId/cohorts/:cohortId',(req,res)=>{
    const {user,org}=manage(req);repo.active(org);const old=repo.cohort(org.id,str(req,'cohortId'));const {config:next,version}=z.object({config:cohortSchema,version:versionSchema}).parse(req.body);assert(old.version===version,409,'Cohort changed. Reload before saving.');
    const count=repo.count('SELECT count(*) n FROM applications WHERE org_id=? AND cohort_id=?',org.id,old.id);
    if(count) { assert(JSON.stringify(old.questions)===JSON.stringify(next.questions)&&JSON.stringify(old.qualifications)===JSON.stringify(next.qualifications),409,'Intake questions and qualifications are locked once a draft exists. Create a new cohort to change them.');assert(JSON.stringify(old.rubric)===JSON.stringify(next.rubric)&&JSON.stringify(old.stages)===JSON.stringify(next.stages),409,'Rubric and workflow are locked once a draft exists so scores stay comparable.'); }
    const accepted=repo.count("SELECT count(*) n FROM applications WHERE org_id=? AND cohort_id=? AND outcome='accepted'",org.id,old.id);assert(next.capacity>=accepted,409,'Capacity cannot be lower than the number already accepted');
    store.transaction(()=>{store.run('UPDATE cohorts SET config=?,version=version+1 WHERE org_id=? AND id=? AND version=?',JSON.stringify(next),org.id,old.id,version);store.audit(org.id,user.id,'cohort.updated',old.id,next.name);});res.json(repo.cohort(org.id,old.id));
  });
  app.get('/api/orgs/:orgId/cohorts/:cohortId/applications',(req,res)=>{const {user,org}=ctx(req);const cohort=repo.cohort(org.id,str(req,'cohortId'));let apps=store.all<AppRow>('SELECT * FROM applications WHERE org_id=? AND cohort_id=? ORDER BY submitted_at DESC,created_at DESC',org.id,cohort.id).map(a=>repo.appDto(a));if(!canDecide(org.role))apps=apps.filter(a=>repo.reviewerVisible(a,cohort,user)).map(a=>repo.reviewerDto(a,cohort,user));res.json(apps);});
  app.get('/api/orgs/:orgId/applications/:appId',(req,res)=>{const {application,cohort,org,user}=reviewerAccess(req);res.json(canDecide(org.role)?application:repo.reviewerDto(application,cohort,user));});

  app.post('/api/orgs/:orgId/invitations',(req,res)=>{
    const {user,org}=manage(req);repo.active(org);const data=invitationSchema.parse(req.body);if(data.role==='founder'){assert(data.cohortId,400,'Choose a cohort');repo.cohort(org.id,data.cohortId);}else assert(!data.cohortId,400,'Reviewer invitations are workspace-wide');
    const raw=token();const inviteId=id();
    store.transaction(()=>{
      if(data.role!=='founder') {
        assert(!store.get('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=? AND u.email=?',org.id,data.email),409,'This person already belongs to the workspace');
        const occupied=repo.count("SELECT count(*) n FROM memberships WHERE org_id=? AND role<>'owner'",org.id)+repo.count("SELECT count(*) n FROM invitations WHERE org_id=? AND role<>'founder' AND accepted_at IS NULL AND expires_at>?",org.id,now());assert(occupied<plans[org.plan].reviewers,402,'Team seat limit reached. Pending invitations reserve seats.');
      }
      assert(!store.get('SELECT id FROM invitations WHERE org_id=? AND email=? AND role=? AND accepted_at IS NULL AND expires_at>?',org.id,data.email,data.role,now()),409,'An active invitation already exists. Revoke it before creating a replacement.');
      store.run('INSERT INTO invitations VALUES(?,?,?,?,?,?,?,?,?,?)',inviteId,org.id,data.email,data.name,data.role,data.cohortId||null,digest(raw),new Date(Date.now()+7*86400000).toISOString(),null,now());store.audit(org.id,user.id,'invitation.created',inviteId,`${data.role}: ${data.email}`);
    });
    const url=`${config.origin}/invite/${raw}`;
    enqueue(store,org.id,{to:data.email,...invitationMessage(org.name,data.role,url)},`invite:${inviteId}`);
    res.status(201).json({id:inviteId,url,delivery:'link',message:'Invitation created. Copy the private link and share it with the recipient.'});
  });
  app.delete('/api/orgs/:orgId/invitations/:inviteId',(req,res)=>{const {user,org}=manage(req);const result=store.run('UPDATE invitations SET expires_at=? WHERE org_id=? AND id=? AND accepted_at IS NULL',now(),org.id,str(req,'inviteId'));assert(result.changes,404,'Pending invitation not found');store.audit(org.id,user.id,'invitation.revoked',str(req,'inviteId'));res.json({ok:true});});
  app.get('/api/orgs/:orgId/emails',(req,res)=>{const {org}=manage(req);const rows=store.all<EmailRow>('SELECT * FROM emails WHERE org_id=? ORDER BY created_at DESC LIMIT 100',org.id);res.json(rows.map(r=>({id:r.id,to:r.email_to,subject:r.subject,status:r.status,provider:r.provider,error:r.error,attempts:r.attempts,createdAt:r.created_at,sentAt:r.sent_at})));});
  app.get('/api/orgs/:orgId/applications/:appId/access',(req,res)=>{const {org}=manage(req);const app=repo.app(org.id,str(req,'appId'));const row=store.get<{n:number}>('SELECT count(*) n FROM status_access WHERE org_id=? AND app_id=?',org.id,app.id);const last=store.get<{created_at:string}>('SELECT created_at FROM status_access WHERE org_id=? AND app_id=? ORDER BY created_at DESC LIMIT 1',org.id,app.id);res.json({count:row?.n||0,lastAt:last?.created_at||null});});
  app.patch('/api/orgs/:orgId/members/:memberId',(req,res)=>{const {user,org}=manage(req);const {role}=z.object({role:z.enum(['admin','committee','reviewer'])}).parse(req.body);const existing=store.get<{role:Role}>('SELECT role FROM memberships WHERE org_id=? AND user_id=?',org.id,str(req,'memberId'));assert(existing,404,'Member not found');assert(existing.role!=='owner',403,'Workspace owner role cannot be changed');assert(org.role==='owner',403,'Only the owner can change team roles');store.transaction(()=>{store.run('UPDATE memberships SET role=? WHERE org_id=? AND user_id=?',role,org.id,str(req,'memberId'));store.audit(org.id,user.id,'member.role_changed',str(req,'memberId'),role);});res.json({ok:true});});

  app.post('/api/orgs/:orgId/cohorts/:cohortId/assignments',(req,res)=>{
    const {user,org}=manage(req);repo.active(org,'review');const cohort=repo.cohort(org.id,str(req,'cohortId'));
    const data=z.object({reviewerIds:z.array(z.string()).min(1).max(50),appIds:z.array(z.string()).max(500).optional(),perApplication:z.number().int().min(1).max(10),batchSize:z.number().int().min(1).max(500).optional()}).parse(req.body);
    const reviewers=[...new Set(data.reviewerIds)];for(const r of reviewers) assert(store.get('SELECT user_id FROM memberships WHERE org_id=? AND user_id=?',org.id,r),400,'Every reviewer must belong to this workspace');
    let candidates=store.all<AppRow>("SELECT * FROM applications WHERE org_id=? AND cohort_id=? AND status='submitted' AND scrubbed_at IS NOT NULL AND outcome IS NULL ORDER BY submitted_at",org.id,cohort.id).map(r=>repo.appDto(r));
    if(data.appIds){assert(data.appIds.every(x=>candidates.some(a=>a.id===x)),400,'Only scrubbed, undecided applications in this cohort can be assigned');candidates=candidates.filter(a=>data.appIds!.includes(a.id));}
    const loads=new Map(reviewers.map(r=>[r,repo.count('SELECT count(*) n FROM assignments x JOIN applications a ON a.id=x.app_id WHERE x.org_id=? AND x.reviewer_id=? AND x.recused=0 AND x.stage_id=a.stage_id AND a.outcome IS NULL',org.id,r)]));let added=0;
    store.transaction(()=>{for(const a of candidates.sort((a,b)=>a.assignedReviewerIds.length-b.assignedReviewerIds.length)) {
      const occupied=new Set([...a.assignedReviewerIds,...a.recusedReviewerIds]);let count=a.assignedReviewerIds.length;
      for(const r of [...reviewers].sort((x,y)=>loads.get(x)!-loads.get(y)!||x.localeCompare(y))) {if(count>=data.perApplication||added>=(data.batchSize||500))break;if(occupied.has(r))continue;store.run('INSERT INTO assignments VALUES(?,?,?,?,?,?)',org.id,a.id,r,a.stageId,0,now());loads.set(r,loads.get(r)!+1);occupied.add(r);added++;count++;}
    }store.audit(org.id,user.id,'assignments.created',cohort.id,`${added} assignments; target ${data.perApplication} reviewers per application`);});res.json({added,shortfall:candidates.reduce((n,a)=>n+Math.max(0,data.perApplication-repo.app(org.id,a.id).assignedReviewerIds.length),0)});
  });
  app.post('/api/orgs/:orgId/applications/:appId/scrub',(req,res)=>{const {user,org}=manage(req);repo.active(org,'intake');const {application:a,cohort}=appContext(req);const {notes,version}=z.object({notes:z.string().trim().min(1,'Record your eligibility check').max(4000),version:versionSchema}).parse(req.body);assert(a.status==='submitted'&&!a.outcome,409,'Only submitted, undecided applications can be scrubbed');assert(a.version===version,409,'Application changed. Reload before continuing.');const issues=submissionIssues(a,cohort);assert(!issues.length,400,issues.join('. '));store.transaction(()=>{store.run('UPDATE applications SET scrubbed_at=?,scrub_notes=?,version=version+1 WHERE org_id=? AND id=?',now(),notes,org.id,a.id);store.audit(org.id,user.id,'application.scrubbed',a.id,notes);});res.json({ok:true});});
  const aiInFlight=new Set<string>();
  app.post('/api/orgs/:orgId/applications/:appId/brief',async(req,res)=>{
    const {user,org}=manage(req);repo.active(org,'ai');const {application:a,cohort}=appContext(req);const {source}=z.object({source:z.enum(['local','openai'])}).parse(req.body);assert(a.scrubbedAt&&!a.outcome,409,'Scrub this application before generating its brief');assert(!aiInFlight.has(a.id),409,'A brief is already being generated');assert(source==='local'||config.aiProvider.available&&!config.demo,503,'Live AI is not configured for this workspace');
    aiInFlight.add(a.id);
    try { const brief=source==='local'?localBrief(a,cohort):await aiBrief(a,cohort,config.aiProvider);store.transaction(()=>{const latest=repo.app(org.id,a.id);assert(latest.version===a.version,409,'Application changed during generation. Please try again.');repo.setBrief(a,brief);store.audit(org.id,user.id,'brief.generated',a.id,source);});res.json({ok:true}); } finally {aiInFlight.delete(a.id);}
  });
  app.post('/api/orgs/:orgId/applications/:appId/brief/approve',(req,res)=>{const {user,org}=manage(req);repo.active(org,'ai');const {application:a}=appContext(req);const {version}=z.object({version:versionSchema}).parse(req.body);assert(a.version===version,409,'Application changed. Reload before approval.');assert(a.brief,409,'Generate a brief first');store.transaction(()=>{repo.setBrief(a,{...a.brief!,approvedAt:now(),approvedBy:user.id});store.audit(org.id,user.id,'brief.approved',a.id);});res.json({ok:true});});

  // --- AI-assisted setup, feedback, and summaries ---
  const proposeInFlight=new Set<string>();
  app.post('/api/orgs/:orgId/cohorts/propose',async(req,res)=>{
    const {user,org}=manage(req);repo.active(org,'ai');
    const {description}=z.object({description:z.string().trim().min(20).max(4000)}).parse(req.body);
    assert(!proposeInFlight.has(org.id),409,'A proposal is already being generated');
    proposeInFlight.add(org.id);
    try {
      const useLive=config.aiProvider.available&&!config.demo;
      const proposal=useLive?await proposeProgramConfig(description,config.aiProvider):localProposal(description);
      store.audit(org.id,user.id,'ai.proposal_generated',org.id,useLive?'openai':'local');
      res.json({source:useLive?'openai':'local',proposal});
    } finally { proposeInFlight.delete(org.id); }
  });
  const feedbackInFlight=new Set<string>();
  app.post('/api/orgs/:orgId/applications/:appId/feedback',async(req,res)=>{
    const {user,org}=manage(req);repo.active(org,'ai');const {application:a,cohort}=appContext(req);
    const {version}=z.object({version:versionSchema}).parse(req.body);
    assert(a.version===version,409,'Application changed. Reload before generating.');
    assert(a.outcome==='rejected'||a.outcome==='waitlist',409,'Feedback drafts are for declined or waitlisted applications');
    assert(!feedbackInFlight.has(a.id),409,'Feedback is already being generated');
    feedbackInFlight.add(a.id);
    try {
      const useLive=config.aiProvider.available&&!config.demo;
      const draft=useLive?await aiFeedback(a,cohort,a.outcome,config.aiProvider):localFeedback(a,a.outcome);
      store.transaction(()=>{const latest=repo.app(org.id,a.id);assert(latest.version===a.version,409,'Application changed during generation. Please try again.');store.run('UPDATE applications SET feedback=?,version=version+1 WHERE org_id=? AND id=?',JSON.stringify(draft),org.id,a.id);store.audit(org.id,user.id,'feedback.generated',a.id,draft.source);});
      res.json({ok:true});
    } finally { feedbackInFlight.delete(a.id); }
  });
  app.post('/api/orgs/:orgId/applications/:appId/feedback/approve',(req,res)=>{
    const {user,org}=manage(req);repo.active(org,'ai');const {application:a}=appContext(req);
    const {version}=z.object({version:versionSchema}).parse(req.body);
    assert(a.version===version,409,'Application changed. Reload before approving.');
    assert(a.feedback&&!a.feedback.approvedAt,409,'Generate a feedback draft first');
    store.transaction(()=>{store.run('UPDATE applications SET feedback=? WHERE org_id=? AND id=?',JSON.stringify({...a.feedback,approvedAt:now()}),org.id,a.id);store.audit(org.id,user.id,'feedback.approved',a.id);});
    res.json({ok:true});
  });
  const summaryInFlight=new Set<string>();
  app.post('/api/orgs/:orgId/cohorts/:cohortId/summary',async(req,res)=>{
    const {user,org}=decide(req);repo.active(org,'ai');const cohort=repo.cohort(org.id,str(req,'cohortId'));
    assert(!summaryInFlight.has(cohort.id),409,'A summary is already being generated');
    const apps=store.all<AppRow>("SELECT * FROM applications WHERE org_id=? AND cohort_id=? AND status='submitted'",org.id,cohort.id).map(r=>repo.appDto(r));
    summaryInFlight.add(cohort.id);
    try {
      const useLive=config.aiProvider.available&&!config.demo;
      const draft=useLive?await aiSummary(cohort,apps,config.aiProvider):localSummary(cohort,apps);
      store.run('UPDATE cohorts SET summary=? WHERE org_id=? AND id=?',JSON.stringify(draft),org.id,cohort.id);
      store.audit(org.id,user.id,'ai.summary_generated',cohort.id,draft.source);
      res.json({ok:true});
    } finally { summaryInFlight.delete(cohort.id); }
  });
  app.post('/api/orgs/:orgId/cohorts/:cohortId/summary/approve',(req,res)=>{
    const {user,org}=decide(req);repo.active(org,'ai');const cohort=repo.cohort(org.id,str(req,'cohortId'));
    assert(cohort.summary&&!cohort.summary.approvedAt,409,'Generate a summary first');
    store.run('UPDATE cohorts SET summary=? WHERE org_id=? AND id=?',JSON.stringify({...cohort.summary,approvedAt:now()}),org.id,cohort.id);
    store.audit(org.id,user.id,'ai.summary_approved',cohort.id);
    res.json({ok:true});
  });
  app.post('/api/orgs/:orgId/applications/:appId/pool',(req,res)=>{const {user,org}=manage(req);repo.active(org,'review');const {application:a}=appContext(req);const {pool,version}=z.object({pool:z.enum(pools),version:versionSchema}).parse(req.body);assert(a.version===version,409,'Application changed. Reload before continuing.');assert(a.scrubbedAt&&!a.outcome,409,'Scrub this application before placing it in a pool');store.transaction(()=>{store.run('UPDATE applications SET pool=?,version=version+1 WHERE org_id=? AND id=?',pool,org.id,a.id);store.audit(org.id,user.id,'application.pool_changed',a.id,pool);});res.json({ok:true});});

  app.put('/api/orgs/:orgId/applications/:appId/review',(req,res)=>{
    const {user,org,application:a,cohort}=reviewerAccess(req);repo.active(org,'review');
    const data=z.object({stageId:z.string(),version:z.number().int().min(0),scores:z.record(z.string(),z.number().int().min(1).max(5)),recommendation:z.enum(['advance','waitlist','reject']),champion:z.boolean(),notes:z.string().trim().max(8000)}).parse(req.body);
    assert(a.status==='submitted'&&a.scrubbedAt&&!a.outcome,409,'This application is not open for review');assert(!a.recusedReviewerIds.includes(user.id),403,'You have declared a conflict for this review');assert(data.stageId===a.stageId,409,'Application moved to a new round. Reload your queue.');
    assert(Object.keys(data.scores).length===cohort.rubric.length&&cohort.rubric.every(c=>data.scores[c.id]),400,'Rate every rubric category before saving');assert(!data.champion||data.recommendation==='advance',400,'A Champion must also be an Advance recommendation');
    const reviewId=store.transaction(()=>{
      const existing=store.get<{id:string;version:number}>('SELECT id,version FROM reviews WHERE org_id=? AND app_id=? AND reviewer_id=? AND stage_id=?',org.id,a.id,user.id,a.stageId);assert((existing?.version||0)===data.version,409,'This review changed in another window. Reload before saving.');
      if(data.champion) {const champions=repo.count('SELECT count(DISTINCT r.app_id) n FROM reviews r JOIN applications a ON a.id=r.app_id WHERE r.org_id=? AND a.cohort_id=? AND r.reviewer_id=? AND r.champion=1 AND r.app_id<>?',org.id,cohort.id,user.id,a.id);assert(champions<cohort.championLimit,409,`You can champion up to ${cohort.championLimit} applications in this cohort`);}
      const reviewId=existing?.id||id();
      store.run('INSERT INTO reviews(id,org_id,app_id,reviewer_id,stage_id,scores,recommendation,champion,notes,overall,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id,reviewer_id,stage_id) DO UPDATE SET scores=excluded.scores,recommendation=excluded.recommendation,champion=excluded.champion,notes=excluded.notes,overall=excluded.overall,version=excluded.version',reviewId,org.id,a.id,user.id,a.stageId,JSON.stringify(data.scores),data.recommendation,data.champion?1:0,data.notes,weightedScore(data.scores,cohort.rubric),data.version+1,now());
      store.run('INSERT INTO assignments VALUES(?,?,?,?,?,?) ON CONFLICT(app_id,reviewer_id,stage_id) DO NOTHING',org.id,a.id,user.id,a.stageId,0,now());store.audit(org.id,user.id,'review.saved',a.id,`${a.stageId}: ${data.recommendation}${data.champion?' + champion':''}`);return reviewId;
    });res.json({id:reviewId,version:data.version+1});
  });
  app.post('/api/orgs/:orgId/applications/:appId/recuse',(req,res)=>{const {user,org,application:a}=reviewerAccess(req);repo.active(org,'review');const {reason}=z.object({reason:z.string().trim().min(3).max(1000)}).parse(req.body);store.transaction(()=>{store.run('INSERT INTO assignments VALUES(?,?,?,?,?,?) ON CONFLICT(app_id,reviewer_id,stage_id) DO UPDATE SET recused=1',org.id,a.id,user.id,a.stageId,1,now());store.run('DELETE FROM reviews WHERE org_id=? AND app_id=? AND reviewer_id=? AND stage_id=?',org.id,a.id,user.id,a.stageId);store.audit(org.id,user.id,'review.recused',a.id,reason);});res.json({ok:true});});
  app.post('/api/orgs/:orgId/applications/:appId/stage',(req,res)=>{
    const {user,org}=decide(req);repo.active(org,'review');const {application:a,cohort}=appContext(req);const data=z.object({stageId:z.string(),version:versionSchema,reason:z.string().trim().min(3).max(3000),override:z.boolean().default(false)}).parse(req.body);assert(a.version===data.version,409,'Application changed. Reload before moving it.');assert(a.scrubbedAt&&!a.outcome,409,'Only scrubbed, undecided applications can move between stages');
    const from=cohort.stages.findIndex(s=>s.id===a.stageId);const to=cohort.stages.findIndex(s=>s.id===data.stageId);assert(to>=0&&to!==from,400,'Choose a different workflow stage');
    const coverage=currentReviews(a).length>=cohort.stages[from].minReviews;
    if(to!==from+1||!coverage) assert(data.override&&canManage(org.role),409,'This move needs an administrator override because it skips a stage or lacks required reviews');
    store.transaction(()=>{store.run('UPDATE applications SET stage_id=?,version=version+1 WHERE org_id=? AND id=?',data.stageId,org.id,a.id);store.audit(org.id,user.id,'application.stage_changed',a.id,`${a.stageId} → ${data.stageId}${data.override?' (override)':''}: ${data.reason}`);});res.json({ok:true});
  });
  app.post('/api/orgs/:orgId/applications/:appId/interview',(req,res)=>{const {user,org}=decide(req);repo.active(org,'review');const {application:a}=appContext(req);const {version,...interview}=z.object({status:z.enum(['none','ready','invited','scheduled','completed','no_show','canceled']),scheduledAt:z.string().max(50),notes:z.string().trim().max(8000),version:versionSchema}).parse(req.body);assert(a.version===version&&!a.outcome,409,'Application changed or has a final decision');if(interview.status==='scheduled')assert(z.iso.datetime().safeParse(interview.scheduledAt).success,400,'Choose a valid interview date and time');store.transaction(()=>{store.run('UPDATE applications SET interview=?,version=version+1 WHERE org_id=? AND id=?',JSON.stringify(interview),org.id,a.id);store.audit(org.id,user.id,'interview.updated',a.id,interview.status);});res.json({ok:true});});
  app.post('/api/orgs/:orgId/applications/:appId/decision',(req,res)=>{const {user,org}=decide(req);repo.active(org,'review');const {application:a,cohort}=appContext(req);const data=z.object({outcome:z.enum(outcomes),notes:z.string().trim().min(3).max(8000),version:versionSchema,override:z.boolean().default(false)}).parse(req.body);assert(a.version===data.version&&!a.outcome,409,'Application changed or already has a decision');assert(a.status==='submitted',409,'Drafts cannot receive a decision');if(a.stageId!==cohort.stages.at(-1)!.id||!a.scrubbedAt)assert(data.override&&canManage(org.role),409,'Move to final selection first, or record an administrator override');store.transaction(()=>{if(data.outcome==='accepted'){const n=repo.count("SELECT count(*) n FROM applications WHERE org_id=? AND cohort_id=? AND outcome='accepted'",org.id,cohort.id);assert(n<cohort.capacity,409,'Cohort is full. Increase capacity or waitlist this application.');}store.run('UPDATE applications SET outcome=?,decision_notes=?,version=version+1 WHERE org_id=? AND id=?',data.outcome,data.notes,org.id,a.id);store.audit(org.id,user.id,'decision.recorded',a.id,`${data.outcome}${data.override?' (override)':''}: ${data.notes}`);});
  const latest=repo.app(org.id,a.id);
  enqueue(store,org.id,{to:latest.email,...decisionMessage(org.name,cohort.name,latest.startupName,data.outcome,data.notes,latest.feedback?.approvedAt?latest.feedback.text:'')},`decision:${a.id}`);
  res.json({ok:true});});
  app.post('/api/orgs/:orgId/applications/:appId/reopen',(req,res)=>{const {user,org}=manage(req);repo.active(org,'review');const {application:a}=appContext(req);const data=z.object({reason:z.string().trim().min(3).max(3000),version:versionSchema}).parse(req.body);assert(a.version===data.version&&a.outcome,409,'Application changed or has no final decision');store.transaction(()=>{store.run('UPDATE applications SET outcome=NULL,decision_notes=?,version=version+1 WHERE org_id=? AND id=?',`Reopened: ${data.reason}`,org.id,a.id);store.audit(org.id,user.id,'decision.reopened',a.id,data.reason);});res.json({ok:true});});
  app.get('/api/orgs/:orgId/cohorts/:cohortId/export',(req,res)=>{const {org}=decide(req);const c=repo.cohort(org.id,str(req,'cohortId'));const rows=store.all<AppRow>("SELECT * FROM applications WHERE org_id=? AND cohort_id=? AND status='submitted'",org.id,c.id).map(r=>repo.appDto(r));const cell=(x:unknown)=>`"${String(x??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;const csv=[['Startup','Founder','Email','Industry','Stage','Pool','Reviews','Score','Champions','Final decision'],...rows.map(a=>{const rs=currentReviews(a);return[a.startupName,a.founderName,a.email,a.industry,a.stageId,a.pool,rs.length,rs.length?(rs.reduce((n,r)=>n+r.overall,0)/rs.length).toFixed(2):'',rs.filter(r=>r.champion).length,a.outcome||''];})].map(r=>r.map(cell).join(',')).join('\r\n');res.set('Content-Disposition',`attachment; filename="${c.slug}-applications.csv"`).type('text/csv').send(csv);});

  app.post('/api/orgs/:orgId/billing/checkout',async(req,res)=>{const {org}=ctx(req);assert(org.role==='owner',403,'Only the workspace owner can manage billing');assert(stripe,503,'Stripe is not configured. No payment has been taken.');const {plan}=z.object({plan:z.enum(['starter','growth'])}).parse(req.body);const price=config.stripePrices?.[plan];assert(price,503,'This plan does not have a configured Stripe price');let row=store.get<OrgRow>('SELECT * FROM organizations WHERE id=?',org.id)!;assert(!row.stripe_subscription_id,409,'Manage your existing subscription in the billing portal');if(!row.stripe_customer_id){const customer=await stripe.customers.create({name:org.name,metadata:{orgId:org.id}},{idempotencyKey:`org-customer-${org.id}`});store.run('UPDATE organizations SET stripe_customer_id=? WHERE id=?',customer.id,org.id);row={...row,stripe_customer_id:customer.id};}const session=await stripe.checkout.sessions.create({customer:row.stripe_customer_id!,mode:'subscription',line_items:[{price,quantity:1}],subscription_data:{metadata:{orgId:org.id}},success_url:`${config.origin}/workspace/${org.id}/settings?billing=success`,cancel_url:`${config.origin}/workspace/${org.id}/settings?billing=canceled`},{idempotencyKey:`checkout-${org.id}-${plan}-${Math.floor(Date.now()/300000)}`});res.json({url:session.url});});
  app.post('/api/orgs/:orgId/billing/portal',async(req,res)=>{const {org}=ctx(req);assert(org.role==='owner',403,'Only the workspace owner can manage billing');assert(stripe,503,'Stripe is not configured');const row=store.get<OrgRow>('SELECT * FROM organizations WHERE id=?',org.id)!;assert(row.stripe_customer_id,409,'Start a subscription before opening the billing portal');const session=await stripe.billingPortal.sessions.create({customer:row.stripe_customer_id,return_url:`${config.origin}/workspace/${org.id}/settings`});res.json({url:session.url});});
  app.get('/api/platform',requireUser,(req,res)=>{assert((req as Authed).user.platformAdmin,403,'Platform administrator access required');res.json(store.all<OrgRow>('SELECT * FROM organizations ORDER BY created_at DESC').map(r=>({...repo.orgDto(r,'owner'),applications:repo.count('SELECT count(*) n FROM applications WHERE org_id=?',r.id),members:repo.count('SELECT count(*) n FROM memberships WHERE org_id=?',r.id)})));});
  app.post('/api/platform/organizations',requireUser,(req,res)=>{const user=(req as Authed).user;assert(user.platformAdmin,403,'Platform administrator access required');const data=z.object({name:z.string().trim().min(2).max(120),slug:slugSchema,ownerEmail:emailSchema,ownerName:z.string().trim().min(2).max(120)}).parse(req.body);assert(!store.get('SELECT id FROM organizations WHERE slug=?',data.slug),409,'Workspace URL is already in use');const raw=token();const orgId=store.transaction(()=>{const orgId=repo.createOrg(data.name,data.slug,user.id);store.run('INSERT INTO invitations VALUES(?,?,?,?,?,?,?,?,?,?)',id(),orgId,data.ownerEmail,data.ownerName,'owner',null,digest(raw),new Date(Date.now()+7*86400000).toISOString(),null,now());store.audit(orgId,user.id,'organization.provisioned',orgId,`Owner invitation: ${data.ownerEmail}`);return orgId;});res.status(201).json({orgId,url:`${config.origin}/invite/${raw}`,delivery:'link'});});

  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found'}));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(error instanceof ZodError){res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});return;}
    if(error instanceof HttpError){res.status(error.status).json({error:error.message});return;}
    if(error instanceof SyntaxError){res.status(400).json({error:'Invalid JSON request'});return;}
    console.error('API request failed:',error instanceof Error?error.message:'Unknown error');res.status(500).json({error:'The request could not be completed. Please try again.'});
  });
  return app;
}
