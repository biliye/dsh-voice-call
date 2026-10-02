# dsh-voice-call 语音通话助手

DSH 桌面端与 Web GUI 的个人语音通话助手插件：悬浮球通话面板、本地 SenseVoice / FunASR 语音识别、云端 TTS 语音回复、子代理任务分发与进度跟踪。

> **支持的 DSH 端**：**桌面端（DSH 桌面应用，profile 名 `desktop`）** 与 **Web 端（`dsh web`，profile 名 `web`）** 用的是同一套插件机制，本插件两边的 Host / Client 代码完全一致——下面所有命令把 `--profile web` 换成 `--profile desktop` 即可（不确定自己的 profile 名时，看 `~/.dsh/profiles/` 下的目录名，或 `dsh --help` 里的默认 profile）。本机实测：桌面端与 Web 端各有一份 profile，同一份源码用 junction 挂进两边的 `node_modules`，两边的 `dsh.profile.bundles` 里都有本插件；**桌面端运行时** `GET /api/voice-call/state` 返回 `ready: true`（插件在桌面端加载正常）。

## ✨ 功能

- 🗂 **专属工作区与专属会话**：安装并打开后自动创建专属工作区「语音通话」（目录 `$DSH_HOME/voice-call`）与专属会话 `voice-call-main`；**所有语音通话固定保存在该会话，本体重启后依然延续同一会话**（自动 resume）
- ⚡ **快速回复**：专属会话自带「快速、简短回复」提示词，并限制重型工具（bash/pwsh/run_code/工作流/子代理等），需要执行任务时一律通过 `voice_task` 分发给独立子代理会话
- 🎙 **悬浮球通话面板**：页面最顶层悬浮球，可拖拽，点击展开通话/任务/设置面板
- 🗣 **语音识别**：本地 SenseVoice（**复用 DSH「语音输入」插件已下载的模型**，免装模型、免 FunASR Server）/ FunASR Server HTTP（新版 v1.x，默认）/ FunASR 流式 ws://（旧版 2pass）/ 云端 API（OpenAI 兼容），设置可切换
- ⏹ **停止任务**：对执行中的任务提供面板「⏹ 停止」按钮、`voice_task`（`action=stop`）以及 HTTP `POST /api/voice-call/task-stop` 三种停止入口；停止后任务状态为「已停止」并语音播报
- 🔎 **任务会话可打开**：任务会话以普通工作区会话创建，可在「语音通话」工作区列表打开，实时查看执行过程（工具调用/中间输出），也可用会话页的停止控件中断任务
- 🔔 **唤醒词通话模式（可选）**：只有说出唤醒词（默认「小鲸鱼」，可改）才唤醒对话——仅唤醒词回「我在」，唤醒词后带指令（如「小鲸鱼帮我打开qq」）会去掉唤醒词后直接执行；沉默超过设定时长（默认 8 秒，可调）自动休眠；**建议使用本地部署的 ASR 进行语音识别**（语音不出本机、延迟低，唤醒更可靠）
- 🔊 **语音回复（TTS）**：MiniMax TTS、**MiMo-V2.5-TTS（支持导演模式）** 或 OpenAI 兼容 TTS，可开关；支持最大字数截断检测、语速调节；**朗读用的文本由 Host 统一准备**——客户端把助手回复**原样**上送，Host 先分离导演指令块、再按「朗读正文」字数预算压缩（语音场景按一句话的体量给到 100 字上限，取第一句；设置里的最大字数更小时听设置的），最后才转语气标签；语音助手按语气在回复中加入情绪标记（如（笑）（叹气）），MiniMax speech-2.8 系列会以对应语气/插话朗读（默认模型 speech-2.8-hd，账号不支持时自动回退 speech-02-hd），OpenAI 兼容 TTS 与旧模型自动剥离标记只读正文；朗读前自动清理 emoji/颜文字等不可读符号，并整行剔除 `Route: …` 这类路由/流程元信息行（避免把声明念出来）；没有对应实现的「朗读方式」标记（如（轻声）（温柔））在 MiniMax/OpenAI 上会剥掉——它们只有 `(laughs)/(sighs)` 这类插话标签，自创标记留着会被逐字念成"轻声"；**每次 TTS 请求的文本、模型、是否回退都记在 `$DSH_HOME/logs/voice-call-tts.log`**（保留最近 200 行，含导演模式指令长度与「跳过朗读」标记，供排障）
- 🎬 **MiMo 导演模式**：MiMo-V2.5-TTS 走 OpenAI 兼容的 `chat/completions`——**朗读正文放 `role: assistant`，演绎指令（【角色】【场景】【指导】）放 `role: user`**，两条通道分开，指令本身不会被朗读。支持三态：**关闭**（只读正文）、**固定剧本**（设置页写一段【角色/场景/指导】，每次朗读都用它演绎）、**每轮自动**（助手每轮自带结构化指令，用 `---` 分隔，面板只显示正文）。MiMo 原生支持中文风格/音频标签（东北话/粤语/唱歌/叹气/大笑…），开启后会**原样保留**交给模型演绎（MiniMax/OpenAI 端则自动剥掉，避免被逐字念出来）；语速在 MiMo 上没有独立参数，请写进【指导】。**指令块存不存在是文本本身的结构，与朗读提供商/导演模式无关**：只要解析出「三段标记 + `---` + 正文」就只朗读正文（回复在 auto 下生成、朗读端后来切到 MiniMax 时同样读正文，不会静默）；**解析不出分隔符（含正文里混进第二段指令）时该轮整段跳过朗读并向面板报原因，绝不把指令念出来**
- 🗣 **MiMo 音色克隆（VoiceClone）**：模型选 `mimo-v2.5-tts-voiceclone` 就用「克隆样本」那段音频的音色说话。官方**没有 voice_id 注册**这一步，样本以 DataURL 随**每次**合成请求发出（`audio.voice`），所以样音越短越省时间；样本仅支持 mp3/wav、base64 ≤ 10MB。样本路径留空时自动用插件数据目录 `$DSH_HOME/voice-call/voice-clone/` 下的样音（优先 `sample.mp3`）。样本缺失/格式不对/超限时**直接报错，绝不悄悄退回预置音色**。⚠ 只应克隆你本人或已获明确授权的声音

- 📋 **任务分发**：语音会话（主会话）通过 `voice_task` 工具或面板把任务分发给「语音通话」工作区下的**独立任务会话**执行（自带完整文件/代码/搜索工具；**上下文将满时自动新开一个任务会话续接**）；主会话可查看进度、接收成功/失败汇报；**可随时停止任务**（面板「⏹ 停止」、语音说"停止任务"、`voice_task action=stop`，或打开任务会话后用 GUI 停止）
- 📢 **其他会话完成播报**：实时跟踪其他会话的任务完成情况（会话完成一轮 / 后台 job 完成），「动态」页签可查看记录，完成时自动**简要语音播报**（`「会话名」完成任务：内容`）；跳过专属语音会话、子代理会话与你当前正在查看的会话；可在设置里关闭播报
- 🧠 **共享记忆**：任务子代理携带主会话上下文摘要；语音会话即主会话（共享历史）
- 👤 **人格设置**：可配置人格，留空用默认。**朗读听着发平、像念稿时**（常见于播报/总结这类书面语域），除插件自带的朗读约束（情绪标记不要只在句首给一个、转述用口语短句）外，还可以在人格里补一句，例如：「每句话都像跟人聊天，别用汇报腔；承载结论的结尾句也要带语气词或情绪标记，不要只在句首给一个」
- 🔔 **主动功能**：Host 定时检查任务进度，完成时注入主会话并推送
- 🔌 **联动**：提供 `voiceAssistant` 只读服务，其他插件（如桌宠）可读取任务/状态

## 📦 安装（持久化）

一条命令即可，**不需要手工编辑 `~/.dsh/profiles/web/package.json`**：本插件的 `package.json` 声明了 `dsh.bundle`，`dsh plugin add` 在 pnpm 装完后会把依赖自动追加到 profile 的 `dsh.profile.bundles` 层。

三条都可用（均已在 2026-09-12 实测；推荐 ① / ②，都不依赖 GitHub 连通性）：

```bash
# ① npm（已发布 0.4.0；走 npm registry，可配国内镜像，不依赖 GitHub）
dsh plugin --profile web add @biliye/dsh-voice-call

# ② 预构建 tarball（不必拉取整仓 git 历史，也没有需要授权的 build 脚本）
#    每个 v* tag 由 .github/workflows/release.yml 自动产出该附件
dsh plugin --profile web add "https://github.com/biliye/dsh-voice-call/releases/latest/download/dsh-voice-call.tgz"

# ③ GitHub 源码直装（依赖 GitHub 连通性，国内可能需要代理）
dsh plugin --profile web add github:biliye/dsh-voice-call
```

**桌面端 DSH 同理**，把 profile 换成桌面端的即可（默认 `desktop`）：

```bash
dsh plugin --profile desktop add @biliye/dsh-voice-call
dsh plugin --profile desktop add "https://github.com/biliye/dsh-voice-call/releases/latest/download/dsh-voice-call.tgz"
dsh plugin --profile desktop add github:biliye/dsh-voice-call
```

装完重启 DSH（本次改动在 Host 半）：`dsh plugin` 只装包，不会替你重启。

```bash
dsh --profile web --dump-config | grep voice-call        # 应输出 - id: voice-call
dsh --profile web --dump-config | Select-String voice-call   # Windows PowerShell
dsh --profile desktop --dump-config | Select-String voice-call   # 桌面端同理
```

> 收录进插件市场后，用户也可以在「设置 → 插件市场」里搜索 `dsh-voice-call` 一键安装（安装来源同上，优先用 tarball）。投稿入口与步骤见 [`contrib/README.md`](contrib/README.md)。

### 本地开发安装

源码就在本机时直接用路径安装：

```bash
dsh plugin --profile web add .        # 相对路径按当前目录解析，不会误链到 profile 自身
dsh plugin --profile desktop add .    # 桌面端同理
```

> ⚠ **这条命令在 `nodeLinker: hoisted` 的 profile 下不会产生软链，而是把包目录整个拷进
> `node_modules`。** 后果是：你改工作区源码、重启 DSH、刷新浏览器，界面依旧没变化——因为 DSH
> 加载的是那份旧拷贝，改动从未进入加载路径（本插件实测踩过：下拉里始终看不到新加的 MiMo）。
> 判断方法是对比两处同名文件的字节数/哈希：
>
> ```powershell
> $dep = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@biliye\dsh-voice-call\lib\client.js"
> (Get-Item $dep).Length; (Get-FileHash $dep).Hash
> (Get-Item .\lib\client.js).Length; (Get-FileHash .\lib\client.js).Hash   # 两者不一致就是拷贝式安装
> ```
>
> 想让改动每次都自动生效，把部署目录换成指向源码的 junction（仅影响这一个包，可回滚）：
>
> ```powershell
> $dep = "$env:USERPROFILE\.dsh\profiles\web\node_modules\@biliye\dsh-voice-call"
> Copy-Item $dep "$dep.bak" -Recurse -Force      # 备份，便于回滚
> Remove-Item $dep -Recurse -Force
> New-Item -ItemType Junction -Path $dep -Target (Resolve-Path .).Path
> ```
>
> 换成 junction 后：改 `lib/client.js` 刷新浏览器即生效，改 `lib/index.js` 需重启 DSH。
> 注意**不要再对 profile 跑 `dsh plugin add` / `pnpm install`**——它们会把 junction 覆盖回拷贝。
>
> ⚠ **换成 junction 后，源码目录必须自带 `node_modules`（踩过一次，代价是 DSH 起不来）。**
> 宿主半边 `lib/index.js` 顶部的 `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-home-paths` 是裸导入，
> 而 Node 解析 ESM 会先把 junction 还原成真实路径 `F:\xiangmu\project1\lib\index.js`，再**只从源码
> 目录往上**找 `node_modules`——profile 里那套依赖从此够不着，启动即报：
>
> ```text
> Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
> failed to import loader entry voice-call (@biliye/dsh-voice-call):
> Cannot find package '@deepseek-ai/dsh-tools' imported from F:\xiangmu\project1\lib\index.js
> ```
>
> 拷贝式安装不会踩这个坑，是因为包目录本来就在 `profiles/web/node_modules` 里，往上走一层就能命中
> `profiles/node_modules`（dsh 启动时会把整棵依赖 fallback 维护在那里）。补一条指回该目录的 junction
> 即可恢复（junction 不需要管理员权限）：
>
> ```powershell
> $src = (Resolve-Path .).Path
> New-Item -ItemType Directory -Force "$src\node_modules" | Out-Null
> New-Item -ItemType Junction -Path "$src\node_modules\@deepseek-ai" `
>   -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
> ```
>
> 链到 `@deepseek-ai` 这一层而不是单个包：dsh 升级后 profile 里那批 fallback 软链会被自动重指到
> 新的 npx 安装目录，这条 junction 跟着走，无需手工维护；以后新增任何 `@deepseek-ai/*` 导入也不用再补链。
> `node_modules` 已在 `.gitignore` 里，但 `git clean -xfd` 会连它一起删掉，清完要重建。

### 升级 / 卸载

```bash
dsh plugin --profile web update @biliye/dsh-voice-call    # 或 github:biliye/dsh-voice-call / tarball 地址
dsh plugin --profile web remove @biliye/dsh-voice-call
dsh plugin --profile desktop update @biliye/dsh-voice-call   # 桌面端同理
```

> 旧的手工安装方式（克隆到 `~/.dsh/voice-call-plugin`、手写 `file:` 依赖 + `bundles` 条目、再 `cd ~/.dsh/profiles/web && pnpm install`）已不再需要，也不再写进本文档：那三步里唯一真正必要的是 pnpm 装包，而 `dsh plugin add` 已经把它和 bundles 挂载一起做了。已在用旧方式安装的机器无需迁移，`dsh plugin --profile web update @biliye/dsh-voice-call` 即可切到新来源。

## 🚀 使用

0. **专属工作区自动就绪**：安装并重启 DSH 后，Host 会自动创建专属工作区「语音通话」与专属会话 `voice-call-main`（失败自动重试；会话被删除也会自动重建）。侧边栏可见该工作区，语音内容全部保存在此会话中，重启后依然延续
1. 点右下角 🎙 悬浮球（重启后自动出现）
2. 设置页配置语音识别引擎与 TTS（FunASR 模式 URL 填 `http://127.0.0.1:10095/v1/audio/transcriptions`，模型 `fun-asr-nano`），没有安装这个或者电脑性能不够依然可以使用绝大部分功能，该悬浮窗窗口也提供了文字对话的功能
   - **推荐：不装任何 ASR 服务**——识别引擎选 **「本地识别 · 复用 DSH 语音输入模型（SenseVoice，免装模型）」**：只要在「设置 → 插件」里启用过官方插件 **语音输入**（`@deepseek-ai/dsh-experimental-voice-input-bundle`）并让它下载过一次模型（约 240MB，落在 `$DSH_HOME/speech-to-text/sensevoice/models/`），本插件就直接复用**同一批模型文件**：模型只存一份、语音不出本机、也不需要 Python/FunASR Server。
     设置页会直接显示状态，两种「就绪」含义不同，界面上会区分开：
       - **已就绪（识别进程在内存，可直接识别）**：`phase=ready`，说话即可，无额外等待；
       - **已缓存（模型在磁盘上，首句会自动唤醒）**：`phase=standby`——**识别进程在闲置约 5 分钟后会自动退出**（上游 `idleTimeoutMs` 默认 300000，本插件沿用），所以歇一会儿后再说话，第一句会多等 1–3 秒（拉起进程 + 加载 239MB 模型），期间面板显示「准备本地识别模型…」。
     点 **「🔄 检查 / 准备模型（唤醒识别）」** 会真的把识别进程拉起来并等到就绪（上限约 12 秒）再报告结果，结果同时显示在设置页状态行、按钮文字和对话记录里——不用先去说话试；旁边的「仅刷新状态」只查询、不触发。模型确实缺失时（首次使用）这个按钮和直接说话都会触发语音输入插件的下载流程（约 240MB，进度实时显示），就绪后自动重发刚才那句话。
     ⚠ 这条路径只吃 **16 kHz 单声道 WAV**，所以请保持「实时监听（VAD 分段）」开启；关掉实时监听改走 MediaRecorder 时，本插件会明确提示而不是拿 webm 去撞格式校验。
     🔍 排障：本地识别的每一步（是否真的触发了准备、provider 阶段、识别耗时与文本长度、失败原因）都记在 `$DSH_HOME/logs/voice-call-asr.log`（保留最近 400 行，不含音频内容）。
3. 「▶ 开始通话」→ 直接说话 → **停顿 1.2 秒自动识别并发送**（VAD 实时监听，无需点结束）→ 助手回复自动语音朗读
4. 支持连续多轮对话：每说一句停顿一下即可，助手回复播放期间麦克风自动静音防回声
5. 「任务」页或语音说"帮我查一下…"分发子代理任务（专属会话会快速简短回复，耗时任务交给子代理执行）；任务完成后会自动语音播报结果；需要中止时点任务卡「⏹ 停止」、在专属会话里说"停止任务"，或在打开的任务会话页直接停止
6. 「⏹ 结束通话」停止监听（当前未说完的半句也会补发）
7. **唤醒词模式（可选）**：设置页开启「唤醒词通话模式」，配置唤醒词与「沉默多少秒后休眠」（默认 8 秒）后开始通话：休眠时只有听到唤醒词才唤醒对话——说「小鲸鱼」→ 回「我在」；说「小鲸鱼帮我打开qq」→ 去掉唤醒词后直接执行，回「好的」；沉默超时自动休眠。💡 **建议使用本地部署的 ASR 进行语音识别**（如本机 FunASR Server `http://127.0.0.1:10095`）：语音不出本机、识别延迟低，唤醒更可靠；使用云端 ASR 时每段语音都会上传，唤醒响应也受网络影响
8. **用 MiMo 导演模式（可选）**：设置页「语音回复（TTS）」里的 **「TTS 模型」** 下拉切到 **MiMo-V2.5-TTS**，填 API Key（`platform.xiaomimimo.com` 控制台获取，**不需要 GroupId**）、选音色（内置 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean），再选导演模式：
   - 导演模式的三态（关闭 / 固定剧本 / 每轮自动）**常驻显示**，不随提供商隐藏；但如果「TTS 模型」不是 MiMo，界面会提示「导演模式只在选 MiMo 时生效」——剧本会保存，但不会发送，因为只有 MiMo 有 `user` 指令通道
   - **固定剧本**：在「导演剧本」框按官方三段式写一遍，之后每句回复都按它演绎（适合固定角色配音）：
     ```
     【角色】百年门阀岑家的现任大当家，绝情断欲、阶级疏离感极强
     【场景】在祠堂的阴影里，看着企图带她私奔的男人，要用阶级壁垒绞杀对方
     【指导】冰冷慵懒的低音御姐。语速极慢，每字像在舌尖滚过；句间留极长空白
     ```
   - **每轮自动**：助手每轮回复自带【角色/场景/指导】，再用 `---` 分隔真正要朗读的正文；面板只显示正文，指令不念出来（适合逐句变风格的角色扮演）
   - 语速：MiMo 没有独立语速参数，**写进【指导】**（如「语速极慢」「语速偏快」）
   - MiMo 认中文风格标签，正文里可以直接写（东北话）（粤语）（唱歌）（叹气）（大笑）这类标签，会被演绎而不是念出来
9. **克隆自己的音色（可选）**：MiMo 还有 `mimo-v2.5-tts-voiceclone`（音色复刻）。把 **「模型」** 改成 `mimo-v2.5-tts-voiceclone`，音色就来自「克隆样本」那段音频：
   - **样本怎么给**：设置页「克隆样本路径」填一个 `.mp3` / `.wav` 的绝对路径；**留空则用插件数据目录 `$DSH_HOME/voice-call/voice-clone/` 里的样音**（优先 `sample.mp3`，其次 `sample.wav`，再退到目录里任意一个 mp3/wav）。把样音丢进那个目录，设置页什么都不用填
   - **限制**：样本仅支持 mp3/wav，base64 ≤ 10MB（约 7.5MB 原始文件）；接口**没有「注册 voice_id」这一步**，样本是随每次朗读一起发出去的，所以样音越短越省时间——**15–30 秒的干净人声足够**（`ffmpeg -ss 20 -t 18 -i 原文件 -ac 1 -ar 32000 -b:a 96k sample.mp3` 这种一条命令裁到 200KB 上下）
   - 模型是 voiceclone 时，预置音色下拉会换成提示（音色由样本决定），导演模式与中文风格标签照常可用
   - 样本文件不存在 / 格式不对 / 超限时**直接报错，不会悄悄退回预置音色**——否则你会以为在用克隆音色却没克隆上
   - ⚠ 只应克隆你本人或已获明确授权的声音，不要用于冒充他人

> **专属会话说明**：语音输入始终发送到专属会话（而非当前打开的会话），所有历史对话都保存在那里；面板可点「📂 打开会话」跳转到该会话查看完整记录。

### 前置依赖

| 组件 | 说明 |
|---|---|
| 本地 SenseVoice（推荐） | 无需安装：在「设置 → 插件」启用官方 **语音输入** 插件（`@deepseek-ai/dsh-experimental-voice-input-bundle`）即可。它的 SenseVoiceSmall (ONNX int8) 与 sherpa-onnx 原生运行库随 DSH 提供，本插件通过宿主服务 `speechToText`（provider `sensevoice-local`）复用同一份模型缓存 `$DSH_HOME/speech-to-text/sensevoice/models/`，不额外下载模型 |
| FunASR Server | 新版 v1.x：`funasr-server --port 10095`（OpenAI 兼容 HTTP，模型 fun-asr-nano / sensevoice；浏览器端 VAD 分段后整段上传识别） |
| node | ≥ 18（Host 端 TTS/ASR 网络桥需要 `node` 在 PATH 中；本地 SenseVoice 走宿主内服务，不用这个桥） |
| TTS | MiniMax API Key + GroupId、MiMo API Key（`api.xiaomimimo.com`，无需 GroupId）、或 OpenAI 兼容端点 + Key（可选） |

> **注意**：Host 半（`lib/index.js`）改动需重启 DSH 生效；Client 半（`lib/client.js`）改动会经 HMR 自动重载，刷新浏览器即可。

### 🛠 维护参考

- **修复档案（已移出本仓库，不再上传 GitHub）**：`FIX-2026-09-08.md`（任务生命周期：任务完成不播报 / 状态卡死 / 无法停止 / 任务会话无法完整打开）、`FIX-2026-09-09.md`（其他会话完成播报改造为「合并进主会话」：唤醒词休眠误跳过 / 任务结果截断与转述指令 / 多窗口双播排查）与 **`FIX-2026-10-02.md`（0.4.0：本地识别复用语音输入模型 / DSH 会话格式 v4 的 source 契约让播报全丢）**——都含根因分析、修复内容与维护注意事项。现保存在本机 `F:\xiangmu\update\dshCallUpdate\fix\`；后续涉及任务分发/停止/会话模型、DSH 运行时 Session API 或**会话格式**升级、播报链路或唤醒词模式时，先读这几份档案。
- `contrib/README.md`：发行与收录档案——投稿到 awesome-dsh-plugin 精选列表（＝插件市场的唯一数据源）的条目文件、收录条件核对、tarball 链接防失效规则，以及 npm 发布与 `engines.dsh` 的可选项。改安装来源、发新版或补录 npm 之前先读该文件。
- **离线校验脚本**（在 `.debug/`，已 gitignore，不进 npm 包；改 TTS/朗读链路后先跑这两个）：
  - `node .debug/verify-voice-call-contracts.mjs`：插件消息 source 契约验证（**改 `messages.js` 或任何注入点后必跑**）——抽取真实源码求值，核对两代形状都对：v4 会话（`header.version >= 4`）产出 `{ kind:'plugin:voice-assistant', form, summary? }`、旧格式产出 `{ kind:'plugin', plugin:'voice-assistant', form, summary? }`，两者都必须满足 ContextFormed（notice 必带非空 string summary、其余 form 一律不得带 summary），并检查每个 `pluginSrc()` 调用点都把目标 agent 传了进来；后半段仍是跨版本核对 `sessionPersistence` 快照形状（`snapshot.header.id` / `listSnapshots` 特性探测）。
  - `node .debug/verify-announce-contracts.mjs`：播报链路回归——把 `announce.js → messages.js` 的真实代码跑一遍（假 ctx / 假 agent），确认「其他会话 + 后台任务完成」合并成一条 `notice` 后 `steer` 出去的消息，**用 app.asar 里 DSH 真实的 v4 `source()` 校验器验过**（v4 会话走新 kind、旧格式会话走老包装）；改播报链路或 `pluginSrc` 后必跑。
  - `node .debug/verify-against-dsh-source.mjs`（脚本里写死了本机 DSH 安装路径）：从 `app.asar` 抽出 DSH **真实**的 v4 `source()` 校验器复算——新 kind 必须被接受、旧 `kind:'plugin'` 必须被拒（复现 2026-10-02 事故根因），属于"拿宿主的代码验自己的假设"。
  - `node .debug/verify-mimo-tts.mjs`：MiMo 适配验证——导演指令块解析（含「解析失败必须跳过朗读」这条安全不变量）、语气/风格标签在各提供商下的保留与剥离、提示词按「提供商 × 导演模式」切换、文本准备链路（E 段：先分离指令块再压缩正文；含 2026-09-15 事故回归 E-6/E-7——客户端若自己折叠换行或提前截断，回复格式再正确也念不出来）、音色克隆样本解析（G 段：DataURL 编码与字节可还原、大小写扩展名、缺失/格式错/超 10MB 的报错、留空默认样音、缓存命中），以及用本地 mock 服务器核对真实请求形状（user=指令 / assistant=正文、认证头、audio 字段、voiceclone 的样本 DataURL）与 WAV/MP3 解码、错误路径。脚本直接抽取 `lib/index.js` 的真实源码求值，不复制被测逻辑。
  - `node .debug/verify-mimo-ui.mjs`：设置页渲染验证——用假 React 跑 `lib/client.js` 的真实渲染代码，检查「TTS 模型」下拉、MiMo 音色下拉、导演模式三态**在三个提供商下都可见**（这是修过的真实缺陷：原先导演模式被包在 `ttsProvider === 'mimo'` 条件里，用 MiniMax 时整块不渲染），以及本地识别模式的设置界面（出现 `value="sensevoice-dsh"`、显示模型缓存路径、**不再出现 FunASR 地址与 API Key**，并且切回 FunASR / 云端时旧输入框仍在）。
  - `node .debug/verify-local-asr-contracts.mjs`：本地识别（复用语音输入模型）契约验证——WAV 契约（16kHz 单声道 PCM16 才收；44 字节空录音、48kHz、webm、RIFF/data size 不一致、奇数长度 PCM 一律拒；**客户端 `encodeWav` 的真实产物必须通过**；本机 24kHz 真实录音必须被拒）、适配器各失败态（服务缺失 / provider 缺失 / 未准备 / 准备失败 / **prepare 抛错必须带出原因**）与就绪态的 `resolve`+`transcribe` 走通、**provider id 漂移时的自愈探测**，以及「`inject` 里不许出现 `speechToText`」这条硬依赖禁令。
  - `node .debug/verify-asr-routes.mjs`：ASR 路由契约验证——直接跑 `lib/host/routes.js` 真实注册的处理函数（网络桥用"一调用就抛错"的替身）：本地模式必须不打网络桥、未就绪必须回 `202 + needsPrepare`、服务缺失必须报错而**不静默换引擎上传**、FunASR/云端分支行为不变。
  - `$env:MIMO_API_KEY='...'; node .debug/live-mimo-smoke.mjs`：真实 API 冒烟（不写入 key，从环境变量读）——验证认证、导演模式请求形状、WAV/MP3 解码确实能出可播放音频，并把音频写到 `.debug/live-mimo-*` 供试听。
  - `node .debug/gen-settings-preview.mjs`：生成设置页静态预览（`.debug/settings-preview*.html`），可在不重启 DSH 的情况下先看界面。

## 🏗 架构

```
lib/
├── index.js            # DSH 插件入口：只导出 name / inject / apply（薄入口，9 行）
├── host/               # Host 半（在 DSH Node 进程里跑）
│   ├── plugin.js       # 装配层：唯一接触 ctx 注册面的地方（on/effect/interval/setTimeout/provide/register）
│   ├── config.js       # 插件身份、专属会话/工作区常量、快速回复提示词、语气规则、Route 元信息行剔除
│   ├── http.js         # /api/voice-call/* 路径表 + writeJson / readJsonBody
│   ├── state.js        # apply() 的共享可变状态（拆分前是 apply 的闭包变量）
│   ├── messages.js     # 语音事件队列 + 插件消息 source 契约（旧格式 plugin 包装 / v4 生产者 kind，ContextFormed）
│   ├── session.js      # 专属工作区/会话的创建与 resume、人格注入、快速回复提示词
│   ├── tasks.js        # 任务分发 / 巡检 / 上下文将满续接 / 完成·失败·停止结算
│   ├── announce.js     # 其他会话与后台 job 完成的跟踪与语音播报
│   ├── events.js       # session/event、agent/status 订阅 + 任务巡检 + jobs 监听
│   ├── routes.js       # 15 条 HTTP 路由（含本地识别的 /asr-status；只构造返回，注册交给装配层）
│   ├── expose.js       # voice_task 动态工具 + voiceAssistant 只读服务
│   └── speech/
│       ├── bridge.js   # subprocess node 桥（payload 走 stdin）+ 各提供商子进程脚本
│       ├── stt-local.js # 本地识别适配器：运行期探测 speechToText 服务并复用其 SenseVoice 模型缓存
│       ├── tone.js     # 语气标签 ⇄ 各 TTS 插件的插话/风格标签
│       ├── director.js # 导演模式「指令 + --- + 正文」结构解析
│       └── tts.js      # TTS 文本准备、请求、失败回退、发送记录、音色克隆样本
└── client.js           # Client 半（浏览器 bundle：悬浮球 slot、通话面板、VAD、唤醒词、设置页）
```

**分层规则**（完整设计与验收记录见仓库外的 `F:\xiangmu\update\dshCallUpdate\code-split-2026-09-15\`）：

- 依赖只向上：`config/http/state` ← `messages/speech` ← `session/tasks` ← `announce` ← `events/routes/expose` ← `plugin.js` ← `index.js`。
- `plugin.js` 是**唯一**调用 `ctx.on / effect / interval / setTimeout / provide / tools.register / webServer.register` 的地方——注册必须发生在 `apply()` 执行期间，否则停用插件时副作用会泄漏。
- `state.js` 的每个字段只有一个模块负责写入（模块头注释里写明），其余模块只读。
- **`client.js` 必须保持单文件预打包产物**（`window.__ModuleLoader__.load({id, factory})`），DSH 客户端加载器不接收多文件入口；因此 Client 半拆分需要构建步骤，本次未做。


### 设计要点

- **专属工作区/会话**：启动后自动创建 `$DSH_HOME/voice-call` 目录并在 workspaceRegistry 注册「语音通话」工作区；专属会话固定 ID `voice-call-main`——已存活直接复用、已持久化则 `agents.resume`、否则 `agents.create` 并固定标题、关联工作区。因此**无论本体重启多少次，语音通话始终落在同一会话**。会话被删除/卸载时由 30 秒巡检自动重建
- **快速回复**：专属会话通过 `setup` 注册 scoped systemPrompt 段落（快速简短回复 + 任务外派指引），每次 create/resume 都会重新注册，重启后依然生效；同时 `tools.restrict` 屏蔽 bash/pwsh/run_code/工作流/子代理等重型工具（工具名因部署而异，失败自动跳过）
- **实时监听（VAD）**：浏览器端 ScriptProcessor 采集 16kHz PCM，RMS 能量检测说话起止；静音达到 `vadSilenceMs`（默认 1200ms）自动把该段编码为 WAV 上传识别并发送——类似 hermes-voice-call 的 LISTENING→THINKING→SPEAKING 状态机，但完全在浏览器端实现
- **防回声自听**：TTS 回复播放期间（按文本长度估算时长）VAD 静默，`onended` 后恢复监听
- **任务分发**：每个任务在「语音通话」工作区下新建一个任务会话（`va-task-*`，命名「语音任务: 标题」），携带主会话最近摘要作为共享记忆；任务会话创建时加入 agent preset（优先继承父会话已加入的组合，否则挂载部署默认 preset，通常为 `standard`），因此具备完整的文件读写 / shell / 搜索 / 代码执行工具；任务会话完成后保留在工作区可查看。**任务会话以普通工作区会话身份创建**（不再标注 `origin=subagent`），因此可出现在工作区会话列表中，可打开、可实时查看过程、可被 GUI/面板/语音停止。宿主侧**监听进程**（默认每 15 秒，可配置 `taskPollMs`）定时巡检任务会话：上下文占用达到模型窗口约 80%（可配置 `taskContextLimit`，自动探测失败时回退 120k tokens）且任务未完成时，自动**新开一个任务会话续接**（携带进度摘要、标题加「（续接 N）」），并停止旧会话的当前轮；任务结算以**最后一次 `turn/end` 的 reason** 为准：`completed` → 成功、`aborted(user)` → 已停止、`error/interrupted/max-tokens/blocked` → 失败，均向主会话注入「已完成（成功）/ 已停止 / 失败：原因」汇报；空 idle 超时（默认 1 小时，可配置 `taskTimeoutMs`）/ 会话销毁 / 续接失败 → 判定**失败**；续接上限默认 4 次（`taskRolloverMax`）。停止由 `POST /api/voice-call/task-stop` 与 `voice_task action=stop` 触发：先标记 `stopped` 再 `agent.cancel`，避免被误判为完成
- **语音文本注入**：`agent.followup`（source:user）——与打字完全一致，会话历史可见
- **插件消息的 source 契约（两代会话格式，2026-10-02 修「插件没有自动播报」）**：完成播报 / 任务汇报 / 人格 / 就绪提示这些插件注入的通知都由 `lib/host/messages.js` 的 `pluginSrc()` 一处构造。**DSH 会话格式 v4 起**，解释型消息槽（`user/message`、`agent/inbox/spliced.inserted[]`、`assistant/message`、`tool/result`、`session/title-llm-request.messages[]`）的 `source.kind` 必须是「生产者自有」取值，字面量 `'plugin'` 会被**写入编码阶段**拒掉（`codec.encodeEvent → assertV4RowAdmission → assertV4SourceRowAdmission → source()`，报 `format v4 message requires a producer-owned source kind`）——注意不是"先写进去、以后加载失败"，而是 `steer / inject / followup` 当场抛错，表现就是**插件的完成播报整批静默丢失**（实测：语音会话最后一条记录停在用户上一次说话，`【完成播报】…` 一条都没进历史，而助手回复的 TTS 一切正常）。v4 用的 kind 取 `plugin:voice-assistant`：DSH 的 v3→v4 转换表把「非一方插件名」一律写成 `plugin:<原名>`，本插件的旧记录迁移后正是这个值（已在 `session.v4.jsonl.zstd` 里核对 130 条，`form` / `summary` 都保留），沿用它与历史同源、GUI 也当同一种通知渲染。**为什么不能一刀切换新 kind**：v2→v3 迁移阶段用 `SOURCE_KINDS` 白名单拒收它不认识的 source kind（`cannot safely transform unclassified message source`，白名单里只有 `plugin` 等老 kind、没有 `plugin:*`），在 v0–v2 会话里写新 kind，用户升级 DSH 时整个会话会无法迁移/加载（本插件栽过一次"专属会话无法加载"）。所以按**目标会话自己的格式版本**二选一：`agent.session.header.version >= 4` 用新 kind，旧格式或读不到版本时保持老包装（v4 宿主必定报告 4）。回归：`.debug/verify-voice-call-contracts.mjs` + `.debug/verify-against-dsh-source.mjs`。
- **网络桥**：Host 无 fetch 全局，TTS/云端 ASR 通过 `subprocess` spawn node 脚本执行 POST；payload 经 **stdin** 传入（Windows 命令行 ~32KB 限制，argv 传音频 base64 会 `spawn ENAMETOOLONG`）
- **本地识别（复用语音输入模型）**：`asrMode='sensevoice-dsh'` 时音频不再出宿主进程，也不经网络桥——Host 侧 `lib/host/speech/stt-local.js` 用 **运行期** `ctx.get('speechToText')` 探测官方语音输入插件提供的能力（`@deepseek-ai/dsh-experimental-speech-to-text` 的 `SpeechToText` 服务，provider 默认 `sensevoice-local`），把浏览器 VAD 分段的 16kHz 单声道 PCM16 WAV 交给它的 `resolve()` + `transcribe()`。**为什么不用 `inject` 声明**：cordis 的 `inject` 键全部是硬依赖（`Inject.resolve` 把数组项归一成 `null`），一旦声明，没安装/没启用语音输入的用户整个 voice-call 插件都会停在 PENDING 而不可用；运行期探测则只让这一个模式报出「请启用语音输入插件」的可照做错误。**为什么不做成一个长请求**：模型缺失时准备流程要下载约 240MB，浏览器请求等不起；`recognize()` 在未就绪时只触发 `provider.prepare()` 并立刻回 `202 + needsPrepare`，客户端轮询 `/api/voice-call/asr-status`（可带 `?prepare=1` 顺带推进）后重发同一段音频。**格式契约**：与语音输入插件同一套 `validateWave`（16kHz/单声道/PCM16/规范头，<46 字节与 >120 秒都拒），所以关掉「实时监听」走 MediaRecorder（webm/opus）时客户端会直接提示开启 VAD，而不是把不合规音频送到服务端再报错。**「检查 / 准备模型」按钮的两个坑（都踩过）**：① 结果曾经只塞进对话页签的 notice，而用户就停在设置页 —— 界面表现就是"点了没反应"，现在结果同时写进设置页状态行 + 按钮文字 + 对话记录；② `svc.prepare()` 的异常曾被整个 `try {} catch {}` 吞掉（provider id 对不上、服务被卸载都走这条路），同样表现为"点了没反应"，现在异常进 `prepareError` 原样回传并写日志。**provider 解析**：先按 `sensevoice-local` 精确匹配，匹配不到时退化为「id/名字含 sensevoice 且唯一」的那个——上游改了 defaultProvider 名字时能自愈，而不是静默什么都不做。**识别进程生命周期**：上游 `SenseVoiceWorker` 闲置约 5 分钟（`idleTimeoutMs=300000`）会终止 worker，所以 `standby` 是常态、`ready` 只在刚用过之后；`?prepare=1` 会同步等待（上限 12 秒）到进程起来再回答，让按钮点下去有确切结果
- **TTS 多提供商与导演模式**：三家走同一个 `ttsOnce` 入口，差异只在「文本怎么准备 + 请求怎么发」。文本准备（`prepareSpeech`）是**唯一**的准备点，顺序固定为**先分离导演指令块 → 再压缩正文 → 最后转换语气标签**——顺序写反的话，较长的 auto 回复会在 `---` 之前被截断，指令块再也解析不出来，导演模式就会静默失效。**客户端的职责只有一条：把助手回复原样上送**（`text: ev.text`）；它自己不做换行折叠、也不按字数提前截断——那两道处理会把「三段标记 + `---` + 正文」压成一整行并在正文之前截断，Host 拿到的文本结构已毁，只能整段跳过（2026-09-15 实测事故：回复格式完全正确却一个字都不念；回归用例见 `.debug/verify-mimo-tts.mjs` 的 E-6/E-7）。指令块的「存在性」由文本结构决定，与 `directorMode` 解耦：只有 auto 才把指令发到 MiMo 的 `user` 通道，但任何模式下解析成功就只朗读正文。MiMo 的请求体是 `chat/completions`：演绎指令放 `role: user`、朗读正文放 `role: assistant`（两条通道分离，指令不会被朗读），`audio.format` 默认 `wav`；MiniMax 仍是 `t2a_v2` 的 hex 音频。响应解码要**先按音频魔数判定容器**（ID3/MPEG/RIFF/fLaC/OggS）再回退到各家的编码假设（MiniMax=hex，MiMo=base64）——base64 字母表是 hex 的超集，只靠字符串形状分不开；`hasAudioMagic` 少了 RIFF 这一项时，MiMo 默认的 WAV 会被当成 hex 解成乱码字节。成功时回传 `sentChars`（实际朗读的正文字数），客户端的播放时长/静音窗口按它估算——用原始回复长度会把导演指令块算进去、把麦克风静音过久。**音色克隆**：`mimo-v2.5-tts-voiceclone` 的 `audio.voice` 不是预置音色 ID，而是**样本的 DataURL**（官方没有 voice_id 注册步骤，样本随每次合成请求发出）；Host 侧只由 `resolveCloneSample` 一处负责——显式路径优先，留空则用 `$DSH_HOME/voice-call/voice-clone/` 下的默认样音，按 (路径, 大小, mtime) 缓存 DataURL，仅 mp3/wav、base64 ≤10MB；样本不可用时**直接报错而不是退回预置音色**（否则用户以为克隆生效了，实际念的是别的嗓子）。**安全不变量**：一旦解析不出「三段标记 + `---` + 正文」的结构（含正文里混进第二段指令），该轮**整段跳过朗读**并向面板报原因，绝不把结构化指令当正文念出来

- **事件推送**：Host 维护事件队列（回复文本/任务状态），Client 轮询 `/api/voice-call/events`
- **不影响其他插件**：独立 slot id、工具 execute 内校验调用者、`voiceAssistant` 服务只读

## 📄 License

MIT
