<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | 한국어 | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## LCM 프리릴리스 사용해 보기

이 실험용 Kilo Code 빌드는 이미 사용한 오래된 컨텍스트를 검색 가능한 요약 트리로 바꿔 긴 채팅을 계속 유용하게 만듭니다. 최근 작업은 정확히 남고, 에이전트는 필요할 때 이전 세부 내용을 다시 찾을 수 있습니다.

> [!IMPORTANT]
> LCM이 포함된 빌드는 이 저장소의 GitHub Releases에서만 배포합니다. Marketplace, Open VSX, npm, Homebrew, AUR, 클라우드, JetBrains에서 설치하면 LCM이 없는 공식 Kilo Code 버전을 받게 됩니다.

[아이디어가 궁금하다면 Clint Ehrlich와 Theodore Blackman의 원본 LCM 논문을 읽어 보세요.](https://arxiv.org/abs/2605.04050)

**현재 프리릴리스:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### 다운로드 선택

VS Code 또는 VSCodium을 쓰면 VSIX, 터미널을 쓰면 CLI 압축 파일을 고르세요. 둘 다 설치해도 됩니다.

#### 시스템 확인

Windows는 Settings → System → About → System type, macOS는 Apple menu → About This Mac을 확인하고 Linux는 uname -m을 실행하세요. x86_64 또는 amd64는 x64, arm64 또는 aarch64는 ARM64입니다.

대부분의 Linux 데스크톱은 glibc를, Alpine과 작은 컨테이너는 musl을 씁니다. baseline은 오래된 x64 CPU이거나 일반 CLI가 illegal instruction으로 끝날 때만 고르세요. 별도 baseline VSIX는 없습니다.

#### VS Code / VSCodium

VS Code 또는 VSCodium 1.105.1 이상이 필요합니다. VSIX는 일반 Kilo Code 확장 ID를 사용하므로 설치된 Marketplace 빌드를 교체합니다.

|시스템|파일|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

맞는 파일을 내려받고 Kilo Code 자동 업데이트를 끈 뒤 Extensions → … → Install from VSIX를 선택하세요. 설치 후 창을 다시 로드하세요. 아래 명령을 사용해도 됩니다.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

표에서 압축 파일 하나를 받으세요. 전용 폴더에 전체를 풀고 모든 지원 파일을 실행 파일 옆에 그대로 두세요.

|시스템|파일|
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

폴더를 PATH에 넣기 전에 추출한 바이너리를 한 번 실행하세요. 나중에 다른 Kilo가 실행되면 아래 경로 확인을 사용하고 LCM 폴더를 PATH 앞쪽에 놓으세요.

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

### Kilo와 LCM 설정

먼저 평소 사용하는 제공자를 연결하고 모델을 선택하세요. Conversation Memory는 기본으로 켜져 있습니다. 확장의 Settings → Experimental에서 확인한 다음 Settings → Context를 여세요. 작업을 시작하는 기본 기준은 60%입니다. 사용자 지정 모델에는 양수인 컨텍스트 한도와 출력 토큰 한도가 필요하며, 입력 한도는 선택 사항입니다.

```jsonc
{
  "experimental": {
    "conversation_memory": true
  },
  "conversation_memory": {
    "soft_threshold_percent": 60
  }
}
```

LCM이 켜진 동안 compaction.auto는 Kilo의 기존 compaction 기능만 제어하며 LCM을 끄지는 않습니다.

#### Ollama

Ollama에는 실제 서버 주소를 쓰세요. 같은 컴퓨터라면 보통 localhost:11434, 다른 장치라면 컴퓨터의 LAN 주소입니다. Ollama가 그 주소에서 수신하고 firewall이 허용하며 model의 num_ctx가 Kilo에 넣은 context limit 이상인지 확인하세요.

### 작동 확인

채팅을 시작하고 제공자와 모델을 고른 뒤 /lcm status를 실행하세요. 상태가 enabled이고 용량이 인식되는지 확인합니다. 작업 헤더 또는 Context 화면에서 사용량과 LCM 동작을 볼 수 있습니다. /compact는 LCM을 수동으로 한 번 실행합니다. 짧은 새 채팅에는 아직 요약할 내용이 없을 수 있습니다.

### 유용한 팁

요약에는 모델 호출이 사용되어 약간의 지연과 제공자 비용이 더 생길 수 있습니다. 60%로 시작하고 더 일찍 정리하려면 낮추고 호출을 줄이려면 높이세요. LCM 메모리는 현재 채팅에만 속합니다. 컨텍스트 내보내기에는 민감한 프롬프트와 도구 출력이 들어갈 수 있습니다.

#### 빠른 해결

lcm_capacity_unknown이 보이면 선택한 custom model의 context와 output limit를 채우세요. 재시작 뒤 확장이 돌아가면 auto-update를 끄고 VSIX를 다시 설치하세요. CLI 버전이 다르면 which -a kilo 또는 where.exe kilo를 확인하세요. Alpine은 musl, 오래된 x64는 baseline을 쓰세요.

#### 업데이트 또는 되돌리기

업데이트하려면 새 VSIX를 기존 버전 위에 설치하거나 압축을 푼 CLI 폴더를 교체하세요. 채팅은 Kilo의 SQLite에 남습니다. 빠르게 되돌리려면 experimental.conversation_memory를 false로 설정하세요. 공식 Kilo Code나 이전 프리릴리스를 다시 설치해도 됩니다.

> [!NOTE]
> 아래 내용은 공식 Kilo Code에 관한 설명입니다. 아래의 일반 설치 링크로는 이 LCM 버전이 설치되지 않습니다.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code, JetBrains 또는 CLI에서 AI로 개발하기 위한 오픈 소스 코딩 에이전트입니다.</p>

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

Kilo Code는 [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native), [CLI](https://kilo.ai/cli) 등 작업하는 모든 곳에서 사용할 수 있는 AI 코딩 에이전트입니다. 오픈 소스이며 투명한 가격 정책을 제공합니다. 500개 이상의 모델 중에서 선택하고, 작업 중간에 모델을 전환하며, 추가 요금 없이 모델 제공업체의 요금만 지불합니다. 시작할 때 API 키가 필요하지 않습니다.

### 설치

Kilo를 실행할 위치를 선택하세요.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code 확장](vscode:extension/kilocode.kilo-code)을 직접 설치하거나 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code)에서 설치하세요. 계정을 만들면 GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6, Gemini 3.1 Pro Preview를 포함한 500개 이상의 모델을 제공업체 가격으로 사용할 수 있습니다.

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

그런 다음 아무 프로젝트 디렉터리에서 `kilo`를 실행해 시작하세요.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace에서 [Kilo Code 플러그인](https://plugins.jetbrains.com/plugin/28350-kilo-code)을 설치하거나, JetBrains IDE의 `Settings → Plugins`에서 "Kilo Code"를 검색하세요.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

로컬 머신 없이 웹에서 [app.kilo.ai/cloud](https://app.kilo.ai/cloud)로 Kilo를 실행하세요.

</details>

<details>
<summary><strong>코드 리뷰</strong></summary>

<br>

[app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)에서 pull request에 자동 AI 코드 리뷰를 설정하세요.

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

[app.kilo.ai/claw](https://app.kilo.ai/claw)에서 항상 켜져 있는 AI 에이전트를 시작하세요.

</details>

<details>
<summary>GitHub Releases에서 CLI 설치하기(바이너리)</summary>

[Releases 페이지](https://github.com/Kilo-Org/kilocode/releases)에서 최신 바이너리를 다운로드하세요.

| 플랫폼 | 에셋 |
|---|---|
| Windows(대부분의 PC) | `kilo-windows-x64.zip` |
| macOS(Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS(Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

참고: `x64-baseline`은 AVX가 없는 구형 CPU용 호환 빌드입니다. `musl`은 Alpine 또는 glibc가 없는 최소 Docker 이미지용 정적 링크 빌드입니다. `kilo-vscode-*.vsix`는 CLI가 아니라 VS Code 확장 패키지입니다. `Source code` 아카이브는 소스에서 빌드할 때 사용합니다.

</details>

### Agents

Kilo에는 작업에 따라 전환할 수 있는 특화된 agents가 포함되어 있습니다. 사용자 지정 agents도 만들 수 있습니다.

- **Code** - 기본값입니다. 자연어로 코드를 구현하고 편집합니다.
- **Plan** - 코드가 작성되기 전에 아키텍처를 설계하고 구현 계획을 작성합니다.
- **Ask** - 파일을 변경하지 않고 코드베이스에 대한 질문에 답합니다.
- **Debug** - 문제를 해결하고 추적합니다.
- **Review** - 변경 사항을 검토하고 성능, 보안, 스타일, 테스트 커버리지 문제를 찾아냅니다.

[agents와 사용자 지정 agents](https://kilo.ai/docs/code-with-ai/agents/using-agents)에 대해 더 알아보세요.

### 기능

- 여러 파일에 걸친 자연어 기반 **코드 생성**.
- ghost-text 제안과 Tab 수락을 지원하는 **인라인 자동완성**.
- 에이전트가 자신의 작업을 검토하고 수정하는 **자체 점검**.
- 명령 실행과 웹 자동화를 위한 **터미널 및 브라우저 제어**.
- 에이전트 기능을 확장하는 MCP 서버를 찾고 연결하는 **MCP 마켓플레이스**.
- 지연 시간, 비용, 추론 능력을 작업에 맞출 수 있는 작업 중 전환 지원 **500개 이상의 모델**.

### 자율 모드(CI/CD)

CI/CD 파이프라인용으로 프롬프트 없이 완전 자율 실행하려면 `kilo run`에 `--auto`를 사용하세요.

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto`는 모든 권한 프롬프트를 비활성화하고 에이전트가 확인 없이 모든 작업을 실행할 수 있게 합니다. 신뢰할 수 있는 환경에서만 사용하세요.

### 문서

설정과 기타 모든 내용은 [문서](https://kilo.ai/docs)를 참조하세요.

### 기여

개발자, 작성자 등 누구나 기여할 수 있습니다. 환경 설정, 코딩 표준, pull request 여는 방법은 [Contributing Guide](/CONTRIBUTING.md)에서 시작하세요. VS Code 확장과 CLI 릴리스 절차는 [RELEASING.md](../RELEASING.md)를, JetBrains 플러그인은 [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md)를 참조하세요.

참여하기 전에 [Code of Conduct](/CODE_OF_CONDUCT.md)를 읽어 주세요.

### 라이선스

MIT. 저작자 표시와 라이선스 고지를 유지하는 한, 상업적 사용을 포함해 이 코드를 사용, 수정, 배포할 수 있습니다. [License](/LICENSE)를 참조하세요.

### FAQ

<details>
<summary>Kilo CLI는 어디에서 왔나요?</summary>

Kilo CLI는 [OpenCode](https://github.com/anomalyco/opencode)의 fork이며, Kilo agentic engineering 플랫폼에서 작동하도록 강화되었습니다.

</details>

---

**커뮤니티 참여** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
