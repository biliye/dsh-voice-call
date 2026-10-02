// 插件装配层：唯一直接接触 ctx 注册面的地方（2026-09-15 从 lib/index.js 拆出）
//
// 职责：创建共享状态 → 按依赖方向装配各模块 → 注册对外暴露面。
// 约束：所有 ctx.on / ctx.effect / ctx.interval / ctx.setTimeout / ctx.provide /
// ctx.tools.register / ctx.webServer.register 都必须在这里（即 apply 执行期间）发生，
// 否则停用插件时副作用会泄漏。
import { createState } from './state.js'
import { createMessages } from './messages.js'
import { createSession } from './session.js'
import { createBridge } from './speech/bridge.js'
import { createSpeech } from './speech/tts.js'
import { createLocalSpeech } from './speech/stt-local.js'
import { createTasks } from './tasks.js'
import { createAnnounce } from './announce.js'
import { installEvents } from './events.js'
import { createRoutes } from './routes.js'
import { installExpose } from './expose.js'

function apply(ctx, config) {
  config ||= {}
  const agents = ctx.agents
  if (agents === undefined) return

  // ---------- 状态与前缀模块装配（依赖只向上：config/http/state ← messages/speech ← session/tasks ← announce ← events/routes/expose） ----------
  const state = createState()
  const messages = createMessages(state)
  const session = createSession(state, { ctx, agents, messages })
  const bridge = createBridge(ctx)
  const speech = createSpeech(state, { ctx, bridge })
  // 本地识别适配器不持有状态、也不注册任何 ctx 副作用（纯按需查询 speechToText 服务），
  // 所以在这里直接构造即可；语音输入插件未启用时会话依旧是「服务不可用」的报错。
  const localSpeech = createLocalSpeech({ ctx })
  const taskApi = createTasks(state, { ctx, agents, messages, session, config })
  const announce = createAnnounce(state, { ctx, agents, messages })
  const deps = { ctx, agents, config, state, messages, session, bridge, speech, localSpeech, taskApi, announce }

  // ---------- 会话事件订阅与任务巡检 ----------
  installEvents(deps)

  // ---------- HTTP 路由 ----------
  const routes = createRoutes(deps)
  const disposers = routes.map((r) => ctx.webServer.register(r))
  ctx.effect(() => () => { for (const d of disposers) d() }, 'voice-call: routes')

  // ---------- 对外暴露面：voice_task 工具 + voiceAssistant 服务 ----------
  installExpose(deps)

  // ---------- 启动后自动创建专属工作区与专属会话（失败自动重试） ----------
  ctx.setTimeout(() => session.runEnsure(), 1500)
}

export { apply }
