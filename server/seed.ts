import { defaultCohort, type ApplicantData } from '../shared/domain';
import { hashPassword, digest, token } from './auth';
import { Store, now } from './db';
import { Repository } from './repository';
import { localBrief } from './analysis';

export const demoUsers={admin:'demo-admin',reviewer:'demo-reviewer',committee:'demo-committee'};
export function seed(store:Store) {
  if(store.get('SELECT id FROM organizations LIMIT 1')) return;
  const repo=new Repository(store);
  store.transaction(()=>{
    for(const [id,email,name,platform] of [
      ['demo-admin','alex@example.test','Alex Morgan',1],['demo-reviewer','jordan@example.test','Jordan Lee',0],
      ['demo-reviewer-2','sam@example.test','Sam Rivera',0],['demo-committee','casey@example.test','Casey Chen',0],
    ] as const) store.run('INSERT INTO users VALUES(?,?,?,?,?,?)',id,email,name,hashPassword(token()),platform,now());
    const orgId=repo.createOrg('Cascadia Ventures','cascadia','demo-admin');
    for(const [user,role] of [['demo-reviewer','reviewer'],['demo-reviewer-2','reviewer'],['demo-committee','committee']]) store.run('INSERT INTO memberships VALUES(?,?,?)',orgId,user,role);
    const org=repo.org(orgId,{id:'demo-admin',name:'Alex Morgan',email:'alex@example.test',platformAdmin:true});
    const config={...defaultCohort(),name:'Fall 2026 Accelerator',status:'open' as const,description:'Big ideas. Real momentum. A 12-week accelerator for early-stage founders building a more thoughtful future. Join a community of ambitious builders, get hands-on mentorship, and turn your next milestone into reality.'};
    const cohort=repo.createCohort(org,config,'demo-admin');
    repo.createCohort(org,{...defaultCohort(),name:'Spring 2027 Fellowship',capacity:12},'demo-admin');
    const companies=[
      ['Canopy','Climate tech','MVP','Intelligence for a healthier urban forest.','Helps cities measure tree health and prioritize resilient canopy investment.','12 municipal pilots and 3 annual contracts.'],
      ['Threadwork','Future of work','Revenue','Making frontline knowledge everyone’s advantage.','Turns operational know-how into clear, searchable guidance for field teams.','32 paying teams, $18k monthly recurring revenue.'],
      ['Forma Health','Health tech','Prototype','A clearer path from discharge to recovery.','Coordinates follow-up tasks for care teams and patients after hospital discharge.','Two care teams testing the workflow; clinical outcomes not yet measured.'],
      ['Tidal Grid','Clean energy','MVP','Flexibility for the next generation of energy.','Coordinates distributed batteries to match local demand and renewable supply.','4 commercial pilots with measured peak demand reduction.'],
      ['Common Ground','Agtech','Revenue','Better soil. Better decisions.','Provides small farms with affordable soil intelligence and crop planning tools.','140 farms participating, with 48 paying customers.'],
      ['Parcel','Logistics','MVP','The last mile, working together.','Matches local delivery capacity with independent retailers.','8 retailers piloting across two neighborhoods.'],
      ['Luma Learning','Edtech','Prototype','Make room for every kind of learner.','Helps educators adapt lesson materials for different learning needs.','18 teacher interviews and 3 classroom pilots.'],
      ['Relay Robotics','Robotics','MVP','A helping hand on the factory floor.','Builds modular inspection systems for small manufacturers.','Two manufacturing pilots and a signed design partnership.'],
      ['Northstar','Fintech','Idea','Cash-flow clarity for independent businesses.','Explores scenario planning for small business owners.','35 discovery interviews; product development starts next quarter.'],
      ['Fieldnote','Developer tools','Revenue','The context your engineering team is missing.','Connects incident decisions with documentation and team knowledge.','67 active teams, 12 paid workspaces.'],
      ['Bloom','Consumer','MVP','Neighborhoods with more to share.','Connects neighbors through shared tools and local projects.','900 members across three neighborhood pilots.'],
      ['Arc Materials','Deep tech','Prototype','Giving industrial waste a second beginning.','Develops low-carbon materials from industrial byproducts.','Lab validation underway; no commercial customers yet.'],
    ];
    const founders=['Taylor Brooks','Morgan Ellis','Riley Park','Avery James','Quinn Patel','Cameron Reed'];
    for(let i=0;i<36;i++) {
      const c=companies[i%companies.length]; const suffix=i>=12?` ${['Labs','Systems'][Math.floor(i/12)-1]}`:'';
      const data:ApplicantData={startupName:c[0]+suffix,founderName:founders[i%founders.length],email:`founder${i}@example.test`,industry:c[1],location:['Portland, OR','Seattle, WA','Bend, OR','Eugene, OR'][i%4],companyStage:c[2],answers:{oneliner:c[3],problem:`${c[4]} Current alternatives are fragmented, expensive, and difficult for small teams to adopt. We have spoken directly with potential users to understand the highest-friction parts of their daily work.`,product:c[4]+' Our first product focuses on one measurable, high-value workflow. We combine a thoughtful user experience with domain-specific automation.',team:'A complementary team of three with experience in product, engineering, and the industry. The founders have worked together for two years and are committed full-time.',traction:c[5],fit:'Validate a repeatable go-to-market approach, strengthen our customer feedback loop, and build relationships with other ambitious founders.',website:'https://example.com'},qualifications:{commitment:true},consent:true};
      let app=repo.insertApp(orgId,cohort,data,digest(token()),'submitted');
      const stage=i<18?'screening':i<26?'contenders':i<31?'shortlist':i<34?'interviews':'selection';
      const scrubbed=i<4?null:now(); const pool=i<4?'unassigned':i%5===0?'fringe':i%7===0?'likely_decline':stage==='shortlist'?'shortlist':'contenders';
      store.run('UPDATE applications SET stage_id=?,pool=?,scrubbed_at=?,created_at=?,submitted_at=? WHERE id=?',stage,pool,scrubbed,new Date(Date.now()-(i+1)*7200000).toISOString(),new Date(Date.now()-(i+1)*7200000).toISOString(),app.id);
      if(scrubbed) { app=repo.app(orgId,app.id); const brief=localBrief(app,cohort); brief.approvedAt=now(); brief.approvedBy='demo-admin'; repo.setBrief(app,brief); }
      if(i>=4) for(const reviewer of ['demo-reviewer','demo-reviewer-2']) store.run('INSERT INTO assignments VALUES(?,?,?,?,?,?)',orgId,app.id,reviewer,stage,0,now());
      if(i>=10) for(const [r,reviewer] of ['demo-reviewer','demo-reviewer-2'].entries()) {
        const scores={team:4,market:i%3+3,product:4,traction:i%2+3,fit:4};
        store.run('INSERT INTO reviews(id,org_id,app_id,reviewer_id,stage_id,scores,recommendation,champion,notes,overall,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',`seed-${i}-${r}`,orgId,app.id,reviewer,stage,JSON.stringify(scores),i%7===0?'waitlist':'advance',i===14||i===22?1:0,'Strong starting point. Validate customer evidence in the next round.',3.9,now());
      }
      if(stage==='interviews') store.run('UPDATE applications SET interview=? WHERE id=?',JSON.stringify({status:'scheduled',scheduledAt:new Date(Date.now()+3*86400000+i*3600000).toISOString(),notes:'Explore customer validation and the next product milestone.'}),app.id);
      if(stage==='selection') store.run("UPDATE applications SET outcome='accepted',decision_notes='Selected by the committee after interview.' WHERE id=?",app.id);
    }
    store.audit(orgId,'demo-admin','workspace.seeded',cohort.id,'36 fictional applications for exploring the full workflow.');
  });
}
