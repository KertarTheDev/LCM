<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | বাংলা | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## LCM প্রিরিলিজ ব্যবহার করে দেখুন

Kilo Code-এর এই পরীক্ষামূলক বিল্ড পুরোনো, ইতিমধ্যে ব্যবহৃত কনটেক্সটকে খোঁজা যায় এমন সারাংশ-ট্রিতে বদলে দীর্ঘ চ্যাটকে কাজে লাগার মতো রাখে। সাম্প্রতিক কাজ হুবহু থাকে, আর দরকার হলে এজেন্ট পুরোনো বিস্তারিত ফেরত আনতে পারে।

> [!IMPORTANT]
> LCM-সহ build শুধু এই repository-র GitHub Releases পাতায় পাওয়া যায়। Marketplace, Open VSX, npm, Homebrew, AUR, cloud বা JetBrains থেকে install করলে Kilo Code-এর সাধারণ সংস্করণ পাবেন; তাতে LCM নেই।

[ভাবনাটির উৎস জানতে Clint Ehrlich ও Theodore Blackman-এর মূল LCM পেপার পড়ুন।](https://arxiv.org/abs/2605.04050)

**বর্তমান prerelease:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### কোনটি ডাউনলোড করবেন

VS Code বা VSCodium ব্যবহার করলে VSIX file নিন। terminal-এ কাজ করলে CLI archive নিন। চাইলে দুটিই install করতে পারেন।

#### আপনার system চিনুন

Windows-এ Settings → System → About → System type, macOS-এ Apple menu → About This Mac দেখুন; Linux-এ uname -m চালান। x86_64 বা amd64 মানে x64, আর arm64 বা aarch64 মানে ARM64।

বেশিরভাগ Linux ডেস্কটপ glibc ব্যবহার করে; Alpine ও কিছু ছোট container musl ব্যবহার করে। শুধু পুরোনো x64 CPU বা সাধারণ CLI-তে illegal instruction হলে baseline নিন; আলাদা baseline VSIX নেই।

#### VS Code / VSCodium

VS Code বা VSCodium 1.105.1 বা নতুন লাগবে। VSIX সাধারণ Kilo Code extension ID ব্যবহার করে, তাই ইনস্টল করা Marketplace বিল্ডটি বদলে যাবে।

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

সঠিক ফাইল ডাউনলোড করুন, Kilo Code-এর auto-update বন্ধ করুন, তারপর Extensions → … → Install from VSIX ব্যবহার করুন। ইনস্টলের পর window reload করুন। নিচের command-ও ব্যবহার করতে পারেন।

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

টেবিল থেকে একটি archive নিন। পুরো archive আলাদা folder-এ extract করুন এবং সব support file executable-এর পাশেই রাখুন।

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

folder-টি PATH-এ দেওয়ার আগে extracted binary একবার চালান। পরে অন্য Kilo চালু হলে নিচের path check ব্যবহার করে LCM folder-টি PATH-এ আগে রাখুন।

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

### Kilo ও LCM setup

প্রথমে আপনার নিয়মিত provider যুক্ত করে একটি model বেছে নিন। Conversation Memory ডিফল্টভাবেই চালু থাকে। extension-এ Settings → Experimental থেকে সেটি যাচাই করুন, তারপর Settings → Context-এ 40% শুরুর সীমা দেখুন। custom model-এর context ও output token limit অবশ্যই ধনাত্মক হতে হবে; input limit দেওয়া ঐচ্ছিক।

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

LCM চালু থাকলে compaction.auto শুধু Kilo-এর পুরোনো compaction ব্যবস্থা নিয়ন্ত্রণ করে; এটি LCM বন্ধ করে না।

#### Ollama

Ollama-র আসল server address দিন—একই machine-এ সাধারণত localhost:11434, অন্য device থেকে computer-এর LAN address। Ollama যেন সেই address-এ শোনে, firewall অনুমতি দেয় এবং model-এর num_ctx যেন Kilo-তে দেওয়া context limit-এর সমান বা বেশি হয়।

### কাজ করছে কি না দেখুন

একটি chat খুলে provider ও model বেছে /lcm status চালান। status যেন enabled হয় এবং capacity জানা থাকে। task header বা Context settings-এ ব্যবহার ও LCM-এর কাজ দেখা যাবে। /compact একটি LCM cycle হাতে চালায়; ছোট নতুন chat-এ সংক্ষেপ করার মতো কিছু নাও থাকতে পারে।

### কিছু দরকারি tip

Summary তৈরিতে model call লাগে, তাই সামান্য সময় ও provider cost বাড়তে পারে। 40% দিয়ে শুরু করুন; আগে maintenance চাইলে কমান, কম call চাইলে বাড়ান। LCM memory শুধু বর্তমান chat-এর। Context export-এ sensitive prompt বা tool output থাকতে পারে, তাই chat-এর মতোই নিরাপদ রাখুন।

#### দ্রুত সমাধান

lcm_capacity_unknown দেখলে নির্বাচিত custom model-এর context ও output limit পূরণ করুন। Restart-এর পর extension বদলে গেলে auto-update বন্ধ করে VSIX আবার দিন। CLI version ভুল হলে which -a kilo বা where.exe kilo দেখুন। Alpine-এ musl এবং পুরোনো x64 CPU-তে baseline চেষ্টা করুন।

#### Update বা rollback

Update করতে নতুন VSIX পুরোনোটির উপর install করুন বা extracted CLI folder বদলান। Chat Kilo SQLite database-এ থাকে। দ্রুত rollback করতে experimental.conversation_memory false করুন; চাইলে Kilo Code-এর সাধারণ সংস্করণ বা পুরোনো prerelease আবার install করুন।

> [!NOTE]
> এই পৃষ্ঠার বাকি অংশ Kilo Code-এর সাধারণ সংস্করণ নিয়ে। নিচের নিয়মিত install link দিয়ে এই LCM prerelease install হবে না।

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code, JetBrains বা CLI-তে AI দিয়ে তৈরি করার জন্য ওপেন সোর্স কোডিং এজেন্ট।</p>

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

Kilo Code হলো একটি AI কোডিং এজেন্ট যা আপনি যেখানে কাজ করেন সেখানেই কাজ করে: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) এবং [CLI](https://kilo.ai/cli)। এটি ওপেন সোর্স এবং খোলা মূল্যনীতির। আপনি 500টির বেশি মডেল থেকে বেছে নিতে পারেন, কাজের মাঝখানে মডেল বদলাতে পারেন এবং কোনো অতিরিক্ত চার্জ ছাড়াই মডেল প্রদানকারীর রেট পরিশোধ করেন। শুরু করতে API key দরকার নেই।

### ইনস্টলেশন

আপনি কোথায় Kilo চালাতে চান তা বেছে নিন।

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code extension](vscode:extension/kilocode.kilo-code) সরাসরি ইনস্টল করুন, অথবা [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) থেকে নিন। একটি অ্যাকাউন্ট তৈরি করলে GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 এবং Gemini 3.1 Pro Preview সহ 500টির বেশি মডেলে প্রদানকারীর দামে অ্যাক্সেস পাবেন।

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

তারপর শুরু করতে যেকোনো প্রজেক্ট ডিরেক্টরিতে `kilo` চালান।

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace থেকে [Kilo Code plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) ইনস্টল করুন, অথবা যেকোনো JetBrains IDE-তে `Settings → Plugins`-এ "Kilo Code" খুঁজুন।

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

লোকাল মেশিন ছাড়াই ওয়েব থেকে [app.kilo.ai/cloud](https://app.kilo.ai/cloud)-এ Kilo চালান।

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

[app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)-এ আপনার pull request-এ স্বয়ংক্রিয় AI code review সেট আপ করুন।

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

[app.kilo.ai/claw](https://app.kilo.ai/claw)-এ আপনার always-on AI agent চালু করুন।

</details>

<details>
<summary>GitHub Releases থেকে CLI ইনস্টল করুন (বাইনারি)</summary>

[Releases page](https://github.com/Kilo-Org/kilocode/releases) থেকে সর্বশেষ বাইনারি ডাউনলোড করুন।

| প্ল্যাটফর্ম | Asset |
|---|---|
| Windows (বেশিরভাগ PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

নোট: `x64-baseline` হলো AVX ছাড়া পুরোনো CPU-এর জন্য compatibility build। `musl` হলো Alpine বা glibc ছাড়া minimal Docker image-এর জন্য statically linked build। `kilo-vscode-*.vsix` হলো VS Code extension package, CLI নয়। `Source code` archive source থেকে build করার জন্য।

</details>

### Agents

Kilo বিশেষায়িত agents সহ আসে, কাজ অনুযায়ী আপনি এগুলোর মধ্যে বদলাতে পারেন। আপনি নিজের custom agents-ও বানাতে পারেন।

- **Code** - ডিফল্ট। প্রাকৃতিক ভাষা থেকে কোড implement এবং edit করে।
- **Plan** - কোনো কোড লেখার আগে architecture design করে এবং implementation plan লেখে।
- **Ask** - কোনো ফাইল না ছুঁয়ে আপনার codebase সম্পর্কে প্রশ্নের উত্তর দেয়।
- **Debug** - সমস্যা troubleshoot এবং trace করে।
- **Review** - আপনার পরিবর্তন review করে এবং performance, security, style ও test coverage-এর সমস্যা তুলে ধরে।

[agents এবং custom agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) সম্পর্কে আরও জানুন।

### এটি কী করে

- প্রাকৃতিক ভাষা থেকে একাধিক ফাইলে **code generation**।
- ghost-text suggestion এবং Tab দিয়ে accept করার **inline autocomplete**।
- agent যেন নিজের কাজ review ও correct করে তার জন্য **self-checking**।
- command চালানো এবং web automate করার জন্য **terminal ও browser control**।
- agent-এর ক্ষমতা বাড়ায় এমন MCP server খুঁজে ও যুক্ত করার জন্য **MCP marketplace**।
- latency, cost এবং reasoning কাজের সাথে মেলাতে mid-task switching সহ **500টির বেশি model**।

### Autonomous Mode (CI/CD)

CI/CD pipeline-এর জন্য prompts ছাড়া পুরোপুরি autonomous operation পেতে `kilo run`-এর সাথে `--auto` ব্যবহার করুন:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` সব permission prompt বন্ধ করে এবং agent-কে confirmation ছাড়া যেকোনো action execute করতে দেয়। শুধু trusted environment-এ ব্যবহার করুন।

### ডকুমেন্টেশন

Configuration এবং বাকি সবকিছুর জন্য [docs](https://kilo.ai/docs) দেখুন।

### Contributing

Developer, writer এবং সবাইকে contribution-এর জন্য স্বাগতম। environment setup, coding standard এবং pull request খোলার পদ্ধতির জন্য [Contributing Guide](/CONTRIBUTING.md) দিয়ে শুরু করুন। VS Code extension এবং CLI release process-এর জন্য [RELEASING.md](../RELEASING.md), এবং JetBrains plugin-এর জন্য [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) দেখুন।

অংশ নেওয়ার আগে আমাদের [Code of Conduct](/CODE_OF_CONDUCT.md) পড়ুন।

### License

MIT। attribution এবং license notice রেখে আপনি এই code ব্যবহার, পরিবর্তন এবং distribute করতে পারেন, commercial ব্যবহারসহ। [License](/LICENSE) দেখুন।

### FAQ

<details>
<summary>Kilo CLI কোথা থেকে এসেছে?</summary>

Kilo CLI হলো [OpenCode](https://github.com/anomalyco/opencode)-এর একটি fork, Kilo agentic engineering platform-এর মধ্যে কাজ করার জন্য উন্নত করা হয়েছে।

</details>

---

**কমিউনিটিতে যোগ দিন** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
