# dsh-voice-call 语音通话助手

DSH Web GUI 的个人语音通话助手插件：悬浮球通话面板、FunASR 语音识别（流式/HTTP）、云端 TTS 语音回复、子代理任务分发与进度跟踪。

## ✨ 功能

- 🎙 **悬浮球通话面板**：页面最顶层悬浮球，可拖拽，点击展开通话/任务/设置面板
- 🗣 **语音识别**：FunASR Server HTTP（新版 v1.x，默认）/ FunASR 流式 ws://（旧版 2pass）/ 云端 API（OpenAI 兼容），设置可切换
- 🔊 **语音回复（TTS）**：MiniMax TTS 或 OpenAI 兼容 TTS，可开关；支持最大字数截断检测、语速调节
- 📋 **任务分发**：语音会话（主会话）通过 `voice_task` 工具或面板把任务分发给**独立子代理会话**执行；主会话可查看进度、接收完成结果
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

1. 点右下角 🎙 悬浮球（重启后自动出现）
2. 设置页配置语音识别引擎与 TTS（FunASR 模式 URL 填 `http://127.0.0.1:10095/v1/audio/transcriptions`，模型 `fun-asr-nano`）
3. 「▶ 开始通话」→ 直接说话 → **停顿 1.2 秒自动识别并发送**（VAD 实时监听，无需点结束）→ 助手回复自动语音朗读
4. 支持连续多轮对话：每说一句停顿一下即可，助手回复播放期间麦克风自动静音防回声
5. 「任务」页或语音说"帮我查一下…"分发子代理任务
6. 「⏹ 结束通话」停止监听（当前未说完的半句也会补发）

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
├── index.js   # Host 半：任务分发(agents.create 子代理)、语音文本注入(agent.followup)、
│              # TTS/云端ASR 中转(subprocess node 桥，payload 走 stdin 避免命令行长度限制)、
│              # /api/voice-call/* 路由、voice_task 动态工具、voiceAssistant 服务、session/event 监听
└── client.js  # Client 半：悬浮球(shell.overlay slot)、通话面板、VAD 实时监听(ScriptProcessor
               # RMS 能量检测 + 停顿分段)、FunASR HTTP 整段识别、TTS 播放防自听、localStorage 设置
```

### 设计要点

- **实时监听（VAD）**：浏览器端 ScriptProcessor 采集 16kHz PCM，RMS 能量检测说话起止；静音达到 `vadSilenceMs`（默认 1200ms）自动把该段编码为 WAV 上传识别并发送——类似 hermes-voice-call 的 LISTENING→THINKING→SPEAKING 状态机，但完全在浏览器端实现
- **防回声自听**：TTS 回复播放期间（按文本长度估算时长）VAD 静默，`onended` 后恢复监听
- **任务分发**：`agents.create` 创建独立子代理会话（`va-task-*`），携带主会话最近摘要作为共享记忆；完成时 `agent.inject` 结果到主会话
- **语音文本注入**：`agent.followup`（source:user）——与打字完全一致，会话历史可见
- **网络桥**：Host 无 fetch 全局，TTS/云端 ASR 通过 `subprocess` spawn node 脚本执行 POST；payload 经 **stdin** 传入（Windows 命令行 ~32KB 限制，argv 传音频 base64 会 `spawn ENAMETOOLONG`）
- **事件推送**：Host 维护事件队列（回复文本/任务状态），Client 轮询 `/api/voice-call/events`
- **不影响其他插件**：独立 slot id、工具 execute 内校验调用者、`voiceAssistant` 服务只读

## 📄 License

MIT
