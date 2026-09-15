// 对外暴露面：voice_task 动态工具 + voiceAssistant 只读服务（2026-09-15 从 lib/index.js 拆出）
//
// 供语音主会话（agent）与其它插件（如桌宠）使用；注册与回收同样由装配层负责。
import { defineTool } from '@deepseek-ai/dsh-tools'

export function installExpose(deps) {
  const { ctx, state, taskApi } = deps
  const { createTask, stopTaskById, taskView } = taskApi
  // ---------- 动态工具：主会话 agent 主动分发任务 / 查进度 ----------
  const tool = defineTool({
    name: 'voice_task',
    description: '语音助手任务管理：把任务分发给「语音通话」工作区下的独立任务会话执行（与当前会话分离，任务会话保留在工作区可查看；上下文将满时自动新开会话续接）。可创建任务、查看进度、获取结果（成功/失败）、停止任务。仅语音通话主会话可调用。',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'status', 'list', 'stop'], description: '操作：create 创建任务；status 查询任务状态与结果；list 列出所有任务；stop 停止一个执行中的任务' },
      title: { type: 'string', description: '任务标题（action=create）' },
      prompt: { type: 'string', description: '任务详细指令（action=create）' },
      taskId: { type: 'string', description: '任务 ID（action=status / stop）' },
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const caller = exec?.agent?.session?.id || exec?.agent?.id
      if (!caller || (state.voiceSessionId && caller !== state.voiceSessionId)) return { ok: false, error: 'voice_task 仅语音通话主会话可调用', caller }
      if (state.voiceSessionId === null) return { ok: false, error: '尚未绑定语音会话，请先在悬浮球面板中开始通话' }
      const action = args?.action
      if (action === 'create') {
        const title = String(args?.title || '').trim() || '语音任务'
        const prompt = String(args?.prompt || '').trim()
        if (!prompt) return { ok: false, error: 'empty prompt' }
        const r = await createTask(caller, title, prompt)
        return r.ok ? { ok: true, taskId: r.taskId, sessionId: r.sessionId, message: `任务「${title}」已创建，在语音通话工作区任务会话 ${r.sessionId} 中执行` } : r
      }
      if (action === 'status') {
        const t = state.tasks.get(String(args?.taskId || ''))
        if (!t) return { ok: false, error: 'task not found' }
        return { ok: true, task: taskView(t) }
      }
      if (action === 'list') return { ok: true, tasks: [...state.tasks.values()].map(taskView) }
      if (action === 'stop') {
        const taskId = String(args?.taskId || '')
        if (!taskId) return { ok: false, error: 'taskId required' }
        return stopTaskById(taskId)
      }
      return { ok: false, error: 'unknown action' }
    },
  })
  const disposeTool = ctx.tools.register(tool)
  ctx.effect(() => disposeTool, 'voice-call: tool')

  // ---------- 供其他插件联动（如桌宠）的只读服务 ----------
  const disposeProvide = ctx.provide('voiceAssistant', {
    getState: () => ({ voiceSessionId: state.voiceSessionId, ready: state.voiceReady, dedicated: true, workspaceId: state.voiceWorkspaceId, workspaceTitle: state.voiceWorkspaceTitle, persona: state.persona || '' }),
    listTasks: () => [...state.tasks.values()].map(taskView),
    listOtherDones: () => state.otherDones.slice(0, 20),
    events: () => state.events.slice(-50).map((e) => ({ ...e })),
  })
  ctx.effect(() => disposeProvide, 'voice-call: service')
}
