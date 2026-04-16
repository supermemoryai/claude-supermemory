#!/usr/bin/env node
var m=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var L=m((Ye,F)=>{var d=require("node:fs"),x=require("node:path"),ue=require("node:os"),le=require("node:crypto"),pe=x.join(ue.homedir(),".supermemory-claude","memories"),ge=`Developer coding session transcript. Focus on USER message and intent.

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
- Generic assistant explanations user didn't confirm/use`,me=`Project/codebase knowledge for team sharing.

EXTRACT:
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"`;function fe(e){d.existsSync(e)||d.mkdirSync(e,{recursive:!0})}function h(e,t){return x.join(pe,e,t)}function R(e){if(!d.existsSync(e))return[];let t=d.readdirSync(e).filter(n=>n.endsWith(".json")),o=[];for(let n of t)try{let r=d.readFileSync(x.join(e,n),"utf-8");o.push(JSON.parse(r))}catch{}return o}function de(e,t){let o=(e.content||"").toLowerCase(),n=0;for(let c of t)o.includes(c)&&(n+=1);let r=Date.now()-new Date(e.createdAt||0).getTime(),s=Math.max(0,1-r/(720*60*60*1e3));return n+s*.5}var b=class{constructor(t){this.containerTag=t||"default"}async addMemory(t,o,n={}){let r=o||this.containerTag,s=n.type==="project-knowledge"?"repo":"personal",c=h(s,r);fe(c);let a=le.randomUUID(),u={id:a,content:t,metadata:{sm_source:"claude-code-local",...n},createdAt:new Date().toISOString()};return d.writeFileSync(x.join(c,`${a}.json`),JSON.stringify(u,null,2)),{id:a,status:"saved",containerTag:r}}async search(t,o,n={}){let r=o||this.containerTag,s=n.limit||10,c=h("personal",r),a=h("repo",r),u=[...R(c),...R(a)];if(u.length===0)return{results:[],total:0};let l=t.toLowerCase().split(/\s+/).filter(i=>i.length>2),p=u.map(i=>({memory:i.content||"",metadata:i.metadata,updatedAt:i.createdAt,similarity:l.length>0?de(i,l)/l.length:0})).filter(i=>i.similarity>0).sort((i,f)=>f.similarity-i.similarity).slice(0,s);return{results:p,total:p.length}}async getProfile(t,o,n=5){let r=t||this.containerTag,s=h("personal",r),c=h("repo",r),a=R(s),u=R(c),l=(g,q)=>new Date(q.createdAt||0).getTime()-new Date(g.createdAt||0).getTime();a.sort(l),u.sort(l);let p=u.slice(0,n).map(g=>g.content),i=a.slice(0,n).map(g=>g.content),f=[...a,...u].sort(l).slice(0,n),$={results:f.map(g=>({id:g.id,memory:g.content,similarity:1,updatedAt:g.createdAt})),total:f.length};return{profile:{static:p,dynamic:i},searchResults:$}}};F.exports={LocalMemoryClient:b,PERSONAL_ENTITY_CONTEXT:ge,REPO_ENTITY_CONTEXT:me}});var D=m((Xe,U)=>{var{execSync:C}=require("node:child_process"),y=require("node:path");function he(e){let t=process.env.SUPERMEMORY_ISOLATE_WORKTREES==="true";try{if(t)return C("git rev-parse --show-toplevel",{cwd:e,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null;let o=C("git rev-parse --git-common-dir",{cwd:e,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim();if(o===".git")return C("git rev-parse --show-toplevel",{cwd:e,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null;let n=y.resolve(e,o);return y.basename(n)===".git"&&!n.includes(`${y.sep}.git${y.sep}`)?y.dirname(n):C("git rev-parse --show-toplevel",{cwd:e,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim()||null}catch{return null}}U.exports={getGitRoot:he}});var I=m((ze,X)=>{var S=require("node:fs"),E=require("node:path"),{getGitRoot:G}=D(),J=E.join(".claude",".supermemory-claude"),B="config.json";function K(e){let o=G(e)||e;return E.join(o,J,B)}function Y(e){try{let t=K(e);if(S.existsSync(t))return JSON.parse(S.readFileSync(t,"utf-8"))}catch{}return null}function ye(e,t){let n=G(e)||e,r=E.join(n,J),s=E.join(r,B);S.existsSync(r)||S.mkdirSync(r,{recursive:!0});let a={...Y(e)||{},...t};return S.writeFileSync(s,JSON.stringify(a,null,2)),s}X.exports={getConfigPath:K,loadProjectConfig:Y,saveProjectConfig:ye}});var Q=m((We,H)=>{var{execSync:Se}=require("node:child_process"),Te=require("node:crypto"),{loadProjectConfig:z}=I(),{getGitRoot:j}=D();function W(e){return Te.createHash("sha256").update(e).digest("hex").slice(0,16)}function A(e){try{let o=Se("git remote get-url origin",{cwd:e,encoding:"utf-8",stdio:["pipe","pipe","pipe"]}).trim().match(/[/:]([^/]+?)(?:\.git)?$/);return o?o[1]:null}catch{return null}}function we(e){let t=z(e);if(t?.personalContainerTag)return t.personalContainerTag;let n=j(e)||e;return`claudecode_project_${W(n)}`}function $e(e){return e.toLowerCase().replace(/[^a-z0-9]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")}function Re(e){let t=z(e);if(t?.repoContainerTag)return t.repoContainerTag;let n=j(e)||e,s=A(n)||n.split("/").pop()||"unknown";return`repo_${$e(s)}`}function xe(e){let o=j(e)||e;return A(o)||o.split("/").pop()||"unknown"}H.exports={sha256:W,getGitRoot:j,getGitRepoName:A,getContainerTag:we,getRepoContainerTag:Re,getProjectName:xe}});var te=m((He,ee)=>{var w=require("node:fs"),V=require("node:path"),Ce=require("node:os"),{loadProjectConfig:Z}=I(),P=V.join(Ce.homedir(),".supermemory-claude"),T=V.join(P,"settings.json"),v={includeTools:[],maxProfileItems:5,debug:!1,injectProfile:!0,signalExtraction:!1,signalKeywords:["remember","implementation","refactor","architecture","decision","important","bug","fix","solved","solution","pattern","approach","design","tradeoff","migrate","upgrade","deprecate"],signalTurnsBefore:3};function Ee(){w.existsSync(P)||w.mkdirSync(P,{recursive:!0})}function _(){let e={...v};try{if(w.existsSync(T)){let t=w.readFileSync(T,"utf-8");Object.assign(e,JSON.parse(t))}}catch(t){console.error(`Settings: Failed to load ${T}: ${t.message}`)}return process.env.SUPERMEMORY_DEBUG==="true"&&(e.debug=!0),e}function je(e){Ee();let t={...e};w.writeFileSync(T,JSON.stringify(t,null,2))}function Pe(e,t,o){if(e.debug){let n=new Date().toISOString();console.error(o?`[${n}] ${t}: ${JSON.stringify(o)}`:`[${n}] ${t}`)}}function ve(e){let t=_(),o=Z(e||process.cwd()),n=t.includeTools||[],r=o?.includeTools||[];return[...new Set([...n,...r])].map(c=>c.toLowerCase())}function Ne(e,t){return t.length===0?!1:t.includes(e.toLowerCase())}function Oe(e){let t=_(),o=Z(e||process.cwd()),n=t.signalExtraction||!1,r=o?.signalExtraction,s=r!==void 0?r:n,c=t.signalKeywords||v.signalKeywords,a=o?.signalKeywords||[],u=[...new Set([...c,...a])].map(p=>p.toLowerCase()),l=o?.signalTurnsBefore||t.signalTurnsBefore||v.signalTurnsBefore;return{enabled:s,keywords:u,turnsBefore:l}}ee.exports={SETTINGS_DIR:P,SETTINGS_FILE:T,DEFAULT_SETTINGS:v,loadSettings:_,saveSettings:je,debugLog:Pe,getIncludeTools:ve,shouldIncludeTool:Ne,getSignalConfig:Oe}});var oe=m((Qe,ne)=>{async function be(){return new Promise((e,t)=>{let o="";process.stdin.setEncoding("utf8"),process.stdin.on("data",n=>{o+=n}),process.stdin.on("end",()=>{try{e(o.trim()?JSON.parse(o):{})}catch(n){t(new Error(`Failed to parse stdin JSON: ${n.message}`))}}),process.stdin.on("error",t),process.stdin.isTTY&&e({})})}function N(e){console.log(JSON.stringify(e))}function De(e=null){N(e?{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:e}}:{continue:!0,suppressOutput:!0})}function Ie(e){console.error(`Supermemory: ${e}`),N({continue:!0,suppressOutput:!0})}ne.exports={readStdin:be,writeOutput:N,outputSuccess:De,outputError:Ie}});var ce=m((Ve,ie)=>{var re="The following is recalled context. Reference it only when relevant to the conversation.",se="Use these memories naturally when relevant \u2014 including indirect connections \u2014 but don't force them into every response or make assumptions beyond what's stated.";function k(e){try{let t=new Date(e),o=new Date,n=(o.getTime()-t.getTime())/1e3,r=n/60,s=n/3600,c=n/86400;if(r<30)return"just now";if(r<60)return`${Math.floor(r)}mins ago`;if(s<24)return`${Math.floor(s)}hrs ago`;if(c<7)return`${Math.floor(c)}d ago`;let a=t.toLocaleString("en",{month:"short"});return t.getFullYear()===o.getFullYear()?`${t.getDate()} ${a}`:`${t.getDate()} ${a}, ${t.getFullYear()}`}catch{return""}}function Ae(e,t=!0,o=!1,n=10,r=!0){if(!e)return null;let s=t?(e.profile?.static||[]).slice(0,n):[],c=t?(e.profile?.dynamic||[]).slice(0,n):[],a=o?(e.searchResults?.results||[]).slice(0,n):[];if(s.length===0&&c.length===0&&a.length===0)return null;let u=[];if(s.length>0){let p=s.map(i=>`- ${i}`).join(`
`);u.push(`## User Profile (Persistent)
${p}`)}if(c.length>0){let p=c.map(i=>`- ${i}`).join(`
`);u.push(`## Recent Context
${p}`)}if(a.length>0){let p=a.map(i=>{let f=i.memory??"",$=i.updatedAt?k(i.updatedAt):"",g=i.similarity!=null?`[${Math.round(i.similarity*100)}%]`:"";return`- ${$?`[${$}] `:""}${f} ${g}`.trim()});u.push(`## Relevant Memories (with relevance %)
${p.join(`
`)}`)}let l=u.join(`

`);return r?`<supermemory-context>
${re}

${l}

${se}
</supermemory-context>`:l}function _e(e){let t=e.filter(n=>n.content);if(t.length===0)return null;let o=t.map(n=>n.label?`${n.label}

${n.content}`:n.content);return`<supermemory-context>
${re}

${o.join(`

---

`)}

${se}
</supermemory-context>`}function ke(e,t,o){let n=o?`${o} memories for "${e}"`:`Memories for "${e}"`;if(!t||t.length===0)return`No ${o?`${o.toLowerCase()} `:""}memories found for "${e}"`;let r=t.map(s=>{let c=s.memory??"",a=s.updatedAt?k(s.updatedAt):"",u=s.similarity!=null?`[${Math.round(s.similarity*100)}%]`:"";return`${a?`[${a}] `:""}${c} ${u}`.trim()});return`${n}
${r.join(`
`)}`}ie.exports={formatContext:Ae,combineContexts:_e,formatRelativeTime:k,formatSearchResults:ke}});var{LocalMemoryClient:Me}=L(),{getContainerTag:qe,getRepoContainerTag:Fe,getProjectName:Le}=Q(),{loadSettings:Ue,debugLog:O}=te(),{readStdin:Ge,writeOutput:M}=oe(),{formatContext:ae,combineContexts:Je}=ce();async function Be(){let e=Ue();try{let o=(await Ge()).cwd||process.cwd(),n=Le(o);O(e,"SessionStart",{cwd:o,projectName:n});let r=new Me,s=qe(o),c=Fe(o);O(e,"Fetching contexts",{personalTag:s,repoTag:c});let[a,u]=await Promise.all([r.getProfile(s,n,e.maxProfileItems).catch(()=>null),r.getProfile(c,n,e.maxProfileItems).catch(()=>null)]),l=ae(a,!0,!1,e.maxProfileItems,!1),p=ae(u,!0,!1,e.maxProfileItems,!1),i=Je([{label:"### Personal Memories",content:l},{label:"### Project Knowledge (Shared across team)",content:p}]);if(!i){M({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:`<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
</supermemory-context>`}});return}O(e,"Context generated",{length:i.length,hasPersonal:!!l,hasRepo:!!p}),M({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:i}})}catch(t){O(e,"Error",{error:t.message}),console.error(`Supermemory-local: ${t.message}`),M({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:`<supermemory-status>
Failed to load memories: ${t.message}
Session will continue without memory context.
</supermemory-status>`}})}}Be().catch(e=>{console.error(`Supermemory-local fatal: ${e.message}`),process.exit(1)});
