#!/usr/bin/env node
var m=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var F=m((Oe,M)=>{var d=require("node:fs"),C=require("node:path"),re=require("node:os"),se=require("node:crypto"),ie=C.join(re.homedir(),".supermemory-claude","memories"),ce=`Developer coding session transcript. Focus on USER message and intent.

RULES:
- Extract USER's action/intent, not every detail assistant provides
- Condense assistant responses into what user gained from it
- Skip granular facts from assistant output

EXTRACT:
- Research: "researched whisper.cpp for speech recognition"
- Actions: "built auth flow with JWT", "fixed memory leak in useEffect"
- Preferences: "prefers Tailwind over CSS modules"
- Decisions: "chose SQLite for local storage"
- Learnings: "learned about React Server Components"

SKIP:
- Every fact assistant mentions (condense to user's action)
- Generic assistant explanations user didn't confirm/use`,ae=`Project/codebase knowledge for team sharing.

EXTRACT:
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"`;function le(t){d.existsSync(t)||d.mkdirSync(t,{recursive:!0})}function h(t,e){return C.join(ie,t,e)}function w(t){if(!d.existsSync(t))return[];let e=d.readdirSync(t).filter(n=>n.endsWith(".json")),o=[];for(let n of e)try{let r=d.readFileSync(C.join(t,n),"utf-8");o.push(JSON.parse(r))}catch{}return o}function ue(t,e){let o=(t.content||"").toLowerCase(),n=0;for(let c of e)o.includes(c)&&(n+=1);let r=Date.now()-new Date(t.createdAt||0).getTime(),s=Math.max(0,1-r/(720*60*60*1e3));return n+s*.5}var N=class{constructor(e){this.containerTag=e||"default"}async addMemory(e,o,n={}){let r=o||this.containerTag,s=n.type==="project-knowledge"?"repo":"personal",c=h(s,r);le(c);let i=se.randomUUID(),a={id:i,content:e,metadata:{sm_source:"claude-code-local",...n},createdAt:new Date().toISOString()};return d.writeFileSync(C.join(c,`${i}.json`),JSON.stringify(a,null,2)),{id:i,status:"saved",containerTag:r}}async search(e,o,n={}){let r=o||this.containerTag,s=n.limit||10,c=h("personal",r),i=h("repo",r),a=[...w(c),...w(i)];if(a.length===0)return{results:[],total:0};let u=e.toLowerCase().split(/\s+/).filter(l=>l.length>2),g=a.map(l=>({memory:l.content||"",metadata:l.metadata,updatedAt:l.createdAt,similarity:u.length>0?ue(l,u)/u.length:0})).filter(l=>l.similarity>0).sort((l,f)=>f.similarity-l.similarity).slice(0,s);return{results:g,total:g.length}}async getProfile(e,o,n=5){let r=e||this.containerTag,s=h("personal",r),c=h("repo",r),i=w(s),a=w(c),u=(p,O)=>new Date(O.createdAt||0).getTime()-new Date(p.createdAt||0).getTime();i.sort(u),a.sort(u);let g=a.slice(0,n).map(p=>p.content),l=i.slice(0,n).map(p=>p.content),f=[...i,...a].sort(u).slice(0,n),$={results:f.map(p=>({id:p.id,memory:p.content,similarity:1,updatedAt:p.createdAt})),total:f.length};return{profile:{static:g,dynamic:l},searchResults:$}}};M.exports={LocalMemoryClient:N,PERSONAL_ENTITY_CONTEXT:ce,REPO_ENTITY_CONTEXT:ae}});var b=m((Me,L)=>{var{execSync:j}=require("node:child_process"),y=require("node:path");function ge(t){let e=process.env.SUPERMEMORY_ISOLATE_WORKTREES==="true";try{if(e)return j("git rev-parse --show-toplevel",{cwd:t,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null;let o=j("git rev-parse --git-common-dir",{cwd:t,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim();if(o===".git")return j("git rev-parse --show-toplevel",{cwd:t,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null;let n=y.resolve(t,o);return y.basename(n)===".git"&&!n.includes(`${y.sep}.git${y.sep}`)?y.dirname(n):j("git rev-parse --show-toplevel",{cwd:t,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null}catch{return null}}L.exports={getGitRoot:ge}});var D=m((Fe,K)=>{var S=require("node:fs"),E=require("node:path"),{getGitRoot:k}=b(),U=E.join(".claude",".supermemory-claude"),G="config.json";function B(t){let o=k(t)||t;return E.join(o,U,G)}function J(t){try{let e=B(t);if(S.existsSync(e))return JSON.parse(S.readFileSync(e,"utf-8"))}catch{}return null}function pe(t,e){let n=k(t)||t,r=E.join(n,U),s=E.join(r,G);S.existsSync(r)||S.mkdirSync(r,{recursive:!0});let i={...J(t)||{},...e};return S.writeFileSync(s,JSON.stringify(i,null,2)),s}K.exports={getConfigPath:B,loadProjectConfig:J,saveProjectConfig:pe}});var W=m((Le,z)=>{var{execSync:fe}=require("node:child_process"),me=require("node:crypto"),{loadProjectConfig:Y}=D(),{getGitRoot:P}=b();function X(t){return me.createHash("sha256").update(t).digest("hex").slice(0,16)}function A(t){try{let o=fe("git remote get-url origin",{cwd:t,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim().match(/[/:]([^/]+?)(?:\.git)?$/);return o?o[1]:null}catch{return null}}function de(t){let e=Y(t);if(e?.personalContainerTag)return e.personalContainerTag;let n=P(t)||t;return`claudecode_project_${X(n)}`}function he(t){return t.toLowerCase().replace(/[^a-z0-9]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")}function ye(t){let e=Y(t);if(e?.repoContainerTag)return e.repoContainerTag;let n=P(t)||t,s=A(n)||n.split("/").pop()||"unknown";return`repo_${he(s)}`}function Se(t){let o=P(t)||t;return A(o)||o.split("/").pop()||"unknown"}z.exports={sha256:X,getGitRoot:P,getGitRepoName:A,getContainerTag:de,getRepoContainerTag:ye,getProjectName:Se}});var Z=m((ke,V)=>{var R=require("node:fs"),H=require("node:path"),Te=require("node:os"),{loadProjectConfig:Q}=D(),v=H.join(Te.homedir(),".supermemory-claude"),T=H.join(v,"settings.json"),x={includeTools:[],maxProfileItems:5,debug:!1,injectProfile:!0,signalExtraction:!1,signalKeywords:["remember","implementation","refactor","architecture","decision","important","bug","fix","solved","solution","pattern","approach","design","tradeoff","migrate","upgrade","deprecate"],signalTurnsBefore:3};function Re(){R.existsSync(v)||R.mkdirSync(v,{recursive:!0})}function I(){let t={...x};try{if(R.existsSync(T)){let e=R.readFileSync(T,"utf-8");Object.assign(t,JSON.parse(e))}}catch(e){console.error(`Settings: Failed to load ${T}: ${e.message}`)}return process.env.SUPERMEMORY_DEBUG==="true"&&(t.debug=!0),t}function $e(t){Re();let e={...t};R.writeFileSync(T,JSON.stringify(e,null,2))}function we(t,e,o){if(t.debug){let n=new Date().toISOString();console.error(o?`[${n}] ${e}: ${JSON.stringify(o)}`:`[${n}] ${e}`)}}function Ce(t){let e=I(),o=Q(t||process.cwd()),n=e.includeTools||[],r=o?.includeTools||[];return[...new Set([...n,...r])].map(c=>c.toLowerCase())}function je(t,e){return e.length===0?!1:e.includes(t.toLowerCase())}function Ee(t){let e=I(),o=Q(t||process.cwd()),n=e.signalExtraction||!1,r=o?.signalExtraction,s=r!==void 0?r:n,c=e.signalKeywords||x.signalKeywords,i=o?.signalKeywords||[],a=[...new Set([...c,...i])].map(g=>g.toLowerCase()),u=o?.signalTurnsBefore||e.signalTurnsBefore||x.signalTurnsBefore;return{enabled:s,keywords:a,turnsBefore:u}}V.exports={SETTINGS_DIR:v,SETTINGS_FILE:T,DEFAULT_SETTINGS:x,loadSettings:I,saveSettings:$e,debugLog:we,getIncludeTools:Ce,shouldIncludeTool:je,getSignalConfig:Ee}});var oe=m((Ue,ne)=>{var ee="The following is recalled context. Reference it only when relevant to the conversation.",te="Use these memories naturally when relevant \u2014 including indirect connections \u2014 but don't force them into every response or make assumptions beyond what's stated.";function q(t){try{let e=new Date(t),o=new Date,n=(o.getTime()-e.getTime())/1e3,r=n/60,s=n/3600,c=n/86400;if(r<30)return"just now";if(r<60)return`${Math.floor(r)}mins ago`;if(s<24)return`${Math.floor(s)}hrs ago`;if(c<7)return`${Math.floor(c)}d ago`;let i=e.toLocaleString("en",{month:"short"});return e.getFullYear()===o.getFullYear()?`${e.getDate()} ${i}`:`${e.getDate()} ${i}, ${e.getFullYear()}`}catch{return""}}function Pe(t,e=!0,o=!1,n=10,r=!0){if(!t)return null;let s=e?(t.profile?.static||[]).slice(0,n):[],c=e?(t.profile?.dynamic||[]).slice(0,n):[],i=o?(t.searchResults?.results||[]).slice(0,n):[];if(s.length===0&&c.length===0&&i.length===0)return null;let a=[];if(s.length>0){let g=s.map(l=>`- ${l}`).join(`
`);a.push(`## User Profile (Persistent)
${g}`)}if(c.length>0){let g=c.map(l=>`- ${l}`).join(`
`);a.push(`## Recent Context
${g}`)}if(i.length>0){let g=i.map(l=>{let f=l.memory??"",$=l.updatedAt?q(l.updatedAt):"",p=l.similarity!=null?`[${Math.round(l.similarity*100)}%]`:"";return`- ${$?`[${$}] `:""}${f} ${p}`.trim()});a.push(`## Relevant Memories (with relevance %)
${g.join(`
`)}`)}let u=a.join(`

`);return r?`<supermemory-context>
${ee}

${u}

${te}
</supermemory-context>`:u}function ve(t){let e=t.filter(n=>n.content);if(e.length===0)return null;let o=e.map(n=>n.label?`${n.label}

${n.content}`:n.content);return`<supermemory-context>
${ee}

${o.join(`

---

`)}

${te}
</supermemory-context>`}function xe(t,e,o){let n=o?`${o} memories for "${t}"`:`Memories for "${t}"`;if(!e||e.length===0)return`No ${o?`${o.toLowerCase()} `:""}memories found for "${t}"`;let r=e.map(s=>{let c=s.memory??"",i=s.updatedAt?q(s.updatedAt):"",a=s.similarity!=null?`[${Math.round(s.similarity*100)}%]`:"";return`${i?`[${i}] `:""}${c} ${a}`.trim()});return`${n}
${r.join(`
`)}`}ne.exports={formatContext:Pe,combineContexts:ve,formatRelativeTime:q,formatSearchResults:xe}});var{LocalMemoryClient:Ne}=F(),{getProjectName:be,getContainerTag:De,getRepoContainerTag:Ae}=W(),{loadSettings:Ge}=Z(),{formatSearchResults:_}=oe();function Ie(t){let e="both",o=[];for(let n of t)n==="--user"?e="user":n==="--repo"?e="repo":n==="--both"?e="both":o.push(n);return{containerType:e,query:o.join(" ")}}async function qe(){let{containerType:t,query:e}=Ie(process.argv.slice(2));if(!e||!e.trim()){console.log("No search query provided. Please specify what you want to search for.");return}let o=process.cwd(),n=be(o),r=De(o),s=Ae(o);try{let c=new Ne(r);if(console.log(`Project: ${n}
`),t==="both"){let[i,a]=await Promise.all([c.search(e,r,{limit:5}),c.search(e,s,{limit:5})]);i.results?.length>0&&console.log(_(e,i.results,"Personal")),a.results?.length>0&&(i.results?.length>0&&console.log(""),console.log(_(e,a.results,"Project"))),!i.results?.length&&!a.results?.length&&console.log(`No memories found for "${e}"`)}else{let i=t==="user"?r:s,a=t==="user"?"Personal":"Project",u=await c.search(e,i,{limit:10});console.log(_(e,u.results,a))}}catch(c){console.log(`Error searching memories: ${c.message}`)}}qe().catch(t=>{console.error(`Fatal error: ${t.message}`),process.exit(1)});
