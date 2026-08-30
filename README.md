# dsh-voice-call 语音通话助手

DSH Web GUI 的个人语音通话助手插件：悬浮球通话面板、FunASR 语音识别（流式/HTTP）、云端 TTS 语音回复、子代理任务分发与进度跟踪。

## ✨ 功能

- 🗂 **专属工作区与专属会话**：安装并打开后自动创建专属工作区「语音通话」（目录 `$DSH_HOME/voice-call`）与专属会话 `voice-call-main`；**所有语音通话固定保存在该会话，本体重启后依然延续同一会话**（自动 resume）
- ⚡ **快速回复**：专属会话自带「快速、简短回复」提示词，并限制重型工具（bash/pwsh/run_code/工作流/子代理等），需要执行任务时一律通过 `voice_task` 分发给独立子代理会话
- 🎙 **悬浮球通话面板**：页面最顶层悬浮球，可拖拽，点击展开通话/任务/设置面板
- 🗣 **语音识别**：FunASR Server HTTP（新版 v1.x，默认）/ FunASR 流式 ws://（旧版 2pass）/ 云端 API（OpenAI 兼容），设置可切换
- 🔔 **唤醒词通话模式（可选）**：只有说出唤醒词（默认「小鲸鱼」，可改）才唤醒对话——仅唤醒词回「我在」，唤醒词后带指令（如「小鲸鱼帮我打开qq」）会去掉唤醒词后直接执行；沉默超过设定时长（默认 8 秒，可调）自动休眠；**建议使用本地部署的 ASR 进行语音识别**（语音不出本机、延迟低，唤醒更可靠）
- 🔊 **语音回复（TTS）**：MiniMax TTS 或 OpenAI 兼容 TTS，可开关；支持最大字数截断检测、语速调节
- 📋 **任务分发**：语音会话（主会话）通过 `voice_task` 工具或面板把任务分发给「语音通话」工作区下的**独立任务会话**执行（自带完整文件/代码/搜索工具；**上下文将满时自动新开一个任务会话续接**）；主会话可查看进度、接收成功/失败汇报
- 📢 **其他会话完成播报**：实时跟踪其他会话的任务完成情况（会话完成一轮 / 后台 job 完成），「动态」页签可查看记录，完成时自动**简要语音播报**（`「会话名」完成任务：内容`）；跳过专属语音会话、子代理会话与你当前正在查看的会话；可在设置里关闭播报
- 🧠 **共享记忆**：任务子代理携带主会话上下文摘要；语音会话即主会话（共享历史）
- 👤 **人格设置**：可配置人格，留空用默认
- 🔔 **主动功能**：Host 定时检查任务进度，完成时注入主会话并推送
- 🔌 **联动**：提供 `voiceAssistant` 只读服务，其他插件（如桌宠）可读取任务/状态

## 📦 安装（持久化）

本插件是持久插件，重启 DSH 后仍在「设置 → 插件」中可见。

```bash
# 1. 克隆或放置源码目录
git clone https://github.com/biliye/dsh-voice-call.git ~/.dsh/voice-call-plugin

# 2. 在 web profile 中安装（file: 依赖 + bundles 挂载）
#    在 ~/.dsh/profiles/web/package.json 添加：
#    依赖: "@biliye/dsh-voice-call": "file:../../voice-call-plugin"
#    bundles 追加: "@biliye/dsh-voice-call"
cd ~/.dsh/profiles/web && pnpm install

# 3. 重启 DSH
```

安装后验证：`dsh --profile web --dump-config | grep voice-call` 应输出 `- id: voice-call`。

## 🚀 使用

0. **专属工作区自动就绪**：安装并重启 DSH 后，Host 会自动创建专属工作区「语音通话」与专属会话 `voice-call-main`（失败自动重试；会话被删除也会自动重建）。侧边栏可见该工作区，语音内容全部保存在此会话中，重启后依然延续
1. 点右下角 🎙 悬浮球（重启后自动出现）
2. 设置页配置语音识别引擎与 TTS（FunASR 模式 URL 填 `http://127.0.0.1:10095/v1/audio/transcriptions`，模型 `fun-asr-nano`）
3. 「▶ 开始通话」→ 直接说话 → **停顿 1.2 秒自动识别并发送**（VAD 实时监听，无需点结束）→ 助手回复自动语音朗读
4. 支持连续多轮对话：每说一句停顿一下即可，助手回复播放期间麦克风自动静音防回声
5. 「任务」页或语音说"帮我查一下…"分发子代理任务（专属会话会快速简短回复，耗时任务交给子代理执行）
6. 「⏹ 结束通话」停止监听（当前未说完的半句也会补发）
7. **唤醒词模式（可选）**：设置页开启「唤醒词通话模式」，配置唤醒词与「沉默多少秒后休眠」（默认 8 秒）后开始通话：休眠时只有听到唤醒词才唤醒对话——说「小鲸鱼」→ 回「我在」；说「小鲸鱼帮我打开qq」→ 去掉唤醒词后直接执行，回「好的」；沉默超时自动休眠。💡 **建议使用本地部署的 ASR 进行语音识别**（如本机 FunASR Server `http://127.0.0.1:10095`）：语音不出本机、识别延迟低，唤醒更可靠；使用云端 ASR 时每段语音都会上传，唤醒响应也受网络影响

> **专属会话说明**：语音输入始终发送到专属会话（而非当前打开的会话），所有历史对话都保存在那里；面板可点「📂 打开会话」跳转到该会话查看完整记录。

### 前置依赖

| 组件 | 说明 |
|---|---|
| FunASR Server | 新版 v1.x：`funasr-server --port 10095`（OpenAI 兼容 HTTP，模型 fun-asr-nano / sensevoice；浏览器端 VAD 分段后整段上传识别） |
| node | ≥ 18（Host 端 TTS/ASR 网络桥需要 `node` 在 PATH 中） |
| TTS | MiniMax API Key + GroupId，或 OpenAI 兼容端点 + Key（可选） |

> **注意**：Host 半（`lib/index.js`）改动需重启 DSH 生效；Client 半（`lib/client.js`）改动会经 HMR 自动重载，刷新浏览器即可。

## 🏗 架构

```
lib/
├── index.js   # Host 半：专属工作区/会话自动创建(workspaceRegistry + agents.create/resume，
│              # 固定 ID voice-call-main 跨重启保持)、任务分发(语音通话工作区下新建 va-task-*
│              # 任务会话，上下文满自动续接新会话，监听进程定时巡检完成/失败并汇报主会话)、
│              # 语音文本注入(agent.followup)、TTS/云端ASR 中转(subprocess node 桥，
│              # payload 走 stdin 避免命令行长度限制)、/api/voice-call/* 路由、
│              # voice_task 动态工具、voiceAssistant 服务、session/event 监听
└── client.js  # Client 半：悬浮球(shell.overlay slot)、通话面板、VAD 实时监听(ScriptProcessor
               # RMS 能量检测 + 停顿分段)、FunASR HTTP 整段识别、TTS 播放防自听、
               # 唤醒词通话模式(handleRecognizedText 统一入口：休眠/唤醒状态机、
               # 唤醒词匹配与剥离、沉默超时自动休眠、可配置唤醒词/休眠时长)、
               # localStorage 设置、专属工作区/会话状态轮询与「打开会话」
```

### 设计要点

- **专属工作区/会话**：启动后自动创建 `$DSH_HOME/voice-call` 目录并在 workspaceRegistry 注册「语音通话」工作区；专属会话固定 ID `voice-call-main`——已存活直接复用、已持久化则 `agents.resume`、否则 `agents.create` 并固定标题、关联工作区。因此**无论本体重启多少次，语音通话始终落在同一会话**。会话被删除/卸载时由 30 秒巡检自动重建
- **快速回复**：专属会话通过 `setup` 注册 scoped systemPrompt 段落（快速简短回复 + 任务外派指引），每次 create/resume 都会重新注册，重启后依然生效；同时 `tools.restrict` 屏蔽 bash/pwsh/run_code/工作流/子代理等重型工具（工具名因部署而异，失败自动跳过）
- **实时监听（VAD）**：浏览器端 ScriptProcessor 采集 16kHz PCM，RMS 能量检测说话起止；静音达到 `vadSilenceMs`（默认 1200ms）自动把该段编码为 WAV 上传识别并发送——类似 hermes-voice-call 的 LISTENING→THINKING→SPEAKING 状态机，但完全在浏览器端实现
- **防回声自听**：TTS 回复播放期间（按文本长度估算时长）VAD 静默，`onended` 后恢复监听
- **任务分发**：每个任务在「语音通话」工作区下新建一个任务会话（`va-task-*`，命名「语音任务: 标题」），携带主会话最近摘要作为共享记忆；任务会话创建时加入 agent preset（优先继承父会话已加入的组合，否则挂载部署默认 preset，通常为 `standard`），因此具备完整的文件读写 / shell / 搜索 / 代码执行工具；任务会话完成**后保留在工作区可查看**。宿主侧**监听进程**（默认每 15 秒，可配置 `taskPollMs`）定时巡检任务会话：上下文占用达到模型窗口约 80%（可配置 `taskContextLimit`，自动探测失败时回退 120k tokens）且任务未完成时，自动**新开一个任务会话续接**（携带进度摘要、标题加「（续接 N）」），并停止旧会话的当前轮；任务会话空闲且产出最终文本 → 判定**成功**，空闲但超时（默认 1 小时，可配置 `taskTimeoutMs`）/ 会话销毁 / 续接失败 → 判定**失败**，均向主会话注入「已完成（成功）/ 失败：原因」汇报；续接上限默认 4 次（`taskRolloverMax`）
- **语音文本注入**：`agent.followup`（source:user）——与打字完全一致，会话历史可见
- **网络桥**：Host 无 fetch 全局，TTS/云端 ASR 通过 `subprocess` spawn node 脚本执行 POST；payload 经 **stdin** 传入（Windows 命令行 ~32KB 限制，argv 传音频 base64 会 `spawn ENAMETOOLONG`）
- **事件推送**：Host 维护事件队列（回复文本/任务状态），Client 轮询 `/api/voice-call/events`
- **不影响其他插件**：独立 slot id、工具 execute 内校验调用者、`voiceAssistant` 服务只读

## 📄 License

MIT
