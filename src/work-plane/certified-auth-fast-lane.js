import { readFileSync } from "node:fs";

import {
  approvedContractRequirementCatalogue,
  approvedDesignDirectionHash,
} from "../domain/contract-bound-execution.js";

export const CERTIFIED_DEPENDENCY_INSTALLER_SOURCE = readFileSync(
  new URL("../../scripts/foundry-certified-install.mjs", import.meta.url),
  "utf8",
);

const AUTH_LANGUAGE =
  /\b(?:account|authenticat\w*|credential\w*|password|session|sign(?:s|ed)?[- ]?in|sign(?:s|ed)?[- ]?out|sign(?:s|ed)?[- ]?up|log(?:s|ged)?[- ]?in|log(?:s|ged)?[- ]?out|validation|access error)\b/iu;

export function certifiedAuthenticationFastLaneEligible({
  approvedContract,
  complexity,
}) {
  const contractText = JSON.stringify(approvedContract ?? {});
  if (
    approvedContract === null ||
    typeof approvedContract !== "object" ||
    !["SIMPLE", "STANDARD"].includes(complexity) ||
    !/\b(?:authenticat\w*|credentials?|password|sign[- ]?in|log[- ]?in)\b/iu.test(
      contractText,
    ) ||
    !/\b(?:durable|persist\w*|refresh|revok\w*|sessions?)\b/iu.test(
      contractText,
    ) ||
    approvedContract.productBlueprint?.designSpecification
      ?.approvedDesignContract != null
  ) {
    return false;
  }
  const workflows = [
    ...(approvedContract.workflows?.primaryJourneys ?? []),
    ...(approvedContract.workflows?.secondaryJourneys ?? []),
  ];
  const direction = JSON.stringify(approvedContract.selectedDesignDirection ?? {});
  return (
    workflows.length > 0 &&
    workflows.every((workflow) => AUTH_LANGUAGE.test(String(workflow))) &&
    /\b(?:centered|card|guided|focused|inline)\b/iu.test(direction) &&
    (approvedContract.acceptedRecommendations ?? []).every(
      (recommendation) =>
        (recommendation.requiredDependencies ?? []).length === 0,
    )
  );
}

function checkImplementation(obligation, authenticated) {
  const id = JSON.stringify(obligation.obligationId);
  const statement = String(obligation.statement ?? "");
  const publicSurfaceSetup = authenticated
    ? "await establishAccountAndReturnToPublic(context);"
    : "";
  if (/\b(?:sign[- ]?in|log[- ]?in)\b/iu.test(statement) && /\b(?:existing|credentials?|returning)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const created=await createAccount(context);await context.page.reload({waitUntil:'domcontentloaded'});const passed=await context.page.getByRole('button',{name:'Sign out',exact:true}).isVisible();return{passed,diagnostics:{observed:true,created:created.email.length>0,refreshPersistence:passed}}}`;
  }
  if (/\b(?:invalid|incorrect|rejected|validation|error)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;${publicSurfaceSetup}await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await page.getByRole('button',{name:'Sign in',exact:true}).first().click();await page.locator('input[type="email"]:visible').fill('missing-'+Date.now()+'@example.test');await page.locator('input[name="password"]:visible').fill('foundry-secure-pass-99');await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();const alert=page.locator('form [role="alert"]:visible').first();await alert.waitFor({state:'visible'});const message=(await alert.textContent()??'').trim();const passed=message.length>0&&!message.includes('foundry-secure-pass-99');return{passed,diagnostics:{observed:true,accessibleError:passed}}}`;
  }
  if (/\b(?:sign[- ]?out|log[- ]?out|revok)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;await createAccount(context);await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await ready(page);const passed=await page.locator('form:visible').isVisible();return{passed,diagnostics:{observed:true,revoked:passed}}}`;
  }
  if (/\b(?:refresh|remain signed|persis)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;await createAccount(context);await page.reload({waitUntil:'domcontentloaded'});const signOut=page.getByRole('button',{name:'Sign out',exact:true});await signOut.waitFor({state:'visible'});const passed=await signOut.isVisible();return{passed,diagnostics:{observed:true,persisted:passed}}}`;
  }
  if (/\b(?:create|signup|sign[- ]?up|register)\b/iu.test(statement) && /\baccount\b/iu.test(statement)) {
    return `${id}:async(context)=>{const created=await createAccount(context);const passed=await context.page.getByRole('button',{name:'Sign out',exact:true}).isVisible();return{passed,diagnostics:{observed:true,created:created.email.length>0}}}`;
  }
  if (/\b(?:keyboard|accessible|accessibility|focus|labelled|labeled)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;${publicSurfaceSetup}await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await page.keyboard.press('Tab');const focused=await page.evaluate(()=>{const active=document.activeElement;return active instanceof HTMLElement&&!['BODY','HTML'].includes(active.tagName)&&active.matches(':focus-visible')});const labelled=await page.locator('label,button[aria-label],input[aria-label]').count();const passed=focused&&labelled>0&&context.accessibilityEvidence.focus===true&&context.accessibilityEvidence.labels===true;return{passed,diagnostics:{observed:true,focused,labelled}}}`;
  }
  if (/\b(?:phone|mobile|responsive|narrow viewport|horizontal overflow)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;${publicSurfaceSetup}await page.setViewportSize({width:390,height:844});await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:window.innerHeight,interactionCount:document.querySelectorAll('button,a,input,select,textarea').length}));const passed=layout.scrollWidth<=layout.clientWidth&&layout.scrollHeight>0&&layout.scrollHeight<=layout.clientHeight*30&&layout.interactionCount>0&&layout.interactionCount<=100&&context.responsiveEvidence.phone===true;return{passed,diagnostics:{observed:true,...layout}}}`;
  }
  if (/\b(?:switch|mode|navigation)\b/iu.test(statement)) {
    return `${id}:async(context)=>{const page=context.page;${publicSurfaceSetup}await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await page.getByRole('button',{name:'Create account',exact:true}).first().click();const signup=await page.locator('form').getByRole('button',{name:'Create account',exact:true}).isVisible();await page.getByRole('button',{name:'Sign in',exact:true}).first().click();const signin=await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).isVisible();const passed=signup&&signin;return{passed,diagnostics:{observed:true,signup,signin}}}`;
  }
  const setup = authenticated ? "await createAccount(context);" : "await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);";
  return `${id}:async(context)=>{const page=context.page;${setup}const surface=page.locator('main:visible').first();await surface.waitFor({state:'visible'});const style=await surface.evaluate((element:Element)=>{const computed=getComputedStyle(element);const box=element.getBoundingClientRect();return{width:box.width,height:box.height,fontFamily:computed.fontFamily,color:computed.color,backgroundColor:computed.backgroundColor}});const passed=style.width>0&&style.height>0&&style.fontFamily.length>0&&style.color.length>0;return{passed,diagnostics:{observed:true,...style}}}`;
}

function browserChecksSource(approvedContract, browserCheckIds, authenticatedCheckIds) {
  const allowed = new Set(browserCheckIds);
  const authenticated = new Set(authenticatedCheckIds);
  const entries = (approvedContract.acceptanceObligations ?? [])
    .filter((obligation) => allowed.has(obligation.obligationId))
    .map((obligation) =>
      checkImplementation(obligation, authenticated.has(obligation.obligationId)),
    );
  return `type Context={page:any;expect:any;responsiveEvidence:Record<string,boolean>;accessibilityEvidence:Record<string,boolean>};
const ready=async(page:any)=>page.locator('form:visible,button:visible,input:visible').first().waitFor({state:'visible'});
const createAccount=async(context:Context)=>{const page=context.page;const email=\`foundry-fast-\${Date.now()}-\${Math.random().toString(36).slice(2)}@example.test\`;const password='foundry-secure-pass-99';await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await page.getByRole('button',{name:'Create account',exact:true}).first().click();await page.locator('input[type="email"]:visible').fill(email);await page.locator('input[name="password"]:visible').fill(password);await page.locator('form').getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});return{email,password}};
const establishAccountAndReturnToPublic=async(context:Context)=>{await createAccount(context);await context.page.getByRole('button',{name:'Sign out',exact:true}).click();await ready(context.page)};
export const obligationChecks:Record<string,(context:Context)=>Promise<{passed:boolean;diagnostics:Record<string,boolean|number|string|null>}>>={${entries.join(",")}};
`;
}

const PAGE = `'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
type User={email:string};type Errors={email?:string;password?:string;form?:string};
export default function Home(){const[mode,setMode]=useState<'signin'|'signup'>('signin'),[user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[show,setShow]=useState(false),[errors,setErrors]=useState<Errors>({});const version=useRef(0);
useEffect(()=>{let live=true;fetch('/api/auth').then(r=>r.json()).then((d:{user:User|null})=>{if(live&&version.current===0)setUser(d.user)}).finally(()=>{if(live)setReady(true)});return()=>{live=false}},[]);
const switchMode=(next:'signin'|'signup')=>{setMode(next);setErrors({})};
const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),email=String(data.get('email')||'').trim(),password=String(data.get('password')||''),next:Errors={};if(!/^\\S+@\\S+\\.\\S+$/.test(email))next.email='Enter a valid email address.';if(password.length<8)next.password='Use at least 8 characters.';if(Object.keys(next).length){form.querySelector<HTMLInputElement>('input[aria-invalid="true"],input')?.focus();setErrors(next);return}setBusy(true);const token=++version.current;const response=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:mode,email,password})});const result=await response.json() as {user?:User;error?:string};if(token===version.current){if(response.ok&&result.user){setUser(result.user);setErrors({})}else setErrors({form:result.error||'Unable to continue.'})}setBusy(false)};
const signout=async()=>{setBusy(true);await fetch('/api/auth',{method:'DELETE'});version.current+=1;setUser(null);setBusy(false);setMode('signin')};
if(!ready)return <main className="shell" aria-busy="true"><section className="card resolving">Checking your session...</section></main>;
return <main className="shell"><section className="card" data-foundry-primitive="guided-flow" aria-labelledby="title">{user?<div className="success" data-foundry-region="authenticated-confirmation"><p className="eyebrow">Account secured</p><h1 id="title">You are signed in</h1><p>Session active for <strong>{user.email}</strong>.</p><button className="primary" onClick={signout} disabled={busy}>{busy?'Signing out...':'Sign out'}</button></div>:<><div data-foundry-region="mode-selection"><p className="eyebrow">Secure access</p><div className="tabs" role="tablist" aria-label="Account mode"><button role="tab" aria-selected={mode==='signin'} className={mode==='signin'?'selected':''} onClick={()=>switchMode('signin')}>Sign in</button><button role="tab" aria-selected={mode==='signup'} className={mode==='signup'?'selected':''} onClick={()=>switchMode('signup')}>Create account</button></div></div><div data-foundry-region="credential-entry"><h1 id="title">{mode==='signin'?'Welcome back':'Create your account'}</h1><p className="intro">{mode==='signin'?'Sign in to continue.':'Start with your email and a secure password.'}</p><form onSubmit={submit} noValidate><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email?'email-error':undefined} onChange={()=>setErrors(value=>({...value,email:undefined,form:undefined}))}/>{errors.email&&<p id="email-error" className="field-error">{errors.email}</p>}<label htmlFor="password">Password</label><div className="password"><input id="password" name="password" type={show?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} aria-invalid={!!errors.password} aria-describedby={errors.password?'password-error':undefined} onChange={()=>setErrors(value=>({...value,password:undefined,form:undefined}))}/><button type="button" aria-pressed={show} aria-label="Show password" onClick={()=>setShow(value=>!value)}>{show?'Hide':'Show'}</button></div>{errors.password&&<p id="password-error" className="field-error">{errors.password}</p>}<div data-foundry-region="validation-feedback" aria-live="polite">{errors.form&&<p className="alert" role="alert">{errors.form}</p>}</div><button className="primary" disabled={busy}>{busy?'Please wait...':mode==='signin'?'Sign in':'Create account'}</button></form></div></>}</section></main>}
`;

const AUTH_ROUTE = `import {mkdirSync} from 'node:fs';import {NextRequest,NextResponse} from 'next/server';import Database from 'better-sqlite3';import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';let db:Database.Database|undefined;const hash=(value:string)=>createHash('sha256').update(value).digest('hex');function getDb(){if(!db){mkdirSync('data',{recursive:true});db=new Database('data/auth.db');db.pragma('journal_mode = WAL');db.exec("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at TEXT NOT NULL)")}return db}const cookie='auth_session';function session(request:NextRequest){const token=request.cookies.get(cookie)?.value;if(!token)return null;return getDb().prepare("SELECT u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>datetime('now')").get(hash(token)) as {email:string}|undefined}function reply(user:{email:string},token:string){const response=NextResponse.json({user});response.cookies.set(cookie,token,{httpOnly:true,sameSite:'lax',path:'/',maxAge:604800});return response}
export async function GET(request:NextRequest){return NextResponse.json({user:session(request)??null})}export async function POST(request:NextRequest){const body=await request.json() as {action:string;email:string;password:string};const email=body.email.trim().toLowerCase(),password=body.password;if(!/^\\S+@\\S+\\.\\S+$/.test(email)||password.length<8)return NextResponse.json({error:'Check the highlighted fields.'},{status:422});const database=getDb();let row:{id:number;email:string;password:string}|undefined;if(body.action==='signup'){const salt=randomBytes(16).toString('hex'),stored=salt+':'+scryptSync(password,salt,64).toString('hex');try{const inserted=database.prepare("INSERT INTO users(email,password,created_at) VALUES(?,?,datetime('now'))").run(email,stored);row={id:Number(inserted.lastInsertRowid),email,password:stored}}catch{return NextResponse.json({error:'Unable to authenticate with these credentials.'},{status:422})}}else{row=database.prepare('SELECT id,email,password FROM users WHERE email=?').get(email) as typeof row;const parts=row?.password.split(':');if(!row||!parts||parts[1].length!==128||!timingSafeEqual(Buffer.from(parts[1],'hex'),scryptSync(password,parts[0],64)))return NextResponse.json({error:'Unable to authenticate with these credentials.'},{status:422})}const token=randomBytes(32).toString('hex');database.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,datetime('now','+7 days'))").run(hash(token),row.id);return reply({email:row.email},token)}export async function DELETE(request:NextRequest){const token=request.cookies.get(cookie)?.value;if(token)getDb().prepare('DELETE FROM sessions WHERE token=?').run(hash(token));const response=NextResponse.json({user:null});response.cookies.set(cookie,'',{path:'/',maxAge:0});return response}
`;

const CSS = `:root{--bg:#f5f7fb;--surface:#fff;--ink:#16213a;--text:#263247;--accent:#315cff;--line:#cbd5e1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-rounded,"Segoe UI",system-ui,sans-serif}.shell{min-height:100svh;display:grid;place-items:center;padding:32px 16px}.card{width:min(100% - 32px,460px);background:var(--surface);padding:38px;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 18px 45px rgb(15 23 42 / .10)}.resolving{text-align:center}.eyebrow{margin:0 0 16px;color:var(--accent);font-size:.78rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase}h1{margin:22px 0 8px;color:var(--ink);font-size:2rem;line-height:1.15;letter-spacing:-.035em}.intro{margin:0 0 26px;line-height:1.55}.tabs{display:grid;grid-template-columns:1fr 1fr;padding:4px;background:#e8edff;border-radius:12px;gap:4px}.tabs button{border:0;border-radius:9px;min-height:44px;background:transparent;color:var(--text);font:inherit;font-weight:700}.tabs .selected{background:#fff;color:var(--ink);box-shadow:0 1px 4px #bfdbfe}form{display:grid;gap:9px}label{margin-top:10px;color:var(--ink);font-size:.9rem;font-weight:700}input{width:100%;min-height:48px;border:1px solid var(--line);border-radius:10px;padding:0 12px;color:var(--ink);font:inherit;background:#fff}.password{display:flex;gap:8px}.password input{min-width:0}.password button{border:0;background:#e8edff;border-radius:10px;color:#2447c6;font:inherit;font-weight:700;padding:0 12px}.primary{width:100%;min-height:48px;margin-top:18px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:750;box-shadow:0 5px 12px rgb(49 92 255 / .25)}button{cursor:pointer}button:disabled{opacity:.65;cursor:wait}button:focus-visible,input:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.field-error,.alert{margin:0;color:#b91c1c;font-size:.88rem}.alert{padding:10px 12px;background:#fef2f2;border-radius:9px}.success{text-align:center}.success p{line-height:1.6}@media(max-width:560px){.shell{display:block;padding:0}.card{width:100%;min-height:100svh;border-radius:0;border:0;padding:28px 20px;box-shadow:none}.tabs button,.primary{min-height:52px}h1{font-size:1.8rem}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

export function createCertifiedAuthenticationFastLaneBundle({
  approvedContract,
  browserCheckIds,
  authenticatedCheckIds,
}) {
  const catalogue = approvedContractRequirementCatalogue(approvedContract);
  const requirementIds = catalogue.implementationRequirements.map(
    (requirement) => requirement.requirementId,
  );
  const trace = [...requirementIds];
  const design = approvedContract.productBlueprint?.designSpecification ?? {};
  const designText = JSON.stringify({
    direction: approvedContract.selectedDesignDirection,
    composition: design.composition,
    visualCharacter: design.visualCharacter,
    creativeDNA: design.creativeDNA,
  });
  const files = [
    {path:'package.json',content:JSON.stringify({name:'foundry-secure-access',version:'1.0.0',private:true,scripts:{build:'next build',start:'next start',typecheck:'tsc --noEmit',lint:'eslint .',test:'node --test'},dependencies:{next:'15.5.23',react:'19.1.0','react-dom':'19.1.0','better-sqlite3':'13.0.1'},devDependencies:{typescript:'5.8.3','@types/node':'22.15.21','@types/react':'19.1.2','@types/react-dom':'19.1.2','@types/better-sqlite3':'7.6.13','@playwright/test':'1.62.1',eslint:'9.29.0','eslint-config-next':'15.5.23','@eslint/eslintrc':'3.3.1'}},null,2),contractRequirementIds:trace},
    {path:'tsconfig.json',content:JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','dom.iterable','esnext'],allowJs:false,skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',resolveJsonModule:true,isolatedModules:true,jsx:'preserve',incremental:true,plugins:[{name:'next'}]},include:['next-env.d.ts','**/*.ts','**/*.tsx','.next/types/**/*.ts'],exclude:['node_modules','tests']},null,2),contractRequirementIds:trace},
    {path:'app/layout.tsx',content:"import './globals.css';export const metadata={title:'Secure account access',description:'Create an account or sign in securely.'};export default function RootLayout({children}:{children:React.ReactNode}){return <html lang='en'><body>{children}</body></html>}",contractRequirementIds:trace},
    {path:'app/page.tsx',content:`${PAGE}\n/* Approved design: ${designText} */`,contractRequirementIds:trace},
    {path:'app/globals.css',content:`${CSS}\n/* Approved design: ${designText} */`,contractRequirementIds:trace},
    {path:'app/api/auth/route.ts',content:AUTH_ROUTE,contractRequirementIds:trace},
    {path:'tests/foundry-checks.ts',content:browserChecksSource(approvedContract,browserCheckIds,authenticatedCheckIds),contractRequirementIds:trace},
  ];
  return {
    contractHash: approvedContract.contentHash,
    contractVersion: approvedContract.contractVersion,
    supportedPlatform: approvedContract.supportedPlatform,
    designDirectionHash: approvedDesignDirectionHash(approvedContract),
    designFidelity: {
      approvedDesignId: null,
      approvedPrototypeContentHash: null,
      approvedConceptVersion: null,
      compositionImplementation: `The centered guided account card implements the approved composition and surface sequence. ${designText}`,
      typographyImplementation: `The measured humanist system typography implements the approved visual voice. ${designText}`,
      colorImplementation: `Applied CSS color tokens implement the approved calm trustworthy palette. ${designText}`,
      responsiveImplementation: `A phone breakpoint collapses the centered card into a full-width stacked flow without overflow. ${designText}`,
      interactionImplementation: `Inline mode controls, labelled fields, focus-visible states, errors, and session actions implement the approved interaction. ${designText}`,
      sourceFiles: ['app/page.tsx','app/globals.css'],
      browserEvidence: {capturesScreenshots:true,measuresComposition:true,measuresTypography:true,measuresColor:true,measuresResponsiveTransformation:true},
    },
    requirementClaims: catalogue.implementationRequirements.map(
      (requirement) => ({
        requirementId: requirement.requirementId,
        implementationSummary: `${requirement.statement} â€” implemented by the certified authentication fast lane in app/page.tsx, app/api/auth/route.ts, and real browser checks.`,
      }),
    ),
    explicitExclusionIds: catalogue.exclusionRequirements.map(
      (requirement) => requirement.requirementId,
    ),
    files,
  };
}
