# 把 dsh-voice-call 收录进插件市场（dsh-market）的可见列表

`contrib/biliye__dsh-voice-call.yml` 就是投稿的全部内容：把它复制成
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
仓库里的 `data/plugins/biliye__dsh-voice-call.yml`，开一个 PR 即可。

**不要往 [dsh-market](https://github.com/dsh-market/dsh-market) 提条目 PR**：那个仓库是市场应用本身，
它的条目数据全部来自 awesome-dsh-plugin 这份精选列表（`https://awesome-dsh-plugin.com/plugins.json`）。
市场与 [dshmarket.com](https://dshmarket.com)、[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)
共用同一份数据，所以收录一次，三处同时可见。

## 投稿前：先让 tarball 链接可用（否则先删掉 yml 里那行）

**顺序不能反**：workflow 只有在被打 tag 的那个提交里存在才会运行，所以先把本次改动（根 README、
`package.json`、`.github/workflows/release.yml`、`contrib/`）提交并推送到 `main`，再打 tag。

```sh
git status --short                 # 本次改动已随仓库提交；若你另有改动，先提交它们
git push origin main
git tag v0.2.1 && git push origin v0.2.1     # 触发 .github/workflows/release.yml
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

> 传输提示（本机 2026-09-12 实测，供本机维护者参考）：
>
> - `api.github.com`、`codeload.github.com` 可**直连**；`github.com` 直连**连接超时**，必须走本机代理。
> - 走代理时该代理对 GitHub 做 TLS 中间人，`git` 用 schannel 与 openssl 两种后端都因证书链不受信而失败
>   （`SSL certificate problem: unable to get local issuer certificate`），直连 `git push` 则报
>   `OpenSSL SSL_read: SSL_ERROR_SYSCALL` 或直接挂住；`git ls-remote` 因直连可读而正常。
> - 所以本机的发布走 **GitHub REST API**（token 需 `repo` + `workflow` 权限）：把本地提交逐字节复刻成远端
>   提交（往返校验 tree/commit SHA 与本地一致），再创建 tag/Release，最后由 tag 触发 workflow 产出附件。
>   本次会话用的脚本在 `.debug/gh-publish.mjs`（`.debug/` 已 gitignore，不入库）。
> - 换到能正常 `git push` 的环境时，上面两条命令仍然适用；本机则需要 API 或修好代理的证书信任。

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

- 合并后夜间构建刷新 `plugins.json`，**通常一天内**出现在市场 Discover 页、`dshmarket.com` 与
  awesome-dsh-plugin.com 的 `voice` 分类，以及每张卡片对应的 GitHub Discussions 讨论帖。
- 市场用户看到的是一个**一键安装**按钮，安装来源即条目里的 `tarball`（无则回退源码构建）。
- dsh-market 卡片的「宿主兼容」标记只在 npm manifest 里读 `engines.dsh` 或 lockstep
  `@deepseek-ai/dsh-*` peer；本仓库目前两者都没声明，因此显示为「未声明」——**不声明不会被隐藏，
  只会没有兼容性结论**。要补的话，请先确认插件在 `0.1.0-rc.6` 起真的能跑，再在 `package.json` 里加：

  ```jsonc
  "engines": { "node": ">=18", "dsh": ">=0.1.0-rc.6 <0.2.0" }
  ```

  市场用 `includePrerelease: true` 求值，所以这个范围能匹配 `0.1.5-rc.1` 这类预发布版本；
  但声明错误会让用户在「只显示兼容插件」的筛选下看不到本插件，所以在验证之前不要写。

## npm 发布（2026-09-12 已完成：0.2.1）

收录不要求 npm；发布只是让市场能显示并按下载量排序。发布包的 `repository` 字段必须指回本仓库
（已是），映射由 registry 自动采集，条目里**不要**手写 `npm:` 键——校验会拒绝。

当前状态：`@biliye/dsh-voice-call@0.2.1` 已发布；registry 中 `repository` / tarball / maintainer 已核对；
三条安装路径（npm / release tarball / github 源码）都实测过——`dsh plugin --profile <p> add <spec>`
会装包并自动挂进 `dsh.profile.bundles`，`dsh --profile <p> --dump-config` 输出 `- id: voice-call`。

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
npm view @biliye/dsh-voice-call version            # 期望 0.2.1
```

> 其它仍然成立的坑：
> - `C:\Users\123\.npmrc` 里 `registry=https://registry.npmmirror.com`，而 **npmmirror 是只读镜像、不能发布**：
>   第一次 `npm publish` 报了 `ENEEDAUTH … registry.npmmirror.com`，包打好了却一个字节没上传。
>   为此 `package.json` 固定了 `publishConfig.registry = https://registry.npmjs.org/`。
> - `npm warn publish Removed invalid "scripts"` 是 npm 10.7 的噪音：本清单没有 `scripts` 字段，
>   `npm pkg fix` 在副本上跑也是零差异，忽略即可。
> - npm 站内**搜索索引有延迟**（几分钟到数小时）。验证请用
>   `https://www.npmjs.com/package/@biliye/dsh-voice-call` 或 `npm view`，搜不到 ≠ 没发上去。

### 后续发版：改用 OIDC 可信发布（不再需要 token / OTP）

`.github/workflows/publish-npm.yml` 已就位：push `v*` tag 时由 GitHub runner 以 OIDC 发布，
本机代理中间人、npmmirror、2FA 这些问题全部绕开（npm 的 token 页面本身也建议自动化改用 Trusted Publishing）。

只需一次性配置：<https://www.npmjs.com/package/@biliye/dsh-voice-call/access> → **Trusted Publishers**
→ Add → Publisher 选 **GitHub Actions**，依次填 `biliye` / `dsh-voice-call` / `publish-npm.yml`（Environment 留空）。

之后发版：改 `package.json` 的 `version` → `git tag vX.Y.Z && git push origin vX.Y.Z`。
**必须先改版本号**，否则 npm 会以「该版本已存在」拒绝；配置生效前该 workflow 会失败，属预期。
