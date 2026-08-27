<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | Bosanski | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Isprobajte LCM predizdanje

Ova eksperimentalna verzija Kilo Codea održava duge razgovore korisnim tako što stariji, već iskorišteni kontekst pretvara u pretraživo stablo sažetaka. Nedavni rad ostaje tačan, a agent može vratiti starije detalje kada zatrebaju.

> [!IMPORTANT]
> LCM verzije dostupne su samo u GitHub Releases ovog repozitorija. Instalacije preko Marketplacea, Open VSX-a, npm-a, Homebrewa, AUR-a, clouda ili JetBrainsa daju službenu verziju Kilo Codea bez LCM-a.

[Želite pozadinu ideje? Pročitajte originalni LCM rad Clinta Ehrlicha i Theodorea Blackmana.](https://arxiv.org/abs/2605.04050)

**Trenutno predizdanje:** [`v7.4.23-lcm.12`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.12)

### Izaberite preuzimanje

Izaberite VSIX za VS Code ili VSCodium, a CLI arhivu za terminal. Možete instalirati oba.

#### Provjerite sistem

Na Windowsu otvorite Settings → System → About → System type; na macOS-u Apple menu → About This Mac; na Linuxu pokrenite uname -m. x86_64 ili amd64 znači x64, a arm64 ili aarch64 znači ARM64.

Većina Linux desktopa koristi glibc; Alpine i mali kontejneri koriste musl. baseline birajte samo za stari x64 CPU ili ako obični CLI završi s illegal instruction; poseban baseline VSIX ne postoji.

#### VS Code / VSCodium

Potreban je VS Code ili VSCodium 1.105.1 ili noviji. VSIX koristi isti ID kao obični Kilo Code, pa zamjenjuje Marketplace instalaciju.

|Sistem|Fajl|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Preuzmite odgovarajući fajl, isključite automatsko ažuriranje za Kilo Code i odaberite Extensions → … → Install from VSIX. Zatim ponovo učitajte prozor. Možete koristiti i naredbe ispod.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Preuzmite jednu arhivu iz tabele. Raspakujte cijelu arhivu u zaseban folder i ostavite sve pomoćne fajlove uz izvršni fajl.

|Sistem|Fajl|
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

Pokrenite raspakovani program prije dodavanja foldera u PATH. Ako se kasnije pokrene drugi Kilo, provjerite putanje ispod i stavite LCM folder ranije u PATH.

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

### Podesite Kilo i LCM

Prvo povežite pružaoca kojeg inače koristite i izaberite model. Conversation Memory je uključena prema zadanim postavkama. U ekstenziji to provjerite pod Settings → Experimental, a zatim otvorite Settings → Context; početni prag je 40%. Prilagođeni modeli moraju imati pozitivne limite konteksta i izlaza, dok je limit ulaza neobavezan.

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

Dok je LCM uključen, compaction.auto upravlja samo starim Kilo sistemom sažimanja; ne isključuje LCM.

#### Ollama

Za Ollama koristite stvarnu adresu servera—obično localhost:11434 na istom računaru ili LAN adresu računara s drugog uređaja. Ollama mora slušati na toj adresi, firewall je mora propustiti, a num_ctx mora biti barem jednak limitu konteksta u Kilou.

### Provjerite rad

Pokrenite razgovor, izaberite pružaoca i model te unesite /lcm status. Status treba biti enabled, a kapacitet poznat. Zaglavlje zadatka ili stranica Context prikazuje iskorištenost i aktivnost LCM-a. /compact pokreće jedan ručni LCM ciklus; u kratkom novom razgovoru možda još nema šta sažeti.

### Korisni savjeti

Sažeci koriste pozive modelu pa mogu dodati malo vremena i troška. Počnite sa 40%; smanjite za ranije održavanje ili povećajte za manje poziva. LCM memorija pripada trenutnom razgovoru. Izvoz konteksta može sadržati osjetljive upite i izlaz alata.

#### Brza rješenja

Ako vidite lcm_capacity_unknown, unesite limite konteksta i izlaza izabranog prilagođenog modela. Ako se ekstenzija vrati nakon restarta, isključite auto-update i ponovo instalirajte VSIX. Za pogrešan CLI provjerite which -a kilo ili where.exe kilo. Na Alpineu koristite musl, a na starom x64 CPU-u baseline.

#### Nadogradnja ili vraćanje

Za nadogradnju instalirajte novi VSIX preko starog ili zamijenite raspakovani CLI folder. Razgovori ostaju u Kilo SQLite bazi. Za brzo vraćanje postavite experimental.conversation_memory na false ili instalirajte službenu verziju Kilo Codea ili starije predizdanje.

> [!NOTE]
> Ostatak stranice opisuje službenu verziju Kilo Codea. Uobičajeni linkovi za instalaciju ispod ne instaliraju ovu LCM verziju.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source agent za kodiranje s AI-jem u VS Codeu, JetBrainsu ili CLI-ju.</p>

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

Kilo Code je AI agent za kodiranje koji vas prati svugdje gdje radite: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) i [CLI](https://kilo.ai/cli). Open source je i ima otvorene cijene. Birate između više od 500 modela, mijenjate ih usred zadatka i plaćate cijenu pružaoca modela bez dodatne marže. API ključevi nisu potrebni za početak.

### Instalacija

Odaberite gdje želite pokrenuti Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Instalirajte [Kilo Code ekstenziju](vscode:extension/kilocode.kilo-code) direktno ili je preuzmite sa [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Kreirajte račun i imat ćete pristup za više od 500 modela, uključujući GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 i Gemini 3.1 Pro Preview, sve po cijenama pružaoca.

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

Zatim pokrenite `kilo` u bilo kojem direktoriju projekta.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Instalirajte [Kilo Code plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) sa JetBrains Marketplacea ili potražite "Kilo Code" u `Settings → Plugins` unutar bilo kojeg JetBrains IDE-a.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Pokrenite Kilo s weba, bez lokalne mašine, na [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Pregledi koda</strong></summary>

<br>

Postavite automatske AI preglede koda na svojim pull requestovima na [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Pokrenite svog uvijek aktivnog AI agenta na [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Instalirajte CLI iz GitHub Releases (binarne datoteke)</summary>

Preuzmite najnoviju binarnu datoteku sa [Releases stranice](https://github.com/Kilo-Org/kilocode/releases).

| Platforma | Asset |
|---|---|
| Windows (većina PC računara) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Napomene: `x64-baseline` je kompatibilna verzija za starije CPU-e bez AVX-a. `musl` je statički linkovana verzija za Alpine ili minimalne Docker slike bez glibc-a. `kilo-vscode-*.vsix` je paket VS Code ekstenzije, ne CLI. `Source code` arhive služe za build iz izvornog koda.

</details>

### Agents

Kilo dolazi sa specijaliziranim agents koje mijenjate zavisno od zadatka. Možete napraviti i vlastite prilagođene agents.

- **Code** - Zadani. Implementira i uređuje kod iz prirodnog jezika.
- **Plan** - Dizajnira arhitekturu i piše implementacijske planove prije pisanja koda.
- **Ask** - Odgovara na pitanja o codebaseu bez mijenjanja datoteka.
- **Debug** - Rješava i prati probleme.
- **Review** - Pregleda vaše promjene i pronalazi probleme u performansama, sigurnosti, stilu i pokrivenosti testovima.

Saznajte više o [agents i prilagođenim agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Šta radi

- **Generisanje koda** iz prirodnog jezika, kroz više datoteka.
- **Inline autocomplete** sa ghost-text prijedlozima i Tab za prihvatanje.
- **Samoprovjera** kako bi agent pregledao i ispravio vlastiti rad.
- **Kontrola terminala i browsera** za pokretanje komandi i automatizaciju weba.
- **MCP marketplace** za pronalaženje i povezivanje MCP servera koji proširuju mogućnosti agenta.
- **Više od 500 modela** sa prebacivanjem usred zadatka, da uskladite latenciju, cijenu i rezonovanje s poslom.

### Autonomni način rada (CI/CD)

Pokrenite `kilo run` s `--auto` za potpuno autonoman rad bez promptova, napravljen za CI/CD pipelineove:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` isključuje sve upite za dozvole i dopušta agentu da izvrši bilo koju radnju bez potvrde. Koristite samo u pouzdanim okruženjima.

### Dokumentacija

Za konfiguraciju i sve ostalo posjetite [dokumentaciju](https://kilo.ai/docs).

### Doprinos

Doprinosi su dobrodošli od developera, pisaca i svih ostalih. Počnite sa [Contributing Guide](/CONTRIBUTING.md) za podešavanje okruženja, standarde kodiranja i otvaranje pull requesta. Pogledajte [RELEASING.md](../RELEASING.md) za proces izdavanja VS Code ekstenzije i CLI-ja, te [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) za JetBrains plugin.

Prije uključivanja pročitajte naš [Code of Conduct](/CODE_OF_CONDUCT.md).

### Licenca

MIT. Možete koristiti, mijenjati i distribuirati ovaj kod, uključujući komercijalno, dok god zadržite atribuciju i obavijesti o licenci. Pogledajte [License](/LICENSE).

### FAQ

<details>
<summary>Odakle dolazi Kilo CLI?</summary>

Kilo CLI je fork [OpenCode](https://github.com/anomalyco/opencode), poboljšan za rad unutar Kilo agentic engineering platforme.

</details>

---

**Pridružite se zajednici** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
