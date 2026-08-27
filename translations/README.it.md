<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | Italiano | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Prova la prerelease LCM

Questa build sperimentale di Kilo Code mantiene utili le chat lunghe trasformando il contesto più vecchio già usato in un albero di riepiloghi ricercabile. Il lavoro recente resta esatto e l'agente può recuperare i vecchi dettagli quando servono.

> [!IMPORTANT]
> Le build con LCM sono distribuite solo nei GitHub Releases di questo repository. Marketplace, Open VSX, npm, Homebrew, AUR, i servizi cloud e JetBrains installano la versione ufficiale di Kilo Code, senza LCM.

[Vuoi capire l'idea? Leggi il paper LCM originale di Clint Ehrlich e Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Prerelease attuale:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Scegli il download

Scegli un VSIX per VS Code o VSCodium e un archivio CLI per il terminale. Puoi installarli entrambi.

#### Trova il tuo sistema

Su Windows guarda Settings → System → About → System type; su macOS Apple menu → About This Mac; su Linux esegui uname -m. x86_64 o amd64 significa x64; arm64 o aarch64 significa ARM64.

La maggior parte delle distribuzioni Linux desktop usa glibc; Alpine e alcuni container minimi usano musl. Scegli baseline solo per processori x64 datati o se la CLI normale si chiude con l'errore illegal instruction. Non esiste un VSIX baseline separato.

#### VS Code / VSCodium

Serve VS Code o VSCodium 1.105.1 o più recente. Il VSIX usa il normale ID dell'estensione Kilo Code, quindi sostituisce una build Marketplace installata.

|Sistema|File|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Scarica il file giusto, disattiva l'aggiornamento automatico di Kilo Code e scegli Extensions → … → Install from VSIX. Ricarica la finestra dopo. Puoi anche usare uno dei comandi qui sotto.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Scarica un archivio dalla tabella. Estrailo tutto in una cartella dedicata e tieni ogni file di supporto accanto all'eseguibile.

|Sistema|File|
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

Avvia una volta il binario estratto prima di aggiungere la cartella a PATH. Se poi parte un altro Kilo, usa i controlli qui sotto e metti prima la cartella LCM in PATH.

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

### Configura Kilo e LCM

Collega il provider che usi di solito e scegli un modello. Conversation Memory è attiva per impostazione predefinita. Controlla in Settings → Experimental, poi apri Settings → Context; la soglia iniziale è impostata al 40%. I modelli personalizzati richiedono limiti positivi per contesto e output; il limite di input è facoltativo.

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

Con LCM attivo, compaction.auto controlla solo il vecchio sistema di compattazione di Kilo; non disattiva LCM.

#### Ollama

Per Ollama usa il vero indirizzo del server: di solito localhost:11434 sulla stessa macchina o il suo indirizzo LAN da un altro dispositivo. Ollama deve ascoltare lì, il firewall deve consentirlo e num_ctx deve essere almeno il limite di contesto impostato in Kilo.

### Controlla che funzioni

Avvia una chat, scegli provider e modello ed esegui /lcm status. Lo stato deve essere enabled e la capacità deve risultare nota. L'intestazione dell'attività o la pagina Context mostra l'utilizzo e l'attività di LCM. /compact avvia un ciclo manuale; una chat nuova e breve potrebbe non avere ancora nulla da riassumere.

### Consigli utili

I riepiloghi usano chiamate al modello, quindi possono aggiungere un po' di tempo e costo. Parti dal 40%; abbassa per intervenire prima o alza per meno chiamate. La memoria LCM appartiene alla chat corrente. L'export del contesto può contenere prompt e output sensibili.

#### Soluzioni rapide

Se vedi lcm_capacity_unknown, inserisci i limiti di contesto e output del modello personalizzato. Se dopo il riavvio torna un'altra versione dell'estensione, disattiva gli aggiornamenti automatici e reinstalla il VSIX. Se parte la CLI sbagliata, usa which -a kilo o where.exe kilo. Su Alpine usa musl; su un vecchio processore x64 prova baseline.

#### Aggiorna o torna indietro

Per aggiornare, installa il nuovo VSIX sopra il vecchio o sostituisci la cartella CLI estratta. Le chat restano nel database SQLite di Kilo. Per tornare subito indietro, imposta experimental.conversation_memory su false; puoi anche reinstallare la versione ufficiale di Kilo Code o una prerelease precedente.

> [!NOTE]
> Il resto della pagina descrive la versione ufficiale di Kilo Code. I normali link di installazione più in basso non installano questa versione con LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">L'agente di coding open source per creare con l'IA in VS Code, JetBrains o nella CLI.</p>

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

Kilo Code è un agente di coding con IA che ti segue ovunque lavori: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) e la [CLI](https://kilo.ai/cli). È open source con prezzi trasparenti. Puoi scegliere tra oltre 500 modelli, passare da uno all'altro durante un'attività e pagare la tariffa del provider del modello senza ricarichi. Non servono chiavi API per iniziare.

### Installazione

Scegli dove vuoi eseguire Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installa direttamente l'[estensione Kilo Code](vscode:extension/kilocode.kilo-code), oppure scaricala dal [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Crea un account e avrai accesso a oltre 500 modelli, inclusi GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 e Gemini 3.1 Pro Preview, tutti al prezzo del provider.

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

Poi esegui `kilo` in qualsiasi directory di progetto per iniziare.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installa il [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) dal JetBrains Marketplace, oppure cerca "Kilo Code" in `Settings → Plugins` dentro qualsiasi IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Esegui Kilo dal web, senza una macchina locale, su [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Revisioni del codice</strong></summary>

<br>

Configura revisioni automatiche del codice con IA sulle tue pull request su [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Avvia il tuo agente IA sempre attivo su [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Installare la CLI da GitHub Releases (binari)</summary>

Scarica il binario più recente dalla [pagina Releases](https://github.com/Kilo-Org/kilocode/releases).

| Piattaforma | Asset |
|---|---|
| Windows (la maggior parte dei PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Note: `x64-baseline` è una build di compatibilità per CPU più vecchie senza AVX. `musl` è la build collegata staticamente per Alpine o immagini Docker minimali senza glibc. `kilo-vscode-*.vsix` è il pacchetto dell'estensione VS Code, non la CLI. Gli archivi `Source code` servono per compilare dai sorgenti.

</details>

### Agents

Kilo include agents specializzati tra cui puoi passare in base all'attività. Puoi anche creare agents personalizzati.

- **Code** - Predefinito. Implementa e modifica codice da linguaggio naturale.
- **Plan** - Progetta l'architettura e scrive piani di implementazione prima che venga scritto codice.
- **Ask** - Risponde a domande sulla tua codebase senza modificare file.
- **Debug** - Risolve e traccia problemi.
- **Review** - Revisiona le modifiche e segnala problemi di performance, sicurezza, stile e copertura dei test.

Scopri di più su [agents e agents personalizzati](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Cosa fa

- **Generazione di codice** da linguaggio naturale, su più file.
- **Autocompletamento inline** con suggerimenti ghost-text e Tab per accettare.
- **Autoverifica** così l'agente rivede e corregge il proprio lavoro.
- **Controllo di terminale e browser** per eseguire comandi e automatizzare il web.
- **Marketplace MCP** per trovare e collegare server MCP che estendono ciò che l'agente può fare.
- **Oltre 500 modelli** con cambio durante l'attività, per adattare latenza, costo e ragionamento al lavoro.

### Modalità autonoma (CI/CD)

Esegui `kilo run` con `--auto` per un funzionamento completamente autonomo senza prompt, pensato per pipeline CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` disabilita tutti i prompt di autorizzazione e consente all'agente di eseguire qualsiasi azione senza conferma. Usalo solo in ambienti attendibili.

### Documentazione

Per configurazione e tutto il resto, consulta la [documentazione](https://kilo.ai/docs).

### Contribuire

Sono benvenuti contributi da sviluppatori, autori e chiunque altro. Inizia dalla [Guida al contributo](/CONTRIBUTING.md) per configurazione dell'ambiente, standard di codice e apertura di una pull request. Consulta [RELEASING.md](../RELEASING.md) per il processo di rilascio dell'estensione VS Code e della CLI, e [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) per il plugin JetBrains.

Leggi il nostro [Codice di condotta](/CODE_OF_CONDUCT.md) prima di partecipare.

### Licenza

MIT. Puoi usare, modificare e distribuire questo codice, anche commercialmente, purché mantieni le note di attribuzione e licenza. Vedi [License](/LICENSE).

### FAQ

<details>
<summary>Da dove viene Kilo CLI?</summary>

Kilo CLI è un fork di [OpenCode](https://github.com/anomalyco/opencode), migliorato per funzionare nella piattaforma di ingegneria agentica Kilo.

</details>

---

**Unisciti alla community** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
