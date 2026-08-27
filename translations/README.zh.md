<p align="center">
  <a href="../README.md">English</a> | 简体中文 | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## 试用 LCM 预发行版

这个实验版 Kilo Code 会把已经使用过的旧上下文变成可搜索的摘要树，让长对话继续保持实用。最近的工作会原样保留，代理需要时也能找回早期细节。

> [!IMPORTANT]
> 带 LCM 的版本仅通过本仓库的 GitHub Releases 发布。从 Marketplace、Open VSX、npm、Homebrew、AUR、云服务或 JetBrains 安装的都是不含 LCM 的 Kilo Code 官方版。

[想了解背后的思路？请阅读 Clint Ehrlich 和 Theodore Blackman 的 LCM 原始论文。](https://arxiv.org/abs/2605.04050)

**当前预发行版:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### 选择下载文件

使用 VS Code 或 VSCodium 时选择 VSIX；在终端工作时选择 CLI 压缩包。两者可以同时安装。

#### 确认系统

Windows 请查看 Settings → System → About → System type；macOS 请查看 Apple menu → About This Mac；Linux 请运行 uname -m。x86_64 或 amd64 表示 x64，arm64 或 aarch64 表示 ARM64。

大多数 Linux 桌面使用 glibc；Alpine 和一些小型容器使用 musl。仅当 x64 CPU 较旧，或普通 CLI 因 illegal instruction 退出时选择 baseline；没有单独的 baseline VSIX。

#### VS Code / VSCodium

需要 VS Code 或 VSCodium 1.105.1 或更高版本。VSIX 使用普通 Kilo Code 的扩展 ID，因此会替换已安装的 Marketplace 版本。

|系统|文件|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

下载匹配的文件，关闭 Kilo Code 自动更新，然后选择 Extensions → … → Install from VSIX。安装后重新加载窗口。也可以使用下面的命令。

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

从表格中下载一个压缩包。把整个压缩包解压到独立文件夹，并让所有支持文件和可执行文件保持在一起。

|系统|文件|
|---|---|
|Windows x64|`kilo-windows-x64.zip`|
|Windows x64 baseline|`kilo-windows-x64-baseline.zip`|
|Windows ARM64|`kilo-windows-arm64.zip`|
|macOS x64 (Intel)|`kilo-darwin-x64.zip`|
|macOS x64 baseline|`kilo-darwin-x64-baseline.zip`|
|macOS ARM64 (Apple Silicon)|`kilo-darwin-arm64.zip`|
|Linux x64 (glibc)|`kilo-linux-x64.tar.gz`|
|Linux x64 baseline (glibc)|`kilo-linux-x64-baseline.tar.gz`|
|Linux ARM64 (glibc)|`kilo-linux-arm64.tar.gz`|
|Linux x64 (musl)|`kilo-linux-x64-musl.tar.gz`|
|Linux x64 baseline (musl)|`kilo-linux-x64-baseline-musl.tar.gz`|
|Linux ARM64 (musl)|`kilo-linux-arm64-musl.tar.gz`|

将文件夹加入 PATH 前，先运行一次解压后的程序。如果之后启动了其他 Kilo，请用下面的命令检查路径，并把 LCM 文件夹放到 PATH 更靠前的位置。

```bash
mkdir -p kilo-lcm
tar -xzf kilo-linux-x64.tar.gz -C kilo-lcm
./kilo-lcm/kilo --version

unzip kilo-darwin-arm64.zip -d kilo-lcm
./kilo-lcm/kilo --version

which -a kilo
```

```powershell
Expand-Archive .\kilo-windows-x64.zip .\kilo-lcm
.\kilo-lcm\kilo.exe --version
where.exe kilo
```

### 设置 Kilo 和 LCM

先连接你常用的服务商并选择模型。Conversation Memory 默认开启，可在 Settings → Experimental 中确认。然后打开 Settings → Context；默认从 40% 开始处理。自定义模型的上下文上限和输出令牌上限必须为正数，输入上限可以不填。

```jsonc
{
  "experimental": {
    "conversation_memory": true
  },
  "conversation_memory": {
    "soft_threshold_percent": 40
  }
}
```

启用 LCM 时，compaction.auto 只控制 Kilo 旧的压缩系统，不会关闭 LCM。

#### Ollama

Ollama 请填写真实服务器地址：同一台机器通常是 localhost:11434，其他设备则使用电脑的 LAN 地址。确认 Ollama 在该地址监听、firewall 允许访问，而且 model 的 num_ctx 不小于 Kilo 中填写的 context limit。

### 检查是否正常

开始聊天，选择服务商和模型，然后运行 /lcm status。状态应为 enabled，并且容量已识别。任务标题或 Context 页面会显示上下文用量和 LCM 活动。/compact 会手动运行一次 LCM；较短的新聊天可能还没有内容可摘要。

### 实用提示

生成摘要需要调用模型，因此可能增加少量延迟和费用。建议先用 40%；想更早处理可调低，想减少调用可调高。LCM 记忆仅属于当前聊天。上下文导出可能包含敏感的提示词和工具输出，请像保护聊天内容一样妥善保管。

#### 快速排查

看到 lcm_capacity_unknown 时，请填写所选自定义 model 的 context 和 output limit。如果重启后扩展变回其他版本，请关闭 auto-update 并重新安装 VSIX。如果 CLI 版本不对，请检查 which -a kilo 或 where.exe kilo。Alpine 使用 musl；旧 x64 CPU 尝试 baseline。

#### 更新或回退

更新时，在旧版上安装新版 VSIX，或替换已解压的 CLI 文件夹。聊天仍保存在 Kilo 的 SQLite 中。要快速回退，把 experimental.conversation_memory 设为 false；也可以重新安装 Kilo Code 官方版或较早的预发行版。

> [!NOTE]
> 本页其余内容介绍 Kilo Code 官方版。下方的常规安装链接不会安装这个带 LCM 的版本。

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">用于在 VS Code、JetBrains 或 CLI 中借助 AI 构建的开源编码代理。</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code 是一个 AI 编码代理，可以在你工作的任何地方使用：[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native) 和 [CLI](https://kilo.ai/cli)。它是开源的，并采用开放定价。你可以从 500 多个模型中选择，在任务中途切换模型，并按模型提供商的价格付费，没有加价。开始使用无需 API 密钥。

### 安装

选择你想运行 Kilo 的位置。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

直接安装 [Kilo Code 扩展](vscode:extension/kilocode.kilo-code)，或从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) 获取。创建账户后，你可以按提供商价格访问 500 多个模型，包括 GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6 和 Gemini 3.1 Pro Preview。

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

然后在任意项目目录中运行 `kilo` 即可开始。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

从 JetBrains Marketplace 安装 [Kilo Code 插件](https://plugins.jetbrains.com/plugin/28350-kilo-code)，或在任意 JetBrains IDE 的 `Settings → Plugins` 中搜索 "Kilo Code"。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

无需本地机器，在 Web 上通过 [app.kilo.ai/cloud](https://app.kilo.ai/cloud) 运行 Kilo。

</details>

<details>
<summary><strong>代码审查</strong></summary>

<br>

在 [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) 为你的 Pull Request 设置自动 AI 代码审查。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

在 [app.kilo.ai/claw](https://app.kilo.ai/claw) 启动你的常驻 AI 代理。

</details>

<details>
<summary>从 GitHub Releases 安装 CLI（二进制文件）</summary>

从 [Releases 页面](https://github.com/Kilo-Org/kilocode/releases) 下载最新二进制文件。

| 平台 | 资源 |
|---|---|
| Windows（大多数 PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

说明：`x64-baseline` 是面向不支持 AVX 的旧 CPU 的兼容构建。`musl` 是面向 Alpine 或无 glibc 的极简 Docker 镜像的静态链接构建。`kilo-vscode-*.vsix` 是 VS Code 扩展包，不是 CLI。`Source code` 压缩包用于从源码构建。

</details>

### Agents

Kilo 内置了可按任务切换的专用 Agents。你也可以构建自己的自定义 Agents。

- **Code** - 默认模式。根据自然语言实现和编辑代码。
- **Plan** - 在编写任何代码之前设计架构并编写实现计划。
- **Ask** - 回答有关代码库的问题，不修改任何文件。
- **Debug** - 排查并追踪问题。
- **Review** - 审查你的更改，并从性能、安全、风格和测试覆盖率等方面发现问题。

了解更多关于 [agents 和自定义 agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) 的信息。

### 功能

- **代码生成**：基于自然语言跨多个文件生成代码。
- **内联自动补全**：提供 ghost-text 建议，按 Tab 接受。
- **自检**：让代理审查并修正自己的工作。
- **终端和浏览器控制**：运行命令并自动化网页操作。
- **MCP 市场**：查找并连接 MCP 服务器，扩展代理能力。
- **500 多个模型**：支持任务中途切换，让你根据延迟、成本和推理能力匹配任务。

### 自主模式（CI/CD）

使用 `--auto` 运行 `kilo run`，可在 CI/CD 流水线中实现无提示的完全自主操作：

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` 会禁用所有权限提示，并允许代理在无需确认的情况下执行任何操作。仅在可信环境中使用。

### 文档

关于配置和其他内容，请查看[文档](https://kilo.ai/docs)。

### 贡献

欢迎开发者、写作者以及所有人参与贡献。请先阅读 [Contributing Guide](/CONTRIBUTING.md)，了解环境设置、编码标准以及如何创建 Pull Request。VS Code 扩展和 CLI 的发布流程请参阅 [RELEASING.md](../RELEASING.md)，JetBrains 插件请参阅 [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md)。

参与前请阅读我们的 [Code of Conduct](/CODE_OF_CONDUCT.md)。

### 许可证

MIT。你可以使用、修改和分发此代码，包括商业用途，只要保留署名和许可证声明。参见 [License](/LICENSE)。

### FAQ

<details>
<summary>Kilo CLI 从哪里来？</summary>

Kilo CLI 是 [OpenCode](https://github.com/anomalyco/opencode) 的一个 fork，并增强为可在 Kilo agentic engineering 平台中使用。

</details>

---

**加入社区** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
