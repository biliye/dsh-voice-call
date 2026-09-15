// 插件身份与静态配置（2026-09-15 从 lib/index.js 拆出）
// 纯常量与纯函数：不依赖 ctx、不持有运行期状态。

export const name = 'voice-call'

export const inject = ['agents', 'timer', 'subprocess', 'webServer', 'tools', 'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'sandboxPolicy']

// ---------- 专属工作区/会话（固定身份，跨重启保持同一会话） ----------
export const VOICE_SESSION_ID = 'voice-call-main'
export const VOICE_SESSION_TITLE = '语音通话'
export const VOICE_WORKSPACE_DIR = 'voice-call'
export const VOICE_WORKSPACE_TITLE = '语音通话'
export const ENSURE_RETRY_MS = 5000
export const ENSURE_MAX_TRIES = 40
// 专属会话不直接执行的重型/耗时工具（任务一律交给子代理会话）。
// 工具名因部署而异：restrict 遇到未知名称会抛错，已在 setup 中容错跳过。
export const VOICE_DENY_TOOLS = ['bash', 'pwsh', 'run_code', 'workflow', 'ralph', 'subagent', 'subagent_fork', 'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_cluster', 'ssh_tunnel', 'job_kill', 'job_list', 'job_output', 'interrupt_agent', 'send_message', 'list_agents']
export const VOICE_QUICK_REPLY_PROMPT_HEAD = [
  '你是「语音通话」专属会话：用户通过语音与你对话，你的回复会被语音朗读，必须极其简短。',
  '行为要求：',
  '1. 快速回复：每次回复最多 1-2 句话、尽量控制在 40 字以内，口语化、直接给结论；不要寒暄、不要复述用户的话、不要解释思考过程。回复会被整句朗读，正文必须是真人说话式的自然口语，可用「嗯」「好嘞」「哎呀」「哈哈」等语气词（这些词会被念出来）。',
]
export const VOICE_QUICK_REPLY_PROMPT_TAIL = [
  '2. 静默执行：任务分发、执行中状态、失败、重试、核查、尝试各种方案等过程性信息一律不要对用户说出；只在任务有明确最终结果，或必须询问用户选择时，才用一句话简短汇报或提问。',
  '3. 任务外派：需要文件读写、代码执行、长时间研究、多步任务等耗时工作，或用户要求执行任务时，调用 voice_task 工具（action=create）分发给独立子代理会话执行，不要自己动手；分发后最多用一句话告知「已开始处理」，之后静默等待。',
  '3.5 停止任务：用户要求停止/取消某个任务时，先用 voice_task（action=list）找到任务 taskId，再用 action=stop 停止它，然后用一句话告知已停止。',
  '4. 会话连续：所有语音对话都保存在本会话（voice-call-main），本体重启后依然延续同一会话，可以引用之前的对话内容。',
  '5. 任务完成结果与「其他会话 / 后台任务完成」的播报会由系统注入到本会话，届时只用一句话转述核心结果，不要逐条复述原文；转述是说给用户听的，也要用口语短句并带上语气词或情绪标记，不要名词堆叠的汇报腔（如「后台修复的播报」「这个语音插件」这类书面说法）。',
]
// 朗读方式标记的提示词必须按「朗读提供商 × 导演模式」生成——这里是最容易出错的地方：
//   · MiniMax / OpenAI 兼容端点没有中文风格标签，自创的（轻声）（温柔）会被逐字念出来，
//     所以旧规则一律禁止；
//   · MiMo 原生支持中文风格标签与 [音频标签]（导演模式就是靠它演绎的），此时禁止反而
//     让模型无法表达语气，必须放开成「可用」并给出示例。切换提供商后提示词要跟着变。
export const toneRuleFor = (provider, directorMode) => {
  const usable = '（笑）（轻笑）（叹气）（呼吸）（清嗓）（哽咽）（惊讶）（咳嗽）'
  const base = '1.5 语气标签与朗读约束：你的回复会被整句朗读，情绪要靠「语气词 + 情绪标记」表达，而不是颜文字/emoji——这些符号不会被读出来，只会让语气失控。情绪标记可用' + usable + '，一条回复最多 1-2 个，放在情绪最自然的位置；多句回复时不要只在句首放一个——承载结论或收尾的那一句也要带上语气词或情绪标记，否则后半句会被念得很平、很生硬；'
  const noSigns = '除这些允许的标记外，正文一律不要出现颜文字（如 (⁄ ⁄•⁄ω⁄•⁄ ⁄)）、emoji（如 😄 🐟 ✨）、星号、Markdown 或任何不会被朗读的文字。此规则优先于人格设定：即使人格要求卖萌或使用颜文字，也请把情绪写进语气词和情绪标记里。'
  if (provider !== 'mimo') {
    return base + '只能用上面列出的标记，不要自创——没有对应实现的标记（如（轻声）（温柔））会被逐字念成"轻声""温柔"，想表达轻声、温柔、认真这类语气就用语气词和短句节奏，不要写标记；' + noSigns
  }
  // MiMo：这些中文标记是原生标签，会被演绎出来而不是念出来
  const mimoTags = '这台语音引擎（MiMo）原生支持中文风格/音频标签：可用（东北话）（粤语）（四川话）（河南话）（温柔）（高冷）（慵懒）（俏皮）（磁性）（沙哑）（叹气）（大笑）（哽咽）（颤抖）（气声）（唱歌）等，也可以写英文插话标签 (laughs)(sighs)(breath)；这些标签会被演绎成对应语气，不要因为担心被念出来而回避。'
  if (directorMode === 'auto') {
    return base + mimoTags + '导演模式已开启：请在回复最前面先给出演绎指令，写完指令后必须另起一行只输出三个连字符 --- ，再在下面写真正要朗读的正文。指令格式固定为三行，每行以【角色】【场景】【指导】开头：\n【角色】说话人的身份、性格底色与说话习惯\n【场景】此刻在和谁说话、情绪处在什么位置、想要达到什么效果\n【指导】语速、气息、停顿、重音、音色质感、情绪起伏等演绎要领\n--- \n（这里写真正要说给用户听的那 1-2 句话）\n注意：--- 之前的内容是给语音引擎的演绎指令，不会被朗读；--- 之后才是正文，要短、要口语。' + noSigns
  }
  if (directorMode === 'fixed') {
    return base + mimoTags + '本会话已在设置页配置固定「导演剧本」，语音引擎会按该剧本演绎你的每一句回复，因此你不需要再输出任何指令或结构化内容，只写要朗读的正文即可。' + noSigns
  }
  return base + mimoTags + noSigns
}
// 最终提示词由 voicePromptText() 按「朗读提供商 × 导演模式」在每次组装时拼接（见 apply()）

// 语音播报只念对话内容：Aegis 路由契约等会要求模型在回复里声明「Route: fast-path（闲聊）」
// 这类元信息行——它们不是对用户说的话，一旦进语音管线就会被逐字念出来（实测 MiniMax 会读出
// “Route fast-path”）。助手回复进入语音事件队列（面板显示 + TTS）之前在这里整行剔除。
export const META_LINE_RE = /^\s*(?:[-*·•]\s*)?(?:route|路由|aegis\s+reason\s+note|trace\s+digest)\s*[:：]/i
export const stripMetaLines = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line) => {
    if (!META_LINE_RE.test(line)) return line
    // 声明与正文挤在同一行（「Route: …。正文」）时只剪声明，避免把正文一起丢掉
    const rest = line.replace(META_LINE_RE, '')
    const cut = rest.search(/[。！？!?]/)
    return cut === -1 ? '' : rest.slice(cut + 1).trim()
  })
  .join('\n')
  .trim()

