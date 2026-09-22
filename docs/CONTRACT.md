# Avatara 0.3 — implementation contract

Fresh implementation. Existing `Avatara_extension` is reference only and is not modified.
Dependency-free browser ES modules. MV3 worker, shared domain core, shared UI for full-page workspace and narrow side panel. A separate localhost demo uses synthetic data only and is not connected to the installed extension or browser profile.

## State

`{schemaVersion:1, profile:{name:'',focus:''}, settings:{captureEnabled:false,retentionDays:90,excludedDomains:[],ai:{enabled:false,baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash',hasKey:false}}, memories:[], goals:[], messages:[], activity:[], importedAt:null}`

Memory: `{id,url,title,excerpt,domain,visitedAt,visitCount,tags:[],source:'history'|'page'|'manual',saved:false}`. Timestamp fields are ISO strings. Goal: `{id,title,why:'',target:5,progress:0,unit:'次',dueDate:'',status:'active'|'completed',createdAt}`. Message: `{id,role:'user'|'assistant',content,createdAt,sources:[{id,title,url,excerpt}],mode:'local'|'cloud',steps:[],actions:[]}`. Activity: `{id,type,label,createdAt}`. No secrets in this state, exports, or logs. API key in separate storage.session key `avatara_api_key`; settings.ai.hasKey populated on state.get. After browser restart user reenters key.

Assistant-only `steps` are public execution summaries, not private reasoning or raw provider transcripts: `{id,name,label,status:'completed'|'error'|'pending',summary}`. At most 24 are retained per message. User messages cannot carry executable actions or tool steps.

Assistant-only `actions` are confirmation proposals: `{id,name:'create_goal'|'advance_goal',args,title,description,status:'pending'|'approved'|'rejected'|'expired'|'failed',createdAt,expiresAt}`. At most 8 are retained per message. IDs must be non-empty and distinct within the array. Action arguments use the strict tool registry schema. Unknown action names are removed; malformed arguments, invalid status, or invalid lifetimes produce inert failed actions. Valid lifetimes are positive and no longer than 30 minutes. Sanitization must not repair invalid arguments into executable proposals or turn missing timestamps into fresh approval windows.

## Message API

Request `{type,payload:{}}`; response `{ok:true,data}` / `{ok:false,error:string}`. All state mutations return sanitized complete state. Exceptions: `ai.test` returns `{message,model}`; `data.export` returns sanitized state; `tabs.list` returns `[{id,title,url,active}]`; `tabs.open` returns `{opened:true}`; `memory.search` returns memory array.

- state.get
- profile.update {name,focus}
- settings.update partial settings; payload.ai may contain apiKey (consume separately; never merge into state). Changing provider origin while enabled requires an explicit non-empty key; disabled origin changes clear the old session key. Same-origin optional /v1 normalization preserves the key. A rejected persistent settings commit restores the previous session credential.
- history.import {days:30} requests optional history permission in frontend user gesture before message; normalize URLs, exclude sensitive params, merge without overwriting meaningful excerpts or saved flags
- memory.search {query,filter:'all'|'saved'}
- memory.toggleSaved {id}
- memory.capture {} activeTab grant needed from action/popup or frontend user gesture; reads selected active HTTP(S) tab, page title + up to 12000 chars main content; never opens or fetches other pages
- goals.create {title,why,target,unit,dueDate}
- goals.advance {id,delta:1}
- goals.delete {id}
- chat.send {text,requestId?} local truthful useful response if cloud disabled; native model tool loop if cloud enabled; ordinary conversation does not force a history lookup; full state response; serialize chat turn mutation. Optional requestId scopes public `{type:'agent.progress',requestId,step}` broadcasts to the waiting view.
- chat.confirm {messageId,actionId,decision:'approve'|'reject'} resolve the stored assistant action by both IDs; never use caller-supplied tool names or arguments; full state response. Only pending, unexpired proposals can execute. Terminal replay is idempotent, including repeated or concurrent approvals. Goal mutation, final proposal status, receipt, and activity are saved atomically. Expired/rejected/invalid proposals and missing goal IDs never change goals. A storage failure does not commit a partial action.
- chat.clear {}
- ai.test optional {baseUrl,model,apiKey}; synthetic ping only, no user memories; a different provider origin requires an explicit key and cannot implicitly reuse the saved provider credential
- tabs.list
- tabs.open {url} validated http(s) only
- data.export
- data.clear {} explicit UI confirmation required, also clears session key

## Core exports (src/core)

`model.js`: `createInitialState()`, `normalizeMemory(input)`, `mergeMemories(existing,incoming)`, `sanitizeState(state)`, `createGoal(input)`, `advanceGoal(goal,delta)`, `normalizeBaseUrl(value)`, `deriveTags(input)`, `normalizeAgentStep(input)`, `normalizeAgentAction(input)`.
`search.js`: `searchMemories(memories,query,options={})` returns sorted memory objects, `buildInsights(memories,goals)` returns `{topDomains:[{domain,count}],topics:[{name,count}],activeDays,totalVisits,savedCount,activeGoals}`. Search should support Chinese and English, exclude empty tokens, deterministic scoring, no false results for impossible queries.
`assistant.js`: `answerLocal(text,state)` returns `{content,sources,mode:'local',steps?,actions?}`. `answerCloud(text,state,{apiKey,fetchImpl=fetch,executeTool,onStep,timeoutMs?,turnTimeoutMs?})` returns the same public shape with mode cloud and runs the native tool loop. `testConnection({baseUrl,model,apiKey,fetchImpl=fetch})` returns `{message,model}`. HTTPS cloud endpoints or HTTP loopback endpoints only; normalize optional /v1. Requests and complete turns are time-bounded and abortable. Explicit cloud failure is reported by the caller, with no fabricated cloud success. Empty content and output length caps are handled.

`agent-tools.js`: `AGENT_TOOLS` exposes provider-native function definitions; `validateToolArgs(name,args)` validates a plain JSON object with no extra properties and returns canonical sanitized arguments. `toolLabel(name)` returns a public progress label. `isWriteTool(name)` identifies the two confirmation-only tools.

## Native agent loop

The cloud model chooses native `tool_calls`; the application does not imitate an agent by routing prompt keywords to a predetermined action. The initial provider request contains the system instructions, at most 6 recent conversation messages, bounded metadata for sources already displayed in those messages, and the current user message. Previously displayed source metadata is labeled untrusted and is not fresh evidence; the model must read a source before citing it in this turn. The request does not automatically inject the user's memory collection, profile, or goals. Ordinary conversation can finish without calling any tool. Historical user/assistant text remains untrusted context, not a replacement for current application policy.

The loop is bounded to 6 model rounds and 10 tool calls per turn. Tool names and arguments are validated before execution. Read results are bounded, treated as untrusted data, and returned to the model with the matching tool-call ID. Only short public execution summaries are retained in `steps`; provider reasoning and raw tool transcripts are not stored or displayed. Source citations must refer to evidence actually returned by tools in this turn, with display numbering normalized consistently.

| Read tool | Permitted effect |
| --- | --- |
| `search_memories` | Search already stored local memories, up to 6 per call; no page fetching. |
| `read_memory` | Read an existing memory by its real ID; no external navigation. |
| `list_goals` | Read actual recorded goals and progress; no inference of completed work. |
| `get_profile` | Read the name and focus explicitly entered by the user; no inferred personality. |
| `get_activity_summary` | Read local aggregates of saved records, topics, and goal counts. |
| `read_current_page` | Read the currently authorized ordinary webpage; no click, navigation, tab activation, or automatic memory save. |
| `list_tabs` | Read metadata Chrome currently permits; no switching, closing, or reopening tabs. |

Read tools run automatically when selected by the model, within existing browser grants. They cannot escalate Chrome permissions themselves. If a current page or tab is not authorized, return a truthful tool error so the model can explain the required user action.

Write tools only create proposals: `create_goal({title,target,unit?,why?,dueDate?})` and `advance_goal({id,delta})`. They must not mutate a goal during the model loop or claim completion before confirmation. Targets/deltas are positive integers no greater than 100000; IDs must correspond to stored goals; dates are valid `YYYY-MM-DD`. User approval is a separate `chat.confirm` transaction, limited to the exact stored proposal. Approval is not an instruction to continue arbitrary model-selected writes. Receipts distinguish successful application, rejection, expiry, and failure.

## Independent demo boundary

The localhost demo always uses `answerLocal` and synthetic localStorage state. It never invokes the native cloud loop, accepts API keys, reads Chrome history, or accesses extension APIs. It preserves public `steps`/`actions` returned by the local assistant if present, but it must not manufacture an LLM agent by matching ordinary chat keywords.

For deterministic tests, stored synthetic assistant proposals can exercise `chat.confirm` under the same registry, expiry, replay, and atomicity rules. Receipts identify changes as demo data. Such fixture execution verifies the confirmation state machine only; it is not evidence of cloud tool selection, actual webpage access, or native extension end-to-end success. Normal demo chat does not seed confirmation cards or pretend that a browser tool ran.

`src/preview/agent-fixture.html` is a separate, explicitly labeled manual component fixture. Loading this page alone does not write state. Its button loads 1 synthetic memory, 1 goal, and 2 assistant confirmation cards; if the current origin already has demo data, the button explicitly offers to reset that demo state. Use a dedicated preview port for UI QA. These files are development-only and excluded from the production extension package. Where available, the demo uses a same-origin Web Lock to serialize requests and confirmations across tabs, in addition to each module's request queue.

## Local topic derivation

`normalizeMemory` preserves supplied non-empty tags. When tags are missing or empty, `deriveTags` assigns at most 4 deterministic topic labels from explicit Chinese/English keywords in the saved title and excerpt. Title matches rank above excerpt-only matches. Domain names, URL paths, and bare links do not generate topics. For example, “Chrome extension storage API” yields “浏览器扩展 / 数据存储”; “如何学习机器学习” yields “机器学习”. Unknown content remains untagged. These labels are local keyword clusters of saved content, not psychological profiling or inferred personal traits. Repeated state sanitization preserves the result; no network request or additional page fetch is involved.

## Product and visuals

Chinese-first. Warm ivory canvas, ink typography, sage and restrained ochre accents. Editorial, spacious, tactile. Workspace navigation: 今日 / 记忆 / 目标 / 对话; settings as secondary route. Clearly tagged demo sandbox, useful fresh-install empty states. Every visible button works. No placeholder metrics presented as real. Source links are safe. Never use model output in innerHTML. Cloud consent explains selected sources + recent messages transmitted to configured provider. Local mode fully functional.
