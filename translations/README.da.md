<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | Dansk | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Prøv LCM-prereleasen

Denne eksperimentelle Kilo Code-version holder lange samtaler brugbare ved at lave ældre, allerede brugt kontekst om til et søgbart resumé-træ. Dit seneste arbejde forbliver nøjagtigt, og agenten kan hente gamle detaljer frem efter behov.

> [!IMPORTANT]
> LCM-builds findes kun under GitHub Releases i dette repository. Marketplace, Open VSX, npm, Homebrew, AUR, cloud og JetBrains installerer den officielle Kilo Code-version uden LCM.

[Vil du kende idéen bag? Læs den oprindelige LCM-artikel af Clint Ehrlich og Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Aktuel prerelease:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### Vælg download

Vælg en VSIX til VS Code eller VSCodium. Vælg et CLI-arkiv til terminalen. Du må gerne installere begge.

#### Find dit system

På Windows: Settings → System → About → System type. På macOS: Apple menu → About This Mac. På Linux: kør uname -m. x86_64 eller amd64 betyder x64; arm64 eller aarch64 betyder ARM64.

De fleste Linux-desktops bruger glibc; Alpine og små containere bruger musl. Vælg kun baseline til en ældre x64-CPU, eller hvis normal CLI stopper med illegal instruction. Der er ingen særskilt baseline-VSIX.

#### VS Code / VSCodium

Du skal bruge VS Code eller VSCodium 1.105.1 eller nyere. VSIX-filen bruger det normale Kilo Code-udvidelses-id og erstatter derfor en installeret Marketplace-version.

|System|Fil|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Hent den rigtige fil, slå automatisk opdatering fra for Kilo Code, og vælg Extensions → … → Install from VSIX. Genindlæs vinduet bagefter. Du kan også bruge en af kommandoerne herunder.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Hent ét arkiv fra tabellen. Pak hele arkivet ud i sin egen mappe, og behold alle supportfiler ved siden af programmet.

|System|Fil|
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

Kør den udpakkede binær én gang, før mappen tilføjes til PATH. Starter en anden Kilo senere, så brug sti-kontrollen herunder og placer LCM-mappen først i PATH.

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

### Opsæt Kilo og LCM

Forbind den udbyder, du normalt bruger, og vælg en model. Conversation Memory er slået til som standard. Kontrollér det under Settings → Experimental, og åbn derefter Settings → Context; startgrænsen er 60 %. Egne modeller skal have positive grænser for kontekst og output, mens inputgrænsen er valgfri.

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

Når LCM er aktiv, styrer compaction.auto kun Kilos ældre komprimeringssystem; det slår ikke LCM fra.

#### Ollama

Til Ollama skal du bruge den rigtige serveradresse—ofte localhost:11434 på samme maskine eller computerens LAN-adresse fra en anden enhed. Ollama skal lytte på adressen, firewallen skal tillade den, og modellens num_ctx skal mindst være kontekstgrænsen i Kilo.

### Kontrollér at det virker

Start en chat, vælg udbyder og model, og kør /lcm status. Status skal være enabled, og kapaciteten skal være kendt. Opgavehovedet eller siden Context viser forbrug og LCM-aktivitet. /compact starter én manuel LCM-cyklus; i en kort, ny chat er der måske endnu intet at opsummere.

### Nyttige tips

Resuméarbejde bruger modelkald og kan derfor give lidt ekstra ventetid og pris. Start med 60%; sænk for tidligere vedligeholdelse eller hæv for færre kald. LCM-hukommelse hører til den aktuelle chat. Konteksteksport kan indeholde følsomme prompts og værktøjsoutput.

#### Hurtige løsninger

Ved lcm_capacity_unknown skal du udfylde kontekst- og outputgrænser for den valgte egne model. Skifter udvidelsen tilbage efter genstart, så slå auto-update fra og geninstallér VSIX. Er CLI-versionen forkert, brug which -a kilo eller where.exe kilo. Brug musl på Alpine og baseline på gammel x64.

#### Opdatér eller rul tilbage

Ved opdatering installeres den nye VSIX oven på den gamle, eller den udpakkede CLI-mappe udskiftes. Chats bliver i Kilos SQLite-database. For hurtig tilbagerulning sættes experimental.conversation_memory til false; du kan også geninstallere den officielle Kilo Code-version eller en ældre prerelease.

> [!NOTE]
> Resten af siden beskriver den officielle Kilo Code-version. De normale installationslinks nedenfor installerer ikke denne LCM-version.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Den open source-kodeagent til at bygge med AI i VS Code, JetBrains eller CLI.</p>

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

Kilo Code er en AI-kodeagent, der møder dig overalt, hvor du arbejder: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) og [CLI](https://kilo.ai/cli). Den er open source med åben prissætning. Du vælger mellem mere end 500 modeller, skifter mellem dem midt i en opgave og betaler modeludbyderens pris uden tillæg. Ingen API-nøgler kræves for at komme i gang.

### Installation

Vælg, hvor du vil køre Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installer [Kilo Code-udvidelsen](vscode:extension/kilocode.kilo-code) direkte, eller hent den fra [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Opret en konto, og du får adgang til mere end 500 modeller, herunder GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 og Gemini 3.1 Pro Preview, alle til udbyderpris.

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

Kør derefter `kilo` i en vilkårlig projektmappe for at starte.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installer [Kilo Code-pluginet](https://plugins.jetbrains.com/plugin/28350-kilo-code) fra JetBrains Marketplace, eller søg efter "Kilo Code" i `Settings → Plugins` i en JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Kør Kilo fra webben, uden lokal maskine, på [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Kodegennemgange</strong></summary>

<br>

Opsæt automatiske AI-kodegennemgange på dine pull requests på [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Start din altid aktive AI-agent på [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Installer CLI fra GitHub Releases (binære filer)</summary>

Download den nyeste binære fil fra [Releases-siden](https://github.com/Kilo-Org/kilocode/releases).

| Platform | Asset |
|---|---|
| Windows (de fleste pc'er) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Bemærk: `x64-baseline` er en kompatibilitetsbuild til ældre CPU'er uden AVX. `musl` er den statisk linkede build til Alpine eller minimale Docker-images uden glibc. `kilo-vscode-*.vsix` er VS Code-udvidelsespakken, ikke CLI'en. `Source code`-arkiver er til at bygge fra kildekode.

</details>

### Agents

Kilo leveres med specialiserede agents, som du kan skifte mellem afhængigt af opgaven. Du kan også bygge dine egne brugerdefinerede agents.

- **Code** - Standard. Implementerer og redigerer kode fra naturligt sprog.
- **Plan** - Designer arkitektur og skriver implementeringsplaner, før der skrives kode.
- **Ask** - Besvarer spørgsmål om din kodebase uden at ændre filer.
- **Debug** - Fejlfinder og sporer problemer.
- **Review** - Gennemgår dine ændringer og finder problemer med ydeevne, sikkerhed, stil og testdækning.

Læs mere om [agents og brugerdefinerede agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Hvad den gør

- **Kodegenerering** fra naturligt sprog på tværs af flere filer.
- **Inline-autocomplete** med ghost-text-forslag og Tab for at acceptere.
- **Selvkontrol**, så agenten gennemgår og retter sit eget arbejde.
- **Terminal- og browserkontrol** til at køre kommandoer og automatisere webben.
- **MCP-markedsplads** til at finde og tilslutte MCP-servere, der udvider agentens muligheder.
- **Mere end 500 modeller** med skift midt i opgaven, så du kan matche latenstid, pris og ræsonnement til arbejdet.

### Autonom tilstand (CI/CD)

Kør `kilo run` med `--auto` for fuldt autonom drift uden prompts, bygget til CI/CD-pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` deaktiverer alle tilladelsesprompts og lader agenten udføre enhver handling uden bekræftelse. Brug det kun i betroede miljøer.

### Dokumentation

For konfiguration og alt andet, se [dokumentationen](https://kilo.ai/docs).

### Bidrag

Bidrag er velkomne fra udviklere, forfattere og alle andre. Start med [Contributing Guide](/CONTRIBUTING.md) for miljøopsætning, kodestandarder og hvordan du åbner en pull request. Se [RELEASING.md](../RELEASING.md) for releaseprocessen for VS Code-udvidelsen og CLI'en, og [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) for JetBrains-pluginet.

Læs venligst vores [Code of Conduct](/CODE_OF_CONDUCT.md), før du deltager.

### Licens

MIT. Du kan bruge, ændre og distribuere denne kode, også kommercielt, så længe du beholder attribution og licensmeddelelser. Se [License](/LICENSE).

### FAQ

<details>
<summary>Hvor kommer Kilo CLI fra?</summary>

Kilo CLI er en fork af [OpenCode](https://github.com/anomalyco/opencode), forbedret til at fungere i Kilo agentic engineering-platformen.

</details>

---

**Deltag i fællesskabet** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
