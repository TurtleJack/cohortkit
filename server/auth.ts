import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { User } from '../shared/domain';
import { Store, now } from './db';
export function hashPassword(password: string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password: string, hash: string) { const [salt,key]=hash.split(':'); if (!salt || !key) return false; const expected=Buffer.from(key,'hex'); const actual=scryptSync(password,salt,64); return expected.length===actual.length && timingSafeEqual(expected,actual); }
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function cookie(req: Request) { return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('aos_session='))?.slice(12)||''; }
export function sessionUser(store: Store, req: Request): User|undefined { const raw=cookie(req); if(!raw) return; const row=store.get<{id:string;email:string;name:string;platform_admin:number}>('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',digest(raw),now()); return row && {id:row.id,email:row.email,name:row.name,platformAdmin:!!row.platform_admin}; }
export function issueSession(store: Store, res: Response, userId: string, secure: boolean) { const raw=token(); store.run('DELETE FROM sessions WHERE expires_at<?',now()); store.run('INSERT INTO sessions VALUES(?,?,?)',digest(raw),userId,new Date(Date.now()+7*86400000).toISOString()); res.cookie('aos_session',raw,{httpOnly:true,sameSite:'lax',secure,maxAge:7*86400000,path:'/'}); }
export class HttpError extends Error { constructor(public status: number,message: string) { super(message); } }
export function assert(condition: unknown,status: number,message: string): asserts condition { if(!condition) throw new HttpError(status,message); }
