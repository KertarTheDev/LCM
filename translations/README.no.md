<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | Norsk | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Prøv LCM-forhåndsversjonen

Denne eksperimentelle Kilo Code-versjonen holder lange samtaler nyttige ved å gjøre eldre, allerede brukt kontekst om til et søkbart sammendragstre. Nylig arbeid forblir nøyaktig, og agenten kan hente fram gamle detaljer ved behov.

> [!IMPORTANT]
> Versjoner med LCM distribueres bare via GitHub Releases i dette repositoriet. Marketplace, Open VSX, npm, Homebrew, AUR, skytjenester og JetBrains installerer den offisielle Kilo Code-versjonen uten LCM.

[Vil du forstå ideen? Les den opprinnelige LCM-artikkelen av Clint Ehrlich og Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Gjeldende forhåndsversjon:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### Velg nedlasting

Velg VSIX for VS Code eller VSCodium og et CLI-arkiv for terminalen. Du kan installere begge.

#### Finn systemet ditt

I Windows: Settings → System → About → System type. I macOS: Apple menu → About This Mac. I Linux: kjør uname -m. x86_64 eller amd64 betyr x64; arm64 eller aarch64 betyr ARM64.

De fleste Linux-skrivebord bruker glibc; Alpine og små containere bruker musl. Velg baseline bare for en eldre x64-CPU eller hvis vanlig CLI stopper med illegal instruction. Det finnes ingen egen baseline-VSIX.

#### VS Code / VSCodium

Du trenger VS Code eller VSCodium 1.105.1 eller nyere. VSIX bruker samme utvidelses-ID som vanlig Kilo Code og erstatter derfor en installert Marketplace-versjon.

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

Last ned riktig fil, slå av automatisk oppdatering for Kilo Code og velg Extensions → … → Install from VSIX. Last vinduet på nytt etterpå. Du kan også bruke kommandoene under.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Last ned ett arkiv fra tabellen. Pakk ut hele arkivet i en egen mappe og behold alle støttefiler ved siden av programmet.

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

Kjør den utpakkede binærfilen én gang før mappen legges til PATH. Hvis en annen Kilo starter senere, bruk stikontrollene under og sett LCM-mappen tidligere i PATH.

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

### Sett opp Kilo og LCM

Koble til leverandøren du vanligvis bruker, og velg en modell. Conversation Memory er slått på som standard. Kontroller dette under Settings → Experimental, og åpne deretter Settings → Context. Startgrensen er 60 %. Egne modeller må ha positive grenser for kontekst og utdata; inndatagrensen er valgfri.

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

Når LCM er aktivt, styrer compaction.auto bare Kilos eldre komprimeringssystem; det slår ikke av LCM.

#### Ollama

For Ollama bruker du den virkelige serveradressen—ofte localhost:11434 på samme maskin eller maskinens LAN-adresse fra en annen enhet. Ollama må lytte der, brannmuren må tillate det, og num_ctx må være minst kontekstgrensen du oppgir i Kilo.

### Kontroller at det virker

Start en chat, velg leverandør og modell, og kjør /lcm status. Statusen skal være enabled, og kapasiteten skal være kjent. Oppgavehodet eller Context-siden viser bruk og LCM-aktivitet. /compact starter én manuell LCM-runde; en kort, ny chat har kanskje ikke noe å oppsummere ennå.

### Nyttige tips

Sammendrag bruker modellkall og kan gi litt ekstra tid og kostnad. Start med 60%; senk for tidligere vedlikehold eller hev for færre kall. LCM-minnet tilhører gjeldende chat. Konteksteksport kan inneholde følsomme ledetekster og verktøyresultater.

#### Raske løsninger

Ved lcm_capacity_unknown fyller du inn kontekst- og outputgrenser for valgt egen modell. Hvis utvidelsen byttes tilbake etter omstart, slå av auto-update og installer VSIX på nytt. Ved feil CLI bruker du which -a kilo eller where.exe kilo. På Alpine velger du musl, på gammel x64 baseline.

#### Oppdater eller rull tilbake

For oppdatering installerer du ny VSIX over den gamle eller bytter ut den utpakkede CLI-mappen. Chattene blir i Kilos SQLite-database. For rask tilbakerulling setter du experimental.conversation_memory til false; du kan også reinstallere den offisielle Kilo Code-versjonen eller en eldre forhåndsversjon.

> [!NOTE]
> Resten av siden beskriver den offisielle Kilo Code-versjonen. De vanlige installasjonslenkene lenger ned installerer ikke denne versjonen med LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Den åpne kildekodeagenten for å bygge med AI i VS Code, JetBrains eller CLI.</p>

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

Kilo Code er en AI-kodeagent som møter deg overalt du jobber: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) og [CLI](https://kilo.ai/cli). Den er åpen kildekode med åpen prising. Du velger blant mer enn 500 modeller, bytter mellom dem midt i en oppgave og betaler modellleverandørens pris uten påslag. Ingen API-nøkler kreves for å starte.

### Installasjon

Velg hvor du vil kjøre Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installer [Kilo Code-utvidelsen](vscode:extension/kilocode.kilo-code) direkte, eller hent den fra [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Opprett en konto, og du får tilgang til mer enn 500 modeller, inkludert GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 og Gemini 3.1 Pro Preview, alle til leverandørpris.

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

Kjør deretter `kilo` i en prosjektmappe for å starte.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installer [Kilo Code-pluginen](https://plugins.jetbrains.com/plugin/28350-kilo-code) fra JetBrains Marketplace, eller søk etter "Kilo Code" i `Settings → Plugins` i en JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Kjør Kilo fra nettet, uten lokal maskin, på [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Kodegjennomganger</strong></summary>

<br>

Sett opp automatiske AI-kodegjennomganger på pull requestene dine på [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Start din alltid aktive AI-agent på [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Installer CLI fra GitHub Releases (binærfiler)</summary>

Last ned den nyeste binærfilen fra [Releases-siden](https://github.com/Kilo-Org/kilocode/releases).

| Plattform | Asset |
|---|---|
| Windows (de fleste PC-er) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Merknader: `x64-baseline` er en kompatibilitetsbygg for eldre CPU-er uten AVX. `musl` er den statisk lenkede byggen for Alpine eller minimale Docker-bilder uten glibc. `kilo-vscode-*.vsix` er VS Code-utvidelsespakken, ikke CLI-en. `Source code`-arkiver er for bygging fra kildekode.

</details>

### Agents

Kilo leveres med spesialiserte agents du kan bytte mellom avhengig av oppgaven. Du kan også bygge dine egne egendefinerte agents.

- **Code** - Standard. Implementerer og redigerer kode fra naturlig språk.
- **Plan** - Designer arkitektur og skriver implementeringsplaner før kode skrives.
- **Ask** - Svarer på spørsmål om kodebasen uten å endre filer.
- **Debug** - Feilsøker og sporer problemer.
- **Review** - Gjennomgår endringene dine og finner problemer med ytelse, sikkerhet, stil og testdekning.

Les mer om [agents og egendefinerte agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Hva den gjør

- **Kodegenerering** fra naturlig språk, på tvers av flere filer.
- **Inline-autofullføring** med ghost-text-forslag og Tab for å godta.
- **Selvsjekking** slik at agenten vurderer og retter sitt eget arbeid.
- **Terminal- og nettleserkontroll** for å kjøre kommandoer og automatisere nettet.
- **MCP-markedsplass** for å finne og koble til MCP-servere som utvider hva agenten kan gjøre.
- **Mer enn 500 modeller** med bytte midt i oppgaven, slik at du kan matche latenstid, kostnad og resonnering til jobben.

### Autonom modus (CI/CD)

Kjør `kilo run` med `--auto` for helt autonom drift uten spørsmål, bygget for CI/CD-pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` deaktiverer alle tillatelsesspørsmål og lar agenten utføre enhver handling uten bekreftelse. Bruk det bare i betrodde miljøer.

### Dokumentasjon

For konfigurasjon og alt annet, se [dokumentasjonen](https://kilo.ai/docs).

### Bidra

Bidrag er velkomne fra utviklere, skribenter og alle andre. Start med [Contributing Guide](/CONTRIBUTING.md) for miljøoppsett, kodestandarder og hvordan du åpner en pull request. Se [RELEASING.md](../RELEASING.md) for releaseprosessen for VS Code-utvidelsen og CLI-en, og [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) for JetBrains-pluginen.

Les vår [Code of Conduct](/CODE_OF_CONDUCT.md) før du deltar.

### Lisens

MIT. Du kan bruke, endre og distribuere denne koden, også kommersielt, så lenge du beholder attribusjons- og lisensmerknadene. Se [License](/LICENSE).

### FAQ

<details>
<summary>Hvor kommer Kilo CLI fra?</summary>

Kilo CLI er en fork av [OpenCode](https://github.com/anomalyco/opencode), forbedret for å fungere i Kilo agentic engineering-plattformen.

</details>

---

**Bli med i fellesskapet** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
