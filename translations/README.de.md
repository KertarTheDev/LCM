<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | Deutsch | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

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

### KiloCode-LCM-Vorabversion

KiloCode-LCM ist eine modifizierte Version von Kilo Code, die lange Sitzungen besser handhaben soll.

Normale Coding-Agenten haben irgendwann keinen Platz mehr in ihrem Chatverlauf. Wenn das passiert, pressen sie ältere Gespräche meist in eine kurze Zusammenfassung und lassen Details fallen. So kann der Chat weitergehen, aber der Agent kann genaue Befehle, Dateien, Fehler und Entscheidungen von früher in der Aufgabe vergessen.

LCM funktioniert anders. Es behält ein lokales Gedächtnis der Unterhaltung, fasst ältere Teile bei Bedarf zusammen und gibt dem Agenten sichere Möglichkeiten, Details später wieder nachzuschlagen. Das Ziel ist einfach: Lange Sitzungen sollen sich weniger so anfühlen, als würde man nach jedem Kontextlimit neu anfangen, und mehr wie die Arbeit mit jemandem, der seine Notizen noch prüfen kann.

Das soll verbessert werden:

- Bessere Kontinuität bei langen Programmieraufgaben.
- Weniger versehentliches Vergessen, wenn der Kontext groß wird.
- Zuverlässigeres Wiederfinden exakter früherer Details.
- Weniger Fälle, in denen alter Kontext stillschweigend weggeworfen wird.

Der Tokenverbrauch hängt von der Aufgabe ab. Kurze Chats können ungefähr gleich viele Tokens verwenden, oder etwas mehr, weil LCM den aktuellen Kontext frisch hält und im Hintergrund Speicherarbeit erledigen kann. Längere Sitzungen sollten normalerweise weniger Tokens dafür ausgeben, immer wieder alte Chatverläufe im Hauptprompt mitzutragen, aber ein Teil dieser Einsparung kann für Speicherpflege oder Nachschlageaufrufe verwendet werden. In der Praxis optimiert LCM zuerst darauf, sicherer mehr zu behalten, und danach darauf, verschwendete Long-Context-Tokens zu reduzieren.

Dies ist weiterhin eine Vorabversion. Verwende zum Testen von LCM die GitHub-Release-Artefakte aus diesem Repository. Die normalen Kilo-Code-Pakete im Marketplace und auf npm bleiben die Upstream-Releases.

LCM ist inspiriert vom Paper [LCM: Lossless Context Management](https://arxiv.org/abs/2605.04050). Weitere Implementierungsdetails stehen in den [Current-Code-Spezifikationen](specifications/README.md).

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
