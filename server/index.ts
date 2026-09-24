import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { Store } from './db';
import { seed } from './seed';
import { createApi } from './api';
import { createEmailAdapter, flushOutbox, queueDeadlineReminders, pendingEmails } from './email';

if(existsSync('.env'))process.loadEnvFile('.env');
const production=process.env.NODE_ENV==='production';
const port=Number(process.env.PORT||3100);
const host=process.env.HOST||'127.0.0.1';
const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
const demo=process.env.DEMO_MODE==='true'||!production&&process.env.DEMO_MODE!=='false';
if(demo&&(production||!['127.0.0.1','localhost','::1'].includes(host)||!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)))throw new Error('Demo mode must bind to localhost and cannot run in production.');
if(production&&(!origin.startsWith('https://')||demo))throw new Error('Production requires HTTPS APP_ORIGIN and DEMO_MODE=false.');
const store=new Store(process.env.DATABASE_PATH||'./data/cohortkit.db');
if(demo)seed(store);
const email=createEmailAdapter(process.env);
const app=createApi(store,{origin,demo,secure:production,email,aiKey:process.env.OPENAI_API_KEY,aiModel:process.env.OPENAI_MODEL,stripeKey:process.env.STRIPE_SECRET_KEY,stripeWebhookSecret:process.env.STRIPE_WEBHOOK_SECRET,stripePrices:{starter:process.env.STRIPE_STARTER_PRICE_ID,growth:process.env.STRIPE_GROWTH_PRICE_ID}});
if(production){app.use(express.static(resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));}else{const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const server=app.listen(port,host,()=>console.log(`CohortKit is running at ${origin}${demo?' (local synthetic demo)':''} — email via ${email.name}`));
const outboxTimer=setInterval(()=>{void flushOutbox(store,email).catch(()=>{});},15000);
const reminderTimer=setInterval(()=>{try{const n=queueDeadlineReminders(store,origin,48);if(n)console.log(`Queued ${n} deadline reminder email(s)`);}catch{/* reminders are best-effort */}},6*3600000);
const close=()=>{clearInterval(outboxTimer);clearInterval(reminderTimer);server.close(()=>{store.db.close();process.exit(0);});};
process.on('SIGINT',close);process.on('SIGTERM',close);
