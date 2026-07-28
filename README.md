# Code80 Image

中文 | [English](README.en.md)

Code80 Image 是一个开源 Codex 插件，用 Code80 的 GPT/Grok 图像模型或当前 Codex
Agent 完成本地批量生图、图片编辑、任务恢复和结果管理。

## 安装

### 先确认 codex CLI 支持插件

`codex plugin` 是较新版本才有的子命令。装之前先跑一次：

```bash
codex plugin --help
```

如果输出 `error: unexpected argument 'plugin' found`，说明你的 codex CLI 太旧
（例如 npm 全局装的 `@openai/codex` 0.116.0 就没有这个命令）。此时不要用 PATH 上的
`codex`，改用 Codex 桌面端自带的那个——macOS 上它随 ChatGPT.app 一起分发，版本通常
更新：

```bash
/Applications/ChatGPT.app/Contents/Resources/codex plugin --help
```

下面的命令里，把 `codex` 换成这个完整路径即可。

### 安装插件

```bash
codex plugin marketplace add yiancode/code80-image
codex plugin add code80-image@code80-image
codex plugin list
```

`codex plugin list` 里能看到 `code80-image` 且状态为已启用，才算装好。

装完新建一个 Codex 任务，MCP 服务和技能才会加载到会话里。然后打开 **Code80 Image
设置**，为每个 Code80 API Key 建一个本地分组，再配置该分组可用的 GPT/Grok 模型。新建
分组默认使用 `https://dev.code80.ai`；已有分组的地址不会被自动改动，除非你自己改完
保存。

### 不要手动拷贝 skill 目录

有人（或让 Agent）图省事，把 `plugins/code80-image/skills/batch-generate-images/`
直接拷到 `~/.codex/skills/` 下。这样装出来的是个空壳：技能提示词会加载，Codex 里也能
看到 Code80 Image 的入口，但 `.mcp.json` 声明的 MCP 服务从来没被注册，于是
`open_code80_image`、`create_image_batch` 这些工具全都不存在。

典型症状是模型回你一句：当前会话没有加载 Code80 Image 的 MCP 工具，无法打开工作台。

如果已经这么装过，先删掉 `~/.codex/skills/batch-generate-images/`，再按上面的插件流程
重装，否则那个假入口会一直误导模型。

## 更新

```bash
codex plugin marketplace upgrade code80-image
codex plugin remove code80-image@code80-image
codex plugin add code80-image@code80-image
```

更新后要完全退出并重开 Codex，然后新建任务。Windows 上尤其要注意：旧任务会继续持有
上一版的 MCP 服务进程和缓存的插件文件。

如果工作台能打开但提示 `MCP error -32000: MCP proxy request failed`，先更新到最新版
插件并重启 Codex。插件会对读取和幂等的设置更新重试代理启动期的瞬时失败；生图这类可能
产生重复扣费的写操作不会自动重试。

## 让 Agent 帮你装

本机装好并登录了 codex CLI 的话，可以把下面的提示词整段贴给 Agent，让它装完顺带验证。

### Codex

贴进一个 Codex 任务：

> 帮我安装 https://github.com/yiancode/code80-image 这个 Codex 插件。先跑
> `codex plugin --help` 确认 CLI 支持插件子命令；如果不支持，改用
> `/Applications/ChatGPT.app/Contents/Resources/codex`。然后添加
> `yiancode/code80-image` 这个 marketplace，安装 `code80-image@code80-image`，用
> `codex plugin list` 确认已启用。不要修改插件源码，也不要把 skills 目录手动拷到
> `~/.codex/skills/`。装完提醒我新建一个 Codex 任务，好让 MCP 服务和技能加载。

### Claude Code

贴进 Claude Code：

> 帮我给本机的 Codex 装 https://github.com/yiancode/code80-image。注意这是 Codex
> 插件，不是 Claude Code 插件。先用 `codex --version` 和 `codex plugin --help` 确认
> CLI 版本够新；如果报 `unexpected argument`，改用
> `/Applications/ChatGPT.app/Contents/Resources/codex`。然后依次执行
> `codex plugin marketplace add yiancode/code80-image` 和
> `codex plugin add code80-image@code80-image`，再用 `codex plugin list` 验证，把安装
> 版本和启用状态报给我。不要修改这个仓库，也不要退化成手动拷贝 skills 目录。

## 能做什么

- 持久化批次，单批 1–50 个互相独立的生图任务。
- Code80 GPT Image 生成与编辑。
- Code80 Grok 生成与编辑。
- 每个 Code80 分组独立保存凭据和模型清单。
- 并行执行、重试、取消、任务恢复、预览、复制、导出、合并、删除。
- 设置、队列、参考图和生成结果全部存在本地。
- macOS 上 API Key 存进钥匙串。

## 开发

```bash
cd plugins/code80-image
npm install
npm run check
```

插件源码和编译产物在 [`plugins/code80-image`](plugins/code80-image)。

## 许可证

MIT。依赖的开源声明见
[`THIRD_PARTY_NOTICES.md`](plugins/code80-image/THIRD_PARTY_NOTICES.md)。
