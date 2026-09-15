// apply() 的共享可变状态（2026-09-15 从 lib/index.js 拆出）
//
// 拆分前这些字段是 apply() 的闭包变量，约 80 个内部函数隐式共享它们。
// 拆成多文件后必须显式化：每个字段只有一个模块负责写入，其他模块只读。
//   - session.js   写：voiceSessionId / persona / voiceReady / voiceWorkspace* / ensuring / ensureTimer / ensureTries / ttsProvider / directorMode
//   - messages.js  写：eventSeq / events / msgCounter
//   - tasks.js     写：taskSeq / tasks
//   - announce.js  写：viewingSessionId / announceOtherDone / wasRunningOther / otherDoneSeq / otherDones / announcedJobs / pendingReports / flushGen
//   - speech/tts.js 写：cloneSampleCache
export function createState() {
  return {
    // 专属工作区/会话
    voiceSessionId: null,
    voiceReady: false,
    voiceWorkspaceId: null,
    voiceWorkspaceTitle: '',
    voiceWorkspaceObj: null,
    ensuring: null,
    ensureTimer: null,
    ensureTries: 0,
    persona: '',
    ttsProvider: 'minimax',
    directorMode: 'off',
    // 语音事件队列（面板轮询 + TTS）
    eventSeq: 0,
    events: [],
    // 消息序号（插件注入消息的去重 id）
    msgCounter: 0,
    // 任务
    taskSeq: 0,
    tasks: new Map(),
    // 其他会话完成播报
    viewingSessionId: null,
    announceOtherDone: true,
    wasRunningOther: new Set(),
    otherDoneSeq: new Map(),
    otherDones: [],
    announcedJobs: new Set(),
    pendingReports: [],
    flushGen: 0,
    // MiMo 音色克隆样本缓存
    cloneSampleCache: new Map(),
  }
}
