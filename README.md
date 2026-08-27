<p align="center">
  English | <a href="translations/README.zh.md">简体中文</a> | <a href="translations/README.zht.md">繁體中文</a> | <a href="translations/README.ko.md">한국어</a> | <a href="translations/README.de.md">Deutsch</a> | <a href="translations/README.es.md">Español</a> | <a href="translations/README.fr.md">Français</a> | <a href="translations/README.it.md">Italiano</a> | <a href="translations/README.da.md">Dansk</a> | <a href="translations/README.ja.md">日本語</a> | <a href="translations/README.pl.md">Polski</a> | <a href="translations/README.ru.md">Русский</a> | <a href="translations/README.bs.md">Bosanski</a> | <a href="translations/README.ar.md">العربية</a> | <a href="translations/README.no.md">Norsk</a> | <a href="translations/README.br.md">Português (Brasil)</a> | <a href="translations/README.th.md">ไทย</a> | <a href="translations/README.tr.md">Türkçe</a> | <a href="translations/README.uk.md">Українська</a> | <a href="translations/README.bn.md">বাংলা</a> | <a href="translations/README.gr.md">Ελληνικά</a> | <a href="translations/README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Try the LCM prerelease

This experimental Kilo Code build keeps long chats useful by turning older, already-used context into a searchable summary tree. Your recent work stays exact, and the agent can recover older detail when it needs it.

> [!IMPORTANT]
> Builds with LCM are available only from this repository's GitHub Releases. Marketplace, Open VSX, npm, Homebrew, AUR, cloud, and JetBrains install the official Kilo Code version without LCM.

[Want the idea behind it? Read the original LCM paper by Clint Ehrlich and Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Current prerelease:** [`v7.4.23-lcm.12`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.12)

### Pick what to download

Choose a VSIX if you use VS Code or VSCodium. Choose a CLI archive if you work in a terminal. Installing both is fine.

#### Find your system

Check Windows in Settings → System → About → System type; check macOS in Apple menu → About This Mac; on Linux run uname -m. x86_64 or amd64 means x64, while arm64 or aarch64 means ARM64.

Most Linux desktops use glibc. Alpine and some tiny containers use musl. Pick baseline only for an older x64 CPU or if the normal CLI exits with an illegal-instruction error; there is no separate baseline VSIX.

#### VS Code / VSCodium

You need VS Code or VSCodium 1.105.1 or newer. The VSIX uses the normal Kilo Code extension ID, so it replaces an installed Marketplace build.

|System|Asset|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Download the matching file, turn off auto-update for Kilo Code, then use Extensions → … → Install from VSIX. Reload the window after installation. You can also use one of the commands below.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Download one archive from the table. Extract the whole archive into its own folder and keep every extracted support file beside the executable.

|System|Asset|
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

Run the extracted binary once before adding its folder to PATH. If a different Kilo starts later, use the path checks below and move the LCM folder earlier in PATH.

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

### Set up Kilo and LCM

Connect your usual provider and select a model first. Conversation Memory is on by default. In the extension, open Settings → Experimental to confirm it, then Settings → Context for the 40% soft threshold. Custom models need positive context and output token limits; an input limit is optional.

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

compaction.auto controls only Kilo's older compaction system while LCM is enabled; it does not switch LCM off.

#### Ollama

For Ollama, use the real server address—often localhost:11434 on the same machine or the computer's LAN address from another device. Make sure Ollama listens on that address, the firewall allows it, and the model's num_ctx is at least the context limit you enter in Kilo.

### Check that it works

Start a chat, select your provider/model, and run /lcm status. Look for enabled status and known capacity. The task header or Context settings will show pressure and activity. /compact requests one manual LCM cycle; a short new chat may have nothing to summarize.

### A few useful tips

Summary work uses model calls, so it can add a little latency and provider cost. Start with 40%; lower it for earlier maintenance or raise it for fewer calls. LCM memory belongs to the current chat. Context export can contain sensitive prompts and tool output, so treat it like the conversation itself.

#### Quick fixes

If you see lcm_capacity_unknown, fill in the selected custom model's context and output limits. If the extension changes back after a restart, disable auto-update and reinstall the VSIX. If the CLI version is wrong, check which -a kilo or where.exe kilo. On Alpine use musl; on an older x64 CPU try baseline.

#### Update or roll back

For an update, install the newer VSIX over the old one or replace the extracted CLI folder. Your chats remain in Kilo's SQLite database. To roll back quickly, set experimental.conversation_memory to false; you can also reinstall the official Kilo Code version or an older prerelease.

> [!NOTE]
> The rest of this page describes the official Kilo Code version. The normal installation links below do not install this version with LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">The open source coding agent for building with AI in VS Code, JetBrains, or the CLI.</p>

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

Kilo Code is an AI coding agent that meets you everywhere you work: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native), and the [CLI](https://kilo.ai/cli). It's open source with open pricing. You pick from 500+ models, switch between them mid-task, and pay the model provider's rate with zero markup. No API keys required to start.

### Installation

Pick where you want to run Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Install the [Kilo Code extension](vscode:extension/kilocode.kilo-code) directly, or grab it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Create an account and you'll have access to 500+ models including GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6, and Gemini 3.1 Pro Preview, all at provider pricing.

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

Then run `kilo` in any project directory to start.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Install the [Kilo Code plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) from the JetBrains Marketplace, or search "Kilo Code" in `Settings → Plugins` inside any JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Run Kilo from the web, no local machine needed, at [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Set up automated AI code reviews on your pull requests at [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Spin up your always-on AI agent at [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Install the CLI from GitHub Releases (binaries)</summary>

Download the latest binary from the [Releases page](https://github.com/Kilo-Org/kilocode/releases).

| Platform | Asset |
|---|---|
| Windows (most PCs) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notes: `x64-baseline` is a compatibility build for older CPUs without AVX. `musl` is the statically linked build for Alpine or minimal Docker images without glibc. `kilo-vscode-*.vsix` is the VS Code extension package, not the CLI. `Source code` archives are for building from source.

</details>

### Agents

Kilo ships with specialized agents you switch between depending on the task. You can also build your own custom agents.

- **Code** - The default. Implements and edits code from natural language.
- **Plan** - Designs architecture and writes implementation plans before any code gets written.
- **Ask** - Answers questions about your codebase without touching any files.
- **Debug** - Troubleshoots and traces issues.
- **Review** - Reviews your changes and surfaces issues across performance, security, style, and test coverage.

Learn more about [agents and custom agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### What it does

- **Code generation** from natural language, across multiple files.
- **Inline autocomplete** with ghost-text suggestions and tab to accept.
- **Self-checking** so the agent reviews and corrects its own work.
- **Terminal and browser control** to run commands and automate the web.
- **MCP marketplace** to find and wire up MCP servers that extend what the agent can do.
- **500+ models** with mid-task switching, so you can match latency, cost, and reasoning to the job.

### Autonomous Mode (CI/CD)

Run `kilo run` with `--auto` for fully autonomous operation with no prompts, built for CI/CD pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` disables all permission prompts and lets the agent execute any action without confirmation. Only use it in trusted environments.

### Documentation

For configuration and everything else, [head over to the docs](https://kilo.ai/docs).

### Contributing

Contributions are welcome from developers, writers, and everyone in between. Start with the [Contributing Guide](/CONTRIBUTING.md) for environment setup, coding standards, and how to open a pull request. See [RELEASING.md](RELEASING.md) for the VS Code extension and CLI release process, and [packages/kilo-jetbrains/RELEASING.md](packages/kilo-jetbrains/RELEASING.md) for the JetBrains plugin.

Please review our [Code of Conduct](/CODE_OF_CONDUCT.md) before getting involved.

### License

MIT. You're free to use, modify, and distribute this code, including commercially, as long as you keep the attribution and license notices. See [License](/LICENSE).

### FAQ

<details>
<summary>Where did Kilo CLI come from?</summary>

Kilo CLI is a fork of [OpenCode](https://github.com/anomalyco/opencode), enhanced to work within the Kilo agentic engineering platform.

</details>

---

**Join the community** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
