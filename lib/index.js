// @linxin666/dsh-voice-call — Host half
// 语音通话助手：任务分发（子代理会话）、语音文本注入、TTS/云端 ASR 中转、
// 主动进度检查、voice_task 动态工具、voiceAssistant 联动服务。
import { defineTool } from '@deepseek-ai/dsh-tools'
const name = 'voice-call'

const inject = ['agents', 'timer', 'subprocess', 'webServer', 'tools']

const API = {
  getState: '/api/voice-call/state',
  bindSession: '/api/voice-call/bind-session',
  setPersona: '/api/voice-call/persona',
  sendText: '/api/voice-call/send-text',
  tts: '/api/voice-call/tts',
  cloudAsr: '/api/voice-call/asr',
  tasks: '/api/voice-call/tasks',
  taskStatus: '/api/voice-call/task-status',
  pollEvents: '/api/voice-call/events',
}

const MAX_JSON_BODY_BYTES = 24 * 1024 * 1024

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function apply(ctx, config) {
  const agents = ctx.agents
  if (agents === undefined) return

  // ---------- 状态 ----------
  let voiceSessionId = null
  let persona = ''
  let taskSeq = 0
  let msgCounter = 0
  let eventSeq = 0
  const events = []
  const tasks = new Map()

  const pushEvent = (ev) => {
    eventSeq += 1
    events.push({ seq: eventSeq, ...ev })
    if (events.length > 600) events.splice(0, events.length - 600)
  }
  const msg = (text, source) => ({ id: `va-${Date.now()}-${msgCounter++}`, role: 'user', content: [{ type: 'text', text }], source })
  const USER_SRC = { kind: 'user' }
  const pluginSrc = (form) => ({ kind: 'plugin', plugin: 'voice-assistant', form })
  const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const lastAssistantText = (agent) => {
    const evs = agent?.session?.events || []
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.type === 'assistant/message') {
        const t = textOf(e.data?.message?.content)
        if (t) return t
      }
    }
    return ''
  }
  const summarize = (agent, limit = 8) => {
    const evs = agent?.session?.events || []
    const lines = []
    for (let i = evs.length - 1; i >= 0 && lines.length < limit; i--) {
      const e = evs[i]
      if (e.type === 'user/message') lines.unshift(`用户: ${textOf(e.data?.content)}`)
      else if (e.type === 'assistant/message') {
        const t = textOf(e.data?.message?.content)
        if (t) lines.unshift(`助手: ${t}`)
      }
    }
    return lines.join('\n')
  }

  // ---------- node 子进程网络桥（TTS / 云端 ASR） ----------
  // payload 通过 stdin 传入（Windows 命令行长度限制 ~32KB，音频 base64 会超，
  // argv 传 JSON 会 spawn ENAMETOOLONG）。stdin reader 包装 + 脚本主体。
  const STDIN_BOOT = "let _i='';process.stdin.on('data',c=>_i+=c);process.stdin.on('end',()=>{const cfg=JSON.parse(_i);"
  const STDIN_END = "});"
  const runNode = async (script, payload) => {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { ok: false, error: 'subprocess unavailable' }
    let nodePath
    try { nodePath = await subprocess.resolveExecutable('node') }
    catch { return { ok: false, error: 'node executable not found on PATH' } }
    const policy = ctx.get('sandboxPolicy')
    const cwd = policy?.workspaceRoot || '.'
    let handle
    try {
      handle = subprocess.spawn({
        argv: [nodePath, '-e', STDIN_BOOT + script + STDIN_END],
        cwd,
        stdio: { stdin: 'pipe', stdout: { maxBytes: 32 * 1024 * 1024 }, stderr: { maxBytes: 65536 } },
        graceMs: 45000,
      })
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    try {
      if (handle.stdin) {
        handle.stdin.write(JSON.stringify(payload))
        handle.stdin.end()
      }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    let outcome
    try { outcome = await handle.done } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    let text = ''
    try { text = handle.collected.stdout?.readFrom(0)?.text?.trim() || '' } catch {}
    if (!text) return { ok: false, error: `no output (exit ${outcome.exitCode})` }
    try { return JSON.parse(text) }
    catch { return { ok: false, error: `bad JSON: ${text.slice(0, 300)}` } }
  }

  const TTS_MINIMAX = "const https=require('https');const body=JSON.stringify({model:cfg.model||'speech-02-hd',text:cfg.text,stream:false,voice_setting:{voice_id:cfg.voice||'male-qn-qingse',speed:cfg.speed||1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}});const u=new URL('https://api.minimax.chat/v1/t2a_v2');if(cfg.groupId)u.searchParams.set('GroupId',cfg.groupId);const req=https.request(u,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey,'Content-Length':Buffer.byteLength(body)}},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.write(body);req.end();"
  const TTS_OPENAI = "const https=require('https');const http=require('http');const body=JSON.stringify({model:cfg.model||'tts-1',input:cfg.text,voice:cfg.voice||'alloy',speed:cfg.speed||1,response_format:'mp3'});const u=new URL(cfg.baseUrl||'https://api.openai.com/v1/audio/speech');const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)};if(cfg.apiKey)headers['Authorization']='Bearer '+cfg.apiKey;const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>{const buf=Buffer.concat(d);if(res.statusCode>=200&&res.statusCode<300)process.stdout.write(JSON.stringify({ok:true,audio:buf.toString('base64'),mime:res.headers['content-type']||'audio/mpeg'}));else process.stdout.write(JSON.stringify({status:res.statusCode,body:buf.toString('utf8').slice(0,1500)}));});});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.write(body);req.end();"
  const ASR_OPENAI = "const https=require('https');const http=require('http');const boundary='----va'+Date.now();const audio=Buffer.from(cfg.audioBase64||'','base64');const pre=Buffer.from('--'+boundary+'\\r\\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.'+(cfg.ext||'webm')+'\"\\r\\nContent-Type: '+(cfg.mime||'audio/webm')+'\\r\\n\\r\\n');let post='\\r\\n--'+boundary;if(cfg.model){post+='\\r\\nContent-Disposition: form-data; name=\"model\"\\r\\n\\r\\n'+cfg.model}post+='\\r\\n--'+boundary+'--\\r\\n';const body=Buffer.concat([pre,audio,Buffer.from(post)]);const u=new URL(cfg.baseUrl||'https://api.openai.com/v1/audio/transcriptions');const headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length};if(cfg.apiKey)headers['Authorization']='Bearer '+cfg.apiKey;const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.write(body);req.end();"

  const ttsOnce = async (text, config) => {
    const cfg = config || {}
    let truncated = false
    const maxChars = Number(cfg.maxChars) || 0
    if (maxChars > 0 && text.length > maxChars) {
      text = text.slice(0, maxChars) + '…'
      truncated = true
    }
    const provider = cfg.provider === 'openai' ? 'openai' : 'minimax'
    const payload = { text, apiKey: cfg.apiKey || '', voice: cfg.voice || '', speed: Number(cfg.speed) || 1, groupId: cfg.groupId || '', model: cfg.model || '', baseUrl: cfg.baseUrl || '' }
    const res = provider === 'openai' ? await runNode(TTS_OPENAI, payload) : await runNode(TTS_MINIMAX, payload)
    if (!res.ok && res.error) return { ok: false, error: res.error }
    if (provider === 'minimax') {
      try {
        const j = JSON.parse(res.body || '{}')
        if (j.data?.audio) return { ok: true, audio: j.data.audio, mime: 'audio/mpeg', truncated }
        return { ok: false, error: `minimax: ${j.status_message || j.base_resp?.status_msg || 'no audio'}` }
      } catch (e) { return { ok: false, error: `minimax parse: ${String(e)}` } }
    }
    if (res.ok && res.audio) return { ok: true, audio: res.audio, mime: res.mime || 'audio/mpeg', truncated }
    return { ok: false, error: `openai tts: ${res.status} ${String(res.body || '').slice(0, 300)}` }
  }

  // ---------- 任务 ----------
  const createTask = async (parentSessionId, title, prompt) => {
    if (!parentSessionId) return { ok: false, error: '未绑定语音会话，无法创建任务' }
    const taskId = `task-${Date.now()}-${taskSeq++}`
    const sessionId = `va-task-${Date.now()}-${taskSeq}`
    const parent = agents.get(parentSessionId)
    const ctxSummary = summarize(parent, 8)
    const fullPrompt = ctxSummary ? `[来自主语音会话的共享记忆]\n${ctxSummary}\n\n[任务]\n${prompt}` : prompt
    const meta = { origin: 'subagent', parentSession: parentSessionId }
    if (parent?.session?.meta?.cwd) meta.cwd = parent.session.meta.cwd
    let handle
    try { handle = await agents.create({ sessionId, meta }) }
    catch (e) { return { ok: false, error: `create agent: ${String(e && e.message || e)}` } }
    try { handle.agent.followup(msg(fullPrompt, USER_SRC)) }
    catch (e) { return { ok: false, error: `followup: ${String(e && e.message || e)}` } }
    tasks.set(taskId, { taskId, sessionId, title, prompt, status: 'running', result: '', createdAt: Date.now(), updatedAt: Date.now() })
    pushEvent({ kind: 'task', taskId, status: 'running', title })
    return { ok: true, taskId, sessionId }
  }
  const completeTask = (t, agent) => {
    if (t.status !== 'running') return
    const text = lastAssistantText(agent)
    t.status = 'completed'
    t.result = text
    t.updatedAt = Date.now()
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'completed', result: text.slice(0, 600), title: t.title })
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
    if (main) {
      try { main.inject(msg(`语音任务「${t.title}」已完成：\n${text || '(无文本结果)'}`, pluginSrc('notice'))) } catch {}
    }
  }
  const taskView = (t) => ({ taskId: t.taskId, title: t.title, status: t.status, result: t.result.slice(0, 500), createdAt: t.createdAt, updatedAt: t.updatedAt })

  // ---------- 会话事件：主会话助手回复 → 事件队列（供 TTS） ----------
  ctx.on('session/event', (session, event) => {
    if (voiceSessionId && session.id === voiceSessionId && event.type === 'assistant/message') {
      const t = textOf(event.data?.message?.content)
      if (t) pushEvent({ kind: 'reply', text: t })
    }
    for (const task of tasks.values()) {
      if (task.sessionId === session.id && event.type === 'assistant/message') {
        const t = textOf(event.data?.message?.content)
        if (t && t !== task.result) { task.result = t; task.updatedAt = Date.now(); pushEvent({ kind: 'task', taskId: task.taskId, status: 'running', progress: t.slice(0, 300), title: task.title }) }
      }
    }
  })
  ctx.on('agent/status', (payload) => {
    const { agent, status } = payload
    if (!agent || status !== 'idle') return
    for (const task of tasks.values()) {
      if (task.sessionId === agent.id) { completeTask(task, agent); break }
    }
  })
  const checkMs = 30000
  ctx.interval(() => {
    for (const task of tasks.values()) {
      if (task.status !== 'running') continue
      const agent = agents.get(task.sessionId)
      if (!agent) continue
      const t = lastAssistantText(agent)
      if (t && t !== task.result) { task.result = t; task.updatedAt = Date.now() }
      if (agent.status === 'idle' && t) completeTask(task, agent)
      else if (agent.status === 'idle' && Date.now() - task.createdAt > 3600000) { task.status = 'error'; task.result = task.result || '(超时无结果)'; pushEvent({ kind: 'task', taskId: task.taskId, status: 'error', title: task.title }) }
    }
  }, checkMs)

  // ---------- 路由 ----------
  const route = (path, handler) => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const method = req.method ?? 'GET'
      const url = new URL(req.url ?? '/', 'http://localhost')
      const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : undefined
      try {
        await handler({ method, query: url, body, res, req })
      } catch (e) {
        writeJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  })

  const routes = [
    route(API.getState, async ({ res }) => writeJson(res, 200, { ok: true, voiceSessionId, persona, tasks: [...tasks.values()].map(taskView) })),
    route(API.bindSession, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      voiceSessionId = body?.sessionId || null
      const agent = voiceSessionId ? agents.get(voiceSessionId) : undefined
      if (agent && persona) { try { agent.inject(msg(`[语音助手人格] ${persona}`, pluginSrc('instructions'))) } catch {} }
      writeJson(res, 200, { ok: true, voiceSessionId })
    }),
    route(API.setPersona, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      persona = String(body?.persona || '').trim()
      const agent = voiceSessionId ? agents.get(voiceSessionId) : undefined
      if (agent && persona) { try { agent.inject(msg(`[语音助手人格] ${persona}`, pluginSrc('instructions'))) } catch {} }
      writeJson(res, 200, { ok: true })
    }),
    route(API.sendText, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const text = String(body?.text || '').trim()
      if (!text) return writeJson(res, 400, { ok: false, error: 'empty text' })
      const sessionId = body?.sessionId || voiceSessionId
      const agent = sessionId ? agents.get(sessionId) : undefined
      if (!agent) return writeJson(res, 404, { ok: false, error: `agent not found: ${sessionId}` })
      try { agent.followup(msg(text, USER_SRC)) }
      catch (e) { return writeJson(res, 500, { ok: false, error: String(e && e.message || e) }) }
      writeJson(res, 200, { ok: true })
    }),
    route(API.tts, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const r = await ttsOnce(String(body?.text || ''), body?.config || {})
      writeJson(res, r.ok ? 200 : 500, r)
    }),
    route(API.cloudAsr, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const cfg = body?.config || {}
      const out = await runNode(ASR_OPENAI, { audioBase64: body?.audioBase64 || '', mime: body?.mime || 'audio/webm', ext: body?.ext || 'webm', baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '' })
      if (!out.ok && out.error) return writeJson(res, 500, { ok: false, error: out.error })
      try {
        const j = JSON.parse(out.body || '{}')
        if (j.text) return writeJson(res, 200, { ok: true, text: j.text })
        return writeJson(res, 500, { ok: false, error: `asr: ${out.status} ${String(out.body || '').slice(0, 300)}` })
      } catch (e) { return writeJson(res, 500, { ok: false, error: `asr parse: ${String(e)}` }) }
    }),
    route(API.tasks, async ({ method, body, res }) => {
      if (method === 'GET') return writeJson(res, 200, { ok: true, tasks: [...tasks.values()].map(taskView) })
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const prompt = String(body?.prompt || '').trim()
      if (!prompt) return writeJson(res, 200, { ok: true, tasks: [...tasks.values()].map(taskView) })
      const title = String(body?.title || '').trim() || '语音任务'
      const r = await createTask(body?.parentSessionId || voiceSessionId, title, prompt)
      writeJson(res, r.ok ? 200 : 400, r)
    }),
    route(API.taskStatus, async ({ query, res }) => {
      const t = tasks.get(query.searchParams.get('taskId') || '')
      return t ? writeJson(res, 200, { ok: true, task: taskView(t) }) : writeJson(res, 404, { ok: false, error: 'task not found' })
    }),
    route(API.pollEvents, async ({ query, res }) => {
      const since = Number(query.searchParams.get('since')) || 0
      const out = events.filter((e) => e.seq > since)
      writeJson(res, 200, { ok: true, events: out.map((e) => ({ ...e })) })
    }),
  ]

  const disposers = routes.map((r) => ctx.webServer.register(r))
  ctx.effect(() => () => { for (const d of disposers) d() }, 'voice-call: routes')

  // ---------- 动态工具：主会话 agent 主动分发任务 / 查进度 ----------
  const tool = defineTool({
    name: 'voice_task',
    description: '语音助手任务管理：把任务分发给独立的子代理会话执行（与当前会话分离），可创建任务、查看进度、获取结果。仅语音通话主会话可调用。',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'status', 'list'], description: '操作：create 创建任务；status 查询任务状态与结果；list 列出所有任务' },
      title: { type: 'string', description: '任务标题（action=create）' },
      prompt: { type: 'string', description: '任务详细指令（action=create）' },
      taskId: { type: 'string', description: '任务 ID（action=status）' },
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const caller = exec?.agent?.id
      if (!caller || (voiceSessionId && caller !== voiceSessionId)) return { ok: false, error: 'voice_task 仅语音通话主会话可调用', caller }
      if (voiceSessionId === null) return { ok: false, error: '尚未绑定语音会话，请先在悬浮球面板中开始通话' }
      const action = args?.action
      if (action === 'create') {
        const title = String(args?.title || '').trim() || '语音任务'
        const prompt = String(args?.prompt || '').trim()
        if (!prompt) return { ok: false, error: 'empty prompt' }
        const r = await createTask(caller, title, prompt)
        return r.ok ? { ok: true, taskId: r.taskId, sessionId: r.sessionId, message: `任务「${title}」已创建并分发给子代理会话 ${r.sessionId}` } : r
      }
      if (action === 'status') {
        const t = tasks.get(String(args?.taskId || ''))
        if (!t) return { ok: false, error: 'task not found' }
        return { ok: true, task: taskView(t) }
      }
      if (action === 'list') return { ok: true, tasks: [...tasks.values()].map(taskView) }
      return { ok: false, error: 'unknown action' }
    },
  })
  const disposeTool = ctx.tools.register(tool)
  ctx.effect(() => disposeTool, 'voice-call: tool')

  // ---------- 供其他插件联动（如桌宠）的只读服务 ----------
  const disposeProvide = ctx.provide('voiceAssistant', {
    getState: () => ({ voiceSessionId, persona: persona || '' }),
    listTasks: () => [...tasks.values()].map(taskView),
    events: () => events.slice(-50).map((e) => ({ ...e })),
  })
  ctx.effect(() => disposeProvide, 'voice-call: service')
}

export { apply, inject, name }
