<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | 繁體中文 | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## 試用 LCM 預發行版

這個實驗版 Kilo Code 會把已使用的舊內容轉成可搜尋的摘要樹，讓長對話繼續實用。最近的工作會原樣保留，代理需要時也能找回較早的細節。

> [!IMPORTANT]
> 含有 LCM 的版本只會透過本儲存庫的 GitHub Releases 發布。從 Marketplace、Open VSX、npm、Homebrew、AUR、雲端服務或 JetBrains 安裝的，都是不含 LCM 的 Kilo Code 官方版。

[想了解背後的想法？請閱讀 Clint Ehrlich 與 Theodore Blackman 的 LCM 原始論文。](https://arxiv.org/abs/2605.04050)

**目前預發行版:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### 選擇下載檔案

使用 VS Code 或 VSCodium 時選 VSIX；在終端機工作時選 CLI 壓縮檔。兩者可以同時安裝。

#### 確認系統

Windows 請查看 Settings → System → About → System type；macOS 請查看 Apple menu → About This Mac；Linux 請執行 uname -m。x86_64 或 amd64 代表 x64，arm64 或 aarch64 代表 ARM64。

大多數 Linux 桌面使用 glibc；Alpine 和小型 container 使用 musl。只有舊 x64 CPU，或一般 CLI 因 illegal instruction 結束時才選 baseline；沒有獨立的 baseline VSIX。

#### VS Code / VSCodium

需要 VS Code 或 VSCodium 1.105.1 或更新版本。VSIX 使用一般 Kilo Code 的 extension ID，因此會取代已安裝的 Marketplace 版本。

|系統|檔案|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

下載相符檔案，關閉 Kilo Code 自動更新，再選 Extensions → … → Install from VSIX。安裝後重新載入視窗。也可使用下方指令。

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

從表格下載一個壓縮檔。把整個壓縮檔解壓縮到獨立資料夾，並讓所有支援檔案留在執行檔旁。

|系統|檔案|
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

把資料夾加入 PATH 前，先執行一次解壓縮的程式。若之後啟動了其他 Kilo，請用下方指令檢查路徑，並把 LCM 資料夾放在 PATH 前面。

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

### 設定 Kilo 和 LCM

先連接常用的服務供應商並選擇模型。Conversation Memory 預設開啟，可在 Settings → Experimental 中確認。接著開啟 Settings → Context；預設會從 40% 開始處理。自訂模型的內容上限與輸出權杖上限必須是正數，輸入上限可不填。

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

啟用 LCM 時，compaction.auto 只控制 Kilo 舊的壓縮系統，不會關閉 LCM。

#### Ollama

Ollama 請填真實 server 位址：同一台機器通常是 localhost:11434，其他裝置則用電腦的 LAN 位址。確認 Ollama 在該位址監聽、firewall 允許連線，且 model 的 num_ctx 不小於 Kilo 中填入的 context limit。

### 檢查是否正常

開始聊天，選擇服務供應商和模型，再執行 /lcm status。狀態應為 enabled，而且系統已識別容量。工作標題或 Context 頁面會顯示內容用量與 LCM 活動。/compact 會手動執行一次 LCM；較短的新聊天可能還沒有內容可摘要。

### 實用提示

產生摘要需要呼叫模型，因此可能增加少量等待和費用。建議先用 40%；想提早處理就調低，想減少呼叫就調高。LCM 記憶只屬於目前聊天。內容匯出可能含有敏感的提示詞與工具輸出，請像保護聊天內容一樣妥善保管。

#### 快速排解

看到 lcm_capacity_unknown 時，請填入所選自訂 model 的 context 與 output limit。若重啟後 extension 變回其他版本，請關閉 auto-update 並重裝 VSIX。若 CLI 版本不對，請檢查 which -a kilo 或 where.exe kilo。Alpine 使用 musl；舊 x64 CPU 可試 baseline。

#### 更新或回復

更新時，在舊版上安裝新版 VSIX，或替換已解壓縮的 CLI 資料夾。聊天仍保存在 Kilo 的 SQLite。要快速還原，把 experimental.conversation_memory 設為 false；也可重裝 Kilo Code 官方版或較舊的預發行版。

> [!NOTE]
> 本頁其餘內容介紹 Kilo Code 官方版。下方的一般安裝連結不會安裝這個含 LCM 的版本。

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">用於在 VS Code、JetBrains 或 CLI 中運用 AI 建構的開源編碼代理。</p>

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

Kilo Code 是一個 AI 編碼代理，可在你工作的任何地方使用：[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native) 和 [CLI](https://kilo.ai/cli)。它是開源專案，並採用開放定價。你可以從 500 多個模型中選擇，在任務中途切換模型，並按模型供應商的價格付費，沒有加價。開始使用不需要 API 金鑰。

### 安裝

選擇你想執行 Kilo 的位置。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

直接安裝 [Kilo Code 擴充功能](vscode:extension/kilocode.kilo-code)，或從 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) 取得。建立帳戶後，你可以按供應商價格使用 500 多個模型，包括 GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6 和 Gemini 3.1 Pro Preview。

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

然後在任何專案目錄中執行 `kilo` 即可開始。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

從 JetBrains Marketplace 安裝 [Kilo Code 外掛](https://plugins.jetbrains.com/plugin/28350-kilo-code)，或在任何 JetBrains IDE 的 `Settings → Plugins` 中搜尋 "Kilo Code"。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

無需本機電腦，在 Web 上透過 [app.kilo.ai/cloud](https://app.kilo.ai/cloud) 執行 Kilo。

</details>

<details>
<summary><strong>程式碼審查</strong></summary>

<br>

在 [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) 為你的 Pull Request 設定自動 AI 程式碼審查。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

在 [app.kilo.ai/claw](https://app.kilo.ai/claw) 啟動你的常駐 AI 代理。

</details>

<details>
<summary>從 GitHub Releases 安裝 CLI（二進位檔）</summary>

從 [Releases 頁面](https://github.com/Kilo-Org/kilocode/releases) 下載最新二進位檔。

| 平台 | 資源 |
|---|---|
| Windows（大多數 PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

注意：`x64-baseline` 是面向不支援 AVX 的舊 CPU 的相容性建置。`musl` 是面向 Alpine 或沒有 glibc 的極簡 Docker 映像的靜態連結建置。`kilo-vscode-*.vsix` 是 VS Code 擴充功能套件，不是 CLI。`Source code` 封存檔用於從原始碼建置。

</details>

### Agents

Kilo 內建可依任務切換的專用 Agents。你也可以建立自己的自訂 Agents。

- **Code** - 預設。根據自然語言實作和編輯程式碼。
- **Plan** - 在撰寫任何程式碼之前設計架構並撰寫實作計畫。
- **Ask** - 回答關於程式碼庫的問題，不修改任何檔案。
- **Debug** - 疑難排解並追蹤問題。
- **Review** - 審查你的變更，並找出效能、安全性、風格和測試覆蓋率方面的問題。

深入了解 [agents 和自訂 agents](https://kilo.ai/docs/code-with-ai/agents/using-agents)。

### 功能

- **程式碼產生**：以自然語言跨多個檔案產生程式碼。
- **行內自動完成**：提供 ghost-text 建議，按 Tab 接受。
- **自我檢查**：讓代理審查並修正自己的工作。
- **終端機和瀏覽器控制**：執行命令並自動化網頁操作。
- **MCP 市集**：尋找並連接 MCP 伺服器，擴充代理能力。
- **500 多個模型**：支援任務中途切換，讓你根據延遲、成本和推理能力匹配任務。

### 自主模式（CI/CD）

使用 `--auto` 執行 `kilo run`，可在 CI/CD 管線中進行無提示的完全自主操作：

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` 會停用所有權限提示，並允許代理在無需確認的情況下執行任何操作。僅在可信任環境中使用。

### 文件

關於設定和其他內容，請查看[文件](https://kilo.ai/docs)。

### 貢獻

歡迎開發者、作者以及所有人參與貢獻。請先閱讀 [Contributing Guide](/CONTRIBUTING.md)，了解環境設定、程式碼標準以及如何建立 Pull Request。VS Code 擴充功能和 CLI 的發布流程請參閱 [RELEASING.md](../RELEASING.md)，JetBrains 外掛請參閱 [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md)。

參與前請閱讀我們的 [Code of Conduct](/CODE_OF_CONDUCT.md)。

### 授權

MIT。你可以使用、修改和散布此程式碼，包括商業用途，只要保留署名和授權聲明。請參閱 [License](/LICENSE)。

### FAQ

<details>
<summary>Kilo CLI 從何而來？</summary>

Kilo CLI 是 [OpenCode](https://github.com/anomalyco/opencode) 的 fork，並增強為可在 Kilo agentic engineering 平台中使用。

</details>

---

**加入社群** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
