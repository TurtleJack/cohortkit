// Captures documentation screenshots against a running demo instance.
// Usage: npm run dev (in one terminal), then: npx tsx scripts/screenshots.ts
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = 'http://localhost:3100';
const out = 'docs/images';
mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Landing / login
  await page.goto(base);
  await page.waitForSelector('.auth-page');
  await page.screenshot({ path: `${out}/login.png` });

  // Demo admin session + cohort slug discovery
  await page.evaluate(async () => {
    await fetch('/api/auth/demo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Origin: location.origin }, body: JSON.stringify({ persona: 'admin' }) });
  });
  const { orgId, cohortSlug } = await page.evaluate(async () => {
    const session = await (await fetch('/api/session', { credentials: 'same-origin' })).json() as { organizations: { id: string }[] };
    const id = session.organizations[0].id;
    const workspace = await (await fetch(`/api/orgs/${id}/workspace`, { credentials: 'same-origin' })).json() as { cohorts: { slug: string }[] };
    return { orgId: id, cohortSlug: workspace.cohorts[0].slug };
  });

  await page.goto(`${base}/workspace/${orgId}/overview`);
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/overview.png` });

  await page.goto(`${base}/workspace/${orgId}/workflow`);
  await page.waitForSelector('.kanban', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/workflow.png` });

  await page.goto(`${base}/workspace/${orgId}/cohort`);
  await page.waitForSelector('.setup-layout', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/cohort-editor.png` });

  await page.goto(`${base}/workspace/${orgId}/review`);
  await page.waitForSelector('.review-welcome', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/review.png` });

  await page.goto(`${base}/apply/cascadia/${cohortSlug}`);
  await page.waitForSelector('.intake-layout', { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/apply-portal.png` });

  await browser.close();
  console.log('Screenshots written to', out);
}

main().catch(e => { console.error(e); process.exit(1); });