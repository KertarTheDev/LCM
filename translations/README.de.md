<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | Deutsch | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## LCM-Prerelease ausprobieren

Dieser experimentelle Kilo-Code-Build hält lange Chats nutzbar, indem er älteren, bereits verwendeten Kontext in einen durchsuchbaren Zusammenfassungsbaum umwandelt. Deine letzten Arbeitsschritte bleiben exakt erhalten, und der Agent kann ältere Details bei Bedarf zurückholen.

> [!IMPORTANT]
> LCM-Builds werden ausschließlich über die GitHub Releases dieses Repositorys verteilt. Marketplace, Open VSX, npm, Homebrew, AUR, Cloud und JetBrains installieren die offizielle Kilo-Code-Version ohne LCM.

[Du möchtest die Idee dahinter verstehen? Lies das ursprüngliche LCM-Paper von Clint Ehrlich und Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Aktuelle Prerelease:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Download auswählen

Nimm eine VSIX für VS Code oder VSCodium und ein CLI-Archiv für das Terminal. Beides zusammen ist kein Problem.

#### System bestimmen

Unter Windows: Settings → System → About → System type; unter macOS: Apple menu → About This Mac; unter Linux: uname -m. x86_64 oder amd64 bedeutet x64, arm64 oder aarch64 bedeutet ARM64.

Die meisten Linux-Desktopdistributionen verwenden glibc; Alpine und schlanke Container verwenden musl. Wähle baseline nur für ältere x64-Prozessoren oder wenn die normale CLI mit illegal instruction abbricht. Eine eigene baseline-VSIX gibt es nicht.

#### VS Code / VSCodium

Du brauchst VS Code oder VSCodium 1.105.1 oder neuer. Die VSIX verwendet dieselbe Erweiterungs-ID wie Kilo Code und ersetzt daher eine installierte Marketplace-Version.

|System|Datei|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Lade die passende Datei herunter, deaktiviere automatische Updates für Kilo Code und wähle Extensions → … → Install from VSIX. Lade danach das Fenster neu. Alternativ funktionieren die Befehle unten.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Lade genau ein Archiv aus der Tabelle. Entpacke es vollständig in einen eigenen Ordner und lasse alle Supportdateien neben dem Programm.

|System|Datei|
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

Starte das entpackte Programm einmal, bevor du den Ordner zu PATH hinzufügst. Startet später ein anderes Kilo, prüfe die Pfade unten und setze den LCM-Ordner in PATH nach vorn.

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

### Kilo und LCM einrichten

Verbinde den Anbieter, den du normalerweise nutzt, und wähle ein Modell. Conversation Memory ist standardmäßig aktiviert. Prüfe das unter Settings → Experimental und öffne anschließend Settings → Context; der Startwert liegt bei 40 %. Für eigene Modelle müssen Kontext- und Ausgabelimit positiv sein; das Eingabelimit ist optional.

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

Bei aktivem LCM steuert compaction.auto nur Kilos älteres Kompaktierungssystem; es schaltet LCM nicht aus.

#### Ollama

Nutze für Ollama die echte Serveradresse—meist localhost:11434 auf demselben Rechner oder dessen LAN-Adresse von einem anderen Gerät. Ollama muss dort lauschen, die Firewall muss den Zugriff erlauben, und num_ctx muss mindestens so groß wie die Kontextgrenze in Kilo sein.

### Funktion prüfen

Starte einen Chat, wähle Anbieter und Modell und führe /lcm status aus. Der Status sollte enabled sein und die Kapazität bekannt. Der Aufgabenkopf oder die Seite Context zeigt Auslastung und LCM-Aktivität. /compact startet einen manuellen LCM-Zyklus; in einem kurzen neuen Chat gibt es möglicherweise noch nichts zusammenzufassen.

### Nützliche Tipps

Zusammenfassungen verwenden Modellaufrufe und können etwas Zeit und Kosten hinzufügen. Beginne mit 40%; senke den Wert für frühere Wartung oder erhöhe ihn für weniger Aufrufe. LCM-Speicher gehört zum aktuellen Chat. Ein Kontextexport kann vertrauliche Prompts und Werkzeugausgaben enthalten.

#### Schnelle Lösungen

Bei lcm_capacity_unknown trägst du Kontext- und Ausgabegrenzen des gewählten eigenen Modells ein. Springt die Erweiterung nach einem Neustart zurück, schalte auto-update aus und installiere die VSIX erneut. Bei falscher CLI helfen which -a kilo oder where.exe kilo. Auf Alpine nimm musl, auf alter x64-Hardware baseline.

#### Aktualisieren oder zurückrollen

Zum Aktualisieren installierst du die neue VSIX über die alte oder ersetzt den entpackten CLI-Ordner. Chats bleiben in Kilos SQLite-Datenbank. Für ein schnelles Rollback setze experimental.conversation_memory auf false; du kannst auch Upstream-Kilo-Code oder eine ältere Prerelease installieren.

> [!NOTE]
> Der Rest dieser Seite beschreibt die offizielle Kilo-Code-Version. Die normalen Installationslinks weiter unten installieren diese LCM-Version nicht.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Der Open-Source-Coding-Agent zum Entwickeln mit KI in VS Code, JetBrains oder der CLI.</p>

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

Kilo Code ist ein KI-Coding-Agent, der überall dort arbeitet, wo du arbeitest: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) und die [CLI](https://kilo.ai/cli). Es ist Open Source mit transparenter Preisgestaltung. Du wählst aus über 500 Modellen, wechselst sie mitten in einer Aufgabe und zahlst den Tarif des Modellanbieters ohne Aufschlag. Zum Start sind keine API-Schlüssel erforderlich.

### Installation

Wähle aus, wo du Kilo ausführen möchtest.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installiere die [Kilo Code-Erweiterung](vscode:extension/kilocode.kilo-code) direkt oder lade sie aus dem [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Erstelle ein Konto und erhalte Zugriff auf über 500 Modelle, darunter GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 und Gemini 3.1 Pro Preview, alle zu Anbieterpreisen.

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

Führe anschließend `kilo` in einem beliebigen Projektverzeichnis aus.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installiere das [Kilo Code-Plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) aus dem JetBrains Marketplace oder suche in einer JetBrains-IDE unter `Settings → Plugins` nach "Kilo Code".

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Führe Kilo im Web aus, ohne lokalen Rechner, unter [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Richte automatisierte KI-Code-Reviews für deine Pull Requests unter [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) ein.

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Starte deinen ständig aktiven KI-Agenten unter [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>CLI aus GitHub Releases installieren (Binärdateien)</summary>

Lade die neueste Binärdatei von der [Releases-Seite](https://github.com/Kilo-Org/kilocode/releases) herunter.

| Plattform | Asset |
|---|---|
| Windows (die meisten PCs) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Hinweise: `x64-baseline` ist ein Kompatibilitäts-Build für ältere CPUs ohne AVX. `musl` ist der statisch gelinkte Build für Alpine oder minimale Docker-Images ohne glibc. `kilo-vscode-*.vsix` ist das VS Code-Erweiterungspaket, nicht die CLI. `Source code`-Archive dienen dem Bauen aus dem Quellcode.

</details>

### Agents

Kilo wird mit spezialisierten Agents ausgeliefert, zwischen denen du je nach Aufgabe wechselst. Du kannst auch eigene Agents erstellen.

- **Code** - Standard. Implementiert und bearbeitet Code aus natürlicher Sprache.
- **Plan** - Entwirft Architektur und schreibt Implementierungspläne, bevor Code geschrieben wird.
- **Ask** - Beantwortet Fragen zu deiner Codebasis, ohne Dateien zu ändern.
- **Debug** - Untersucht und verfolgt Probleme.
- **Review** - Prüft deine Änderungen und findet Probleme bei Performance, Sicherheit, Stil und Testabdeckung.

Mehr erfahren über [Agents und benutzerdefinierte Agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Funktionen

- **Codegenerierung** aus natürlicher Sprache über mehrere Dateien hinweg.
- **Inline-Autocomplete** mit Ghost-Text-Vorschlägen und Tab zum Übernehmen.
- **Selbstprüfung**, damit der Agent seine eigene Arbeit prüft und korrigiert.
- **Terminal- und Browsersteuerung**, um Befehle auszuführen und das Web zu automatisieren.
- **MCP-Marktplatz**, um MCP-Server zu finden und einzubinden, die den Agent erweitern.
- **Über 500 Modelle** mit Wechsel während einer Aufgabe, damit du Latenz, Kosten und Reasoning passend zur Aufgabe wählst.

### Autonomer Modus (CI/CD)

Führe `kilo run` mit `--auto` für vollständig autonomen Betrieb ohne Prompts aus, geeignet für CI/CD-Pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` deaktiviert alle Berechtigungsabfragen und erlaubt dem Agent, jede Aktion ohne Bestätigung auszuführen. Verwende es nur in vertrauenswürdigen Umgebungen.

### Dokumentation

Für Konfiguration und alles Weitere lies die [Dokumentation](https://kilo.ai/docs).

### Mitwirken

Beiträge von Entwicklerinnen, Autoren und allen anderen sind willkommen. Beginne mit dem [Contributing Guide](/CONTRIBUTING.md) für Einrichtung, Coding-Standards und Pull Requests. Siehe [RELEASING.md](../RELEASING.md) für den Release-Prozess der VS Code-Erweiterung und CLI sowie [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) für das JetBrains-Plugin.

Bitte lies unseren [Code of Conduct](/CODE_OF_CONDUCT.md), bevor du mitwirkst.

### Lizenz

MIT. Du darfst diesen Code verwenden, ändern und verbreiten, auch kommerziell, solange du die Attribution und Lizenzhinweise beibehältst. Siehe [License](/LICENSE).

### FAQ

<details>
<summary>Woher stammt Kilo CLI?</summary>

Kilo CLI ist ein Fork von [OpenCode](https://github.com/anomalyco/opencode), erweitert für die Kilo-Agentic-Engineering-Plattform.

</details>

---

**Tritt der Community bei** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
