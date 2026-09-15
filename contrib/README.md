# 把 dsh-voice-call 收录进插件市场（dsh-market）的可见列表

`contrib/biliye__dsh-voice-call.yml` 就是投稿的全部内容：把它复制成
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
仓库里的 `data/plugins/biliye__dsh-voice-call.yml`，开一个 PR 即可。

**不要往 [dsh-market](https://github.com/dsh-market/dsh-market) 提条目 PR**：那个仓库是市场应用本身，
它的条目数据全部来自 awesome-dsh-plugin 这份精选列表（`https://awesome-dsh-plugin.com/plugins.json`）。
市场与 [dshmarket.com](https://dshmarket.com)、[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)
共用同一份数据，所以收录一次，三处同时可见。

## 现状：已收录（2026-09-13 合并）

投稿已完成，**不需要再开 PR**：

| 项 | 值 |
|---|---|
| PR | [`awesome-dsh-plugin#4938`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4938)「Add biliye/dsh-voice-call (voice)」 |
| 提交 → 合并 | 2026-09-12T14:02:31Z → **2026-09-13T02:56:53Z，由维护者 `fkysly` 合并**（merge commit `0237826`） |
| 条目文件 | `data/plugins/biliye__dsh-voice-call.yml`（blob `c86e356`，915 字节，与 `contrib/biliye__dsh-voice-call.yml` 一致） |
| 分类 | `voice`（Voice & Audio） |
| tarball | `releases/latest/download/dsh-voice-call.tgz` → release `v0.2.2`，附件 44263B，已下载 17 次 |

核对方式（只读，无需登录）：

```sh
curl -s https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls/4938 | grep '"merged"'
curl -s -o /dev/null -w '%{http_code}\n' \
  https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/plugins/biliye__dsh-voice-call.yml
# 期望 200
```

### ⚠ 下载区域 = `china` 时市场看不到本插件（快照滞后，不是掉收录）

市场的目录源按**下载区域**分流（`dshmarket/src/regions.ts` 的 `ROUTES`）：

| 区域 | 目录源顺序 |
|---|---|
| `global` | 官网 `https://awesome-dsh-plugin.com/plugins.json` |
| `china` | ① npm 镜像上的 `dsh-plugin-catalog` 包 → ② 官网 URL（**仅在 ① 失败时**才用） |

`china` 的 ① 是**主源、不是兜底**：`registry.ts` 的 `loadRegistry()` 第一个成功的源就直接返回，所以镜像只要答得出来，就永远不会回退到官网。

而 `dsh-plugin-catalog` **只在夜间 cron（`23 2 * * *` UTC）或手动 dispatch 时发布**（`build-site.yml` 的 `publish the catalog to npm` 带 `if: schedule || workflow_dispatch`）；push 构建只部署官网、**不发**目录包。因此：

- 合并时 npm 上最新为 `dsh-plugin-catalog@2026.912.3199`（构建号 = workflow run number），**3561 条**，发布于 **2026-09-12T09:00:43Z**；
- 本条目 **2026-09-13T02:56:53Z** 才合并，比那份快照晚约 18 小时 → 快照里没有它；
- 官网由**每次 push** 的站点构建刷新（09-13T07:49Z 那轮已在合并之后），所以 `global` 区域当时即可见。

**结论：收录没有失败，是区域目录快照滞后。** 当天夜间构建 run `34745441479`（09-13T07:31:24Z 启动，run_number 3281）跑完并发布 `2026.913.3281` 后，`china` 区域即可见。

想立刻看到，三选一：

1. 市场「设置 → 下载区域」切成 `global`（走官网 URL；需要能连上 awesome-dsh-plugin.com）；
2. 环境变量 `DSHM_REGISTRY_URL=https://awesome-dsh-plugin.com/plugins.json`（在 `routesFor()` 里是**替换**整份源列表，不是插队）；
3. 等夜间构建发布新目录包后重启 DSH。

> 目录包版本可自证：`npm view dsh-plugin-catalog version --registry=https://registry.npmjs.org/`
> —— 出现 `2026.913.*` 即表示本条目已进入中国区所读的那份目录。

## 投稿前：先让 tarball 链接可用（否则先删掉 yml 里那行）

**顺序不能反**：workflow 只有在被打 tag 的那个提交里存在才会运行，所以先把本次改动（根 README、
`package.json`、`.github/workflows/release.yml`、`contrib/`）提交并推送到 `main`，再打 tag。

```sh
git status --short                 # 本次改动已随仓库提交；若你另有改动，先提交它们
git push origin main
git tag v0.2.2 && git push origin v0.2.2     # 触发 .github/workflows/release.yml
```

然后确认链接真的可用再投稿：

```sh
curl -sI https://github.com/biliye/dsh-voice-call/releases/latest/download/dsh-voice-call.tgz | head -1
# 期望：HTTP/2 302（跟随重定向后 200）
```

没打 release 就投稿的话，请先把 `tarball:` 一行删掉——列表不会给用户一个 404 的下载链接，
而收录后再补 release 也不会自动改写已合并的条目。

## 投稿步骤

1. 在 GitHub 上 Fork `awesome-dsh-plugin/awesome-dsh-plugin`（网页点 Fork 即可）。
2. 克隆自己的 fork，新建一条分支，把条目文件放到位（一个文件就是全部投稿）：

   ```sh
   git clone https://github.com/<你的用户名>/awesome-dsh-plugin
   cd awesome-dsh-plugin
   git checkout -b add-dsh-voice-call
   mkdir -p data/plugins
   cp <本仓库>/contrib/biliye__dsh-voice-call.yml data/plugins/biliye__dsh-voice-call.yml
   git add data/plugins/biliye__dsh-voice-call.yml
   git commit -m "Add biliye/dsh-voice-call (voice)"
   git push -u origin add-dsh-voice-call
   ```

3. **不要手工改 README**：`README.md` / `README.zh.md` 由 `data/plugins/*.yml` 生成，
   合并后 CI 会在 `main` 上重跑生成。一个条目文件就是一个 PR，也不会和别人冲突。
4. 在 GitHub 上对 `awesome-dsh-plugin:main` 开 PR，标题例如 `Add biliye/dsh-voice-call (voice)`；
   一个 PR 最多 3 条，本仓库只提 1 条。

> 传输提示（本机实测，供本机维护者参考）：
>
> - **2026-09-12 晚（代理开启后）实测：`git push` 已可直接用**——该代理的 MITM 根证书
>   `CN=WMPVP Local CA`（`WMPVP Development`）已装进 Windows 根 store，所以 `git` 用 **schannel**
>   后端即可通过校验：`git -c http.sslBackend=schannel push origin main`。本仓库 `.git/config` 里写的是
>   `http.sslBackend=openssl`，openssl 只认自己的 CA bundle，于是报
>   `SSL certificate problem: unable to get local issuer certificate`；`-c` 覆盖一次即可，或
>   `git config http.sslBackend schannel` 固化。推送身份用 Windows 凭据管理器里已存的
>   `git:https://github.com`，不需要 token。代理地址来自 `~/.gitconfig` 的 `http.proxy=127.0.0.1:26561`。
> - **2026-09-13 复测（代理已关闭）**：直连也能推，但必须**同时**绕开 `.gitconfig` 里那个已失效的代理
>   并保持 schannel：`git -c http.proxy= -c http.sslBackend=schannel push origin main`。三者缺一都会失败：
>   只 `-c http.proxy=` 而用 openssl → `SSL certificate problem`；只换 schannel 而代理没开 → 卡在
>   `Failed to connect to 127.0.0.1 port 26561`。所以两条路任一可用：**代理开着 → schannel**；
>   **代理关着 → `http.proxy=` + schannel**。
> - 兜底（上面两条都不通时）：走 **GitHub REST API** 路线（token 需 `repo` + `workflow` 权限）：把本地
>   提交逐字节复刻成远端提交（往返校验 tree/commit SHA 与本地一致），再创建 tag/Release，脚本在
>   `.debug/gh-publish.mjs`（`.debug/` 已 gitignore，不入库）。注意该脚本的 `push` 阶段**一次只复刻
>   HEAD 一个提交**，本地领先远端多个提交时会以 `remote main is not the local parent` 拒绝执行。

## 收录条件核对（本仓库现状）

| 条件 | 状态 | 依据 |
|---|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ | `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| 有真实可用的代码 | ✅ | `lib/index.js`(Host) + `lib/client.js`(Client)，非占位仓库 |
| 仓库创建满 1 天 | ✅ | 创建于 2026-08-16（CI 自动检查） |
| 仓库带 `dsh-plugin` topic | ✅ | topics 已含 `dsh-plugin`（另有 `dsh`、`deepseek-harness-plugin`） |
| 描述属实、无营销词 | ✅ | 条目描述逐条对应 README「功能」清单中的实际能力 |
| 分类贴切 | ✅ | `voice`（Voice & Audio），维护者仍可调整，不会因此打回 |

CI 还会跑 `awesome-lint` 与站点构建（双语一致性、分隔符等）。`description.en` 是唯一必填项，
中文缺失由维护者补；本条目中英均已给出，且英文含 `: ` 已按规范加引号。

## 收录后会发生什么

- **每次 push** 的站点构建都会刷新官网 `plugins.json`，`awesome-dsh-plugin.com` / `dshmarket.com`
  与 `voice` 分类随之更新；但 npm 上的 `dsh-plugin-catalog` 快照**只随夜间构建发布**，而
  **下载区域 = `china` 的市场读的正是这份快照**（见上节），所以中国区最多要等到当天夜间构建之后。
  合并后还会为卡片生成 GitHub Discussions 讨论帖。
- 市场用户看到的是一个**一键安装**按钮，安装来源即条目里的 `tarball`（无则回退源码构建）。
- dsh-market 卡片的「宿主兼容」标记只在 npm manifest 里读 `engines.dsh` 或 lockstep
  `@deepseek-ai/dsh-*` peer；本仓库目前两者都没声明，因此显示为「未声明」——**不声明不会被隐藏，
  只会没有兼容性结论**。要补的话，请先确认插件在 `0.1.0-rc.6` 起真的能跑，再在 `package.json` 里加：

  ```jsonc
  "engines": { "node": ">=18", "dsh": ">=0.1.0-rc.6 <0.2.0" }
  ```

  市场用 `includePrerelease: true` 求值，所以这个范围能匹配 `0.1.5-rc.1` 这类预发布版本；
  但声明错误会让用户在「只显示兼容插件」的筛选下看不到本插件，所以在验证之前不要写。

## npm 发布（2026-09-12：0.2.1 → 0.2.2 已发布）

收录不要求 npm；发布只是让市场能显示并按下载量排序。发布包的 `repository` 字段必须指回本仓库
（已是），映射由 registry 自动采集，条目里**不要**手写 `npm:` 键——校验会拒绝。

当前状态：`@biliye/dsh-voice-call@0.2.2` 已发布；registry 中 `repository` / tarball / maintainer 已核对；
三条安装路径（npm / release tarball / github 源码）都实测过——`dsh plugin --profile <p> add <spec>`
会装包并自动挂进 `dsh.profile.bundles`，`dsh --profile <p> --dump-config` 输出 `- id: voice-call`。

0.2.2 的内容：专属会话无法加载的两处修复（notice 消息 source 契约、`sessionPersistence` 快照形状，
见修复档案 `F:\xiangmu\update\dshCallUpdate\fix\FIX-2026-09-12.md`——档案已移出仓库，不再随 GitHub 分发）
＋ 播报链路剔除 `Route: …` 等元信息行（此前闲聊回复会把路由声明念出来）。

发布状态：npm `0.2.2` 由本机 `npm publish` 发布；GitHub Release `v0.2.2` 由 tag 触发 `release.yml`
产出，附件 `dsh-voice-call.tgz`（44263B，sha1 `d470207e9827c329b8392d862e01c6bc79587401`）与 npm
tarball 是**同一份字节**。三条安装路径（npm / `releases/latest/download` / github 源码）现在都是 0.2.2。

⚠ 同一个 tag 触发的 `publish-npm.yml` 这次是**失败**的 run：失败步骤是
`npx -y npm@latest publish --provenance --access public`。两种预期原因之一，日志需登录 GitHub 才能看：
① 0.2.2 已由本机发布过，npm 拒绝重复版本（workflow 头部也写了这条）；② Trusted Publisher 尚未在
npmjs 配好。下次发版二选一：**只改版本号 + 推 tag**，让 CI 用 OIDC 发布（需 ① 先不本机发布、② 配好
Trusted Publisher）；或**本机发布后再推 tag**，此时 CI 那一步必红，属预期。

### 能用的凭据长什么样（本机踩坑的全部结论）

npm 现在**强制要求发布凭据具备 2FA 能力**：会话凭据（`npm login`）发布时报
`403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`，
而当时账号是 `tfa: false`（没开 2FA，也就产不出 OTP）。所以本机只能走 granular token 路线，
它必须四项同时正确，**缺任何一项都以误导性 404 的形式失败**：

| 项 | 正确值 | 缺了会怎样 |
|---|---|---|
| Permissions | **Read and write (publish and stage)** | 选 `stage only` 只能暂存发布，直接 `npm publish` 会被拒 |
| **Packages and scopes** | **选中 `@biliye` 这个 scope**（或 `All packages`） | **本次根因**：只勾了 "Only select packages and scopes" 却没真正选中对象，registry 记成 `scopes: [{"name": null, "type": "package"}]`，授权覆盖 0 个包，PUT 被掩码成 `E404 … '@biliye/dsh-voice-call@0.2.1' is not in this registry` |
| Bypass 2FA | **勾上** | 退回上面那条 403 |
| Expiration | 未过期 | 过期后凭据失效（401） |

想确认自己那颗 token 的真实配置（比看 UI 可靠得多）：

```sh
# 用一颗能读账号信息的凭据（会话 token）列 token 元数据
curl -s -H "Authorization: Bearer <session-token>" https://registry.npmjs.org/-/npm/v1/tokens
# 期望 scopes 形如 [{"name":"@biliye","type":"package"}]，而不是 [{"name":null,...}]
```

### 本机发布步骤

```sh
npm login --registry=https://registry.npmjs.org/   # publishConfig 管不到「登录」这一步
npm publish                                        # 走 publishConfig.registry，不受本机 registry 影响
npm view @biliye/dsh-voice-call version            # 期望 0.2.2
```

> 其它仍然成立的坑：
> - `C:\Users\123\.npmrc` 里 `registry=https://registry.npmmirror.com`，而 **npmmirror 是只读镜像、不能发布**：
>   第一次 `npm publish` 报了 `ENEEDAUTH … registry.npmmirror.com`，包打好了却一个字节没上传。
>   为此 `package.json` 固定了 `publishConfig.registry = https://registry.npmjs.org/`。
> - `npm warn publish Removed invalid "scripts"` 是 npm 10.7 的噪音：本清单没有 `scripts` 字段，
>   `npm pkg fix` 在副本上跑也是零差异，忽略即可。
> - npm 站内搜索**基本搜不到本包**，这是排序问题、不是发布问题：搜索索引给
>   `@biliye/dsh-voice-call` 的 `final` 评分是 `0`（月下载量 0），而 `text=dsh-voice-call`
>   命中 23 万条；更巧的是 npm 上有一个**同名、无 scope 的**
>   [`dsh-voice-call`](https://www.npmjs.com/package/dsh-voice-call)（作者 `pandapolo`，
>   `dsh-voice` 的 fork），按名字搜先出来的是**别人的插件**。验证一律用
>   `https://www.npmjs.com/package/@biliye/dsh-voice-call` 或
>   `npm view @biliye/dsh-voice-call version --registry=https://registry.npmjs.org/`（期望 `0.2.2`）；
>   搜 `biliye` 能且仅能命中本包。另注意 `registry.npmmirror.com` 只同步到 `0.2.1`。

### 后续发版：改用 OIDC 可信发布（不再需要 token / OTP）

`.github/workflows/publish-npm.yml` 已就位：push `v*` tag 时由 GitHub runner 以 OIDC 发布，
本机代理中间人、npmmirror、2FA 这些问题全部绕开（npm 的 token 页面本身也建议自动化改用 Trusted Publishing）。

只需一次性配置：<https://www.npmjs.com/package/@biliye/dsh-voice-call/access> → **Trusted Publishers**
→ Add → Publisher 选 **GitHub Actions**，依次填 `biliye` / `dsh-voice-call` / `publish-npm.yml`（Environment 留空）。

之后发版：改 `package.json` 的 `version` → `git tag vX.Y.Z && git push origin vX.Y.Z`。
**必须先改版本号**，否则 npm 会以「该版本已存在」拒绝；配置生效前该 workflow 会失败，属预期。
