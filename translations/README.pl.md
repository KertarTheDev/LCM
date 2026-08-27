<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | Polski | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Wypróbuj wersję przedpremierową LCM

Ta eksperymentalna wersja Kilo Code pozwala zachować ciągłość długich rozmów, zamieniając starszy, już wykorzystany kontekst w przeszukiwalne drzewo podsumowań. Ostatnie wiadomości pozostają bez zmian, a agent może w razie potrzeby odzyskać wcześniejsze szczegóły.

> [!IMPORTANT]
> Wersje z LCM są udostępniane wyłącznie w GitHub Releases tego repozytorium. Marketplace, Open VSX, npm, Homebrew, AUR, usługi chmurowe i JetBrains instalują oficjalną wersję Kilo Code bez LCM.

[Chcesz poznać pomysł? Przeczytaj oryginalną pracę LCM autorstwa Clinta Ehrlicha i Theodore'a Blackmana.](https://arxiv.org/abs/2605.04050)

**Bieżąca wersja:** [`v7.4.23-lcm.12`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.12)

### Wybierz plik

Wybierz VSIX dla VS Code lub VSCodium, a archiwum CLI do terminala. Możesz zainstalować oba.

#### Sprawdź system

W Windows sprawdź Settings → System → About → System type; w macOS Apple menu → About This Mac; w Linux uruchom uname -m. x86_64 lub amd64 oznacza x64, a arm64 lub aarch64 oznacza ARM64.

Większość desktopowych dystrybucji Linuksa używa glibc; Alpine i małe kontenery używają musl. Wariant baseline wybierz tylko dla starszego procesora x64 albo wtedy, gdy zwykłe CLI kończy pracę z błędem illegal instruction. Nie ma osobnego pliku VSIX w wariancie baseline.

#### VS Code / VSCodium

Potrzebujesz VS Code lub VSCodium 1.105.1 albo nowszego. VSIX używa zwykłego ID rozszerzenia Kilo Code, więc zastępuje zainstalowaną wersję Marketplace.

|System|Plik|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Pobierz właściwy plik, wyłącz automatyczną aktualizację Kilo Code i wybierz Extensions → … → Install from VSIX. Potem przeładuj okno. Możesz też użyć poleceń poniżej.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Pobierz jedno archiwum z tabeli. Rozpakuj całość do osobnego katalogu i trzymaj wszystkie pliki pomocnicze obok programu.

|System|Plik|
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

Uruchom rozpakowany program przed dodaniem katalogu do PATH. Jeśli później startuje inny Kilo, użyj kontroli ścieżek poniżej i ustaw katalog LCM wcześniej w PATH.

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

### Skonfiguruj Kilo i LCM

Najpierw podłącz używanego na co dzień dostawcę i wybierz model. Conversation Memory jest domyślnie włączona. Sprawdź to w Settings → Experimental, a następnie otwórz Settings → Context; próg początkowy wynosi 40%. Modele niestandardowe wymagają dodatnich limitów kontekstu i wyjścia, natomiast limit wejścia jest opcjonalny.

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

Gdy LCM jest włączone, compaction.auto steruje tylko starszym systemem kompaktowania Kilo; nie wyłącza LCM.

#### Ollama

Dla Ollama użyj prawdziwego adresu serwera—zwykle localhost:11434 na tym samym komputerze albo jego adresu LAN z innego urządzenia. Ollama musi nasłuchiwać pod tym adresem, firewall musi zezwalać, a num_ctx musi być co najmniej limitem kontekstu wpisanym w Kilo.

### Sprawdź działanie

Rozpocznij rozmowę, wybierz dostawcę i model, a następnie uruchom /lcm status. Stan powinien mieć wartość enabled, a pojemność powinna być rozpoznana. Nagłówek zadania lub strona Context pokazuje wykorzystanie i działanie LCM. /compact uruchamia jeden ręczny cykl; krótka nowa rozmowa może nie mieć jeszcze nic do podsumowania.

### Przydatne wskazówki

Podsumowania używają wywołań modelu, więc mogą dodać trochę czasu i kosztu. Zacznij od 40%; obniż dla wcześniejszej pracy lub podnieś dla mniejszej liczby wywołań. Pamięć LCM należy do bieżącej rozmowy. Eksport kontekstu może zawierać poufne prompty i wyniki narzędzi.

#### Szybkie rozwiązania

Przy lcm_capacity_unknown wpisz limity kontekstu i wyjścia wybranego modelu niestandardowego. Jeśli rozszerzenie wraca po restarcie, wyłącz auto-update i zainstaluj VSIX ponownie. Przy złym CLI użyj which -a kilo lub where.exe kilo. Na Alpine wybierz musl, na starym x64 baseline.

#### Aktualizacja lub powrót

Aby zaktualizować, zainstaluj nowy VSIX na starym lub wymień rozpakowany katalog CLI. Rozmowy pozostają w bazie SQLite Kilo. Aby szybko wrócić, ustaw experimental.conversation_memory na false; możesz też ponownie zainstalować oficjalną wersję Kilo Code lub starszą wersję przedpremierową.

> [!NOTE]
> Dalsza część strony opisuje oficjalną wersję Kilo Code. Zwykłe linki instalacyjne poniżej nie instalują tej wersji z LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source'owy agent kodujący do pracy z AI w VS Code, JetBrains lub CLI.</p>

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

Kilo Code to agent kodujący z AI, który działa wszędzie tam, gdzie pracujesz: w [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) i [CLI](https://kilo.ai/cli). Jest open source i ma otwarte ceny. Wybierasz spośród ponad 500 modeli, przełączasz się między nimi w trakcie zadania i płacisz stawkę dostawcy modelu bez narzutów. Do rozpoczęcia nie są wymagane klucze API.

### Instalacja

Wybierz, gdzie chcesz uruchomić Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Zainstaluj bezpośrednio [rozszerzenie Kilo Code](vscode:extension/kilocode.kilo-code) albo pobierz je z [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Utwórz konto, a otrzymasz dostęp do ponad 500 modeli, w tym GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 i Gemini 3.1 Pro Preview, wszystkie w cenach dostawców.

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

Następnie uruchom `kilo` w dowolnym katalogu projektu.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Zainstaluj [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) z JetBrains Marketplace albo wyszukaj "Kilo Code" w `Settings → Plugins` w dowolnym IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Uruchom Kilo z poziomu przeglądarki, bez lokalnej maszyny, na [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Przeglądy kodu</strong></summary>

<br>

Skonfiguruj automatyczne przeglądy kodu AI dla swoich pull requestów na [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Uruchom swojego zawsze aktywnego agenta AI na [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Zainstaluj CLI z GitHub Releases (pliki binarne)</summary>

Pobierz najnowszy plik binarny ze [strony Releases](https://github.com/Kilo-Org/kilocode/releases).

| Platforma | Zasób |
|---|---|
| Windows (większość PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Uwagi: `x64-baseline` to build zgodności dla starszych CPU bez AVX. `musl` to statycznie linkowany build dla Alpine lub minimalnych obrazów Docker bez glibc. `kilo-vscode-*.vsix` to pakiet rozszerzenia VS Code, nie CLI. Archiwa `Source code` służą do budowania ze źródeł.

</details>

### Agents

Kilo zawiera wyspecjalizowane agents, między którymi możesz przełączać się zależnie od zadania. Możesz też tworzyć własne niestandardowe agents.

- **Code** - Domyślny. Implementuje i edytuje kod z języka naturalnego.
- **Plan** - Projektuje architekturę i pisze plany implementacji przed napisaniem kodu.
- **Ask** - Odpowiada na pytania o bazę kodu bez modyfikowania plików.
- **Debug** - Diagnozuje i śledzi problemy.
- **Review** - Przegląda zmiany i wykrywa problemy z wydajnością, bezpieczeństwem, stylem i pokryciem testami.

Dowiedz się więcej o [agents i niestandardowych agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Co robi

- **Generowanie kodu** z języka naturalnego, w wielu plikach.
- **Autouzupełnianie inline** z sugestiami ghost-text i akceptacją przez Tab.
- **Samokontrola**, dzięki której agent sprawdza i poprawia własną pracę.
- **Sterowanie terminalem i przeglądarką** do uruchamiania poleceń i automatyzacji webu.
- **Marketplace MCP** do znajdowania i podłączania serwerów MCP rozszerzających możliwości agenta.
- **Ponad 500 modeli** z przełączaniem w trakcie zadania, aby dopasować opóźnienie, koszt i rozumowanie do pracy.

### Tryb autonomiczny (CI/CD)

Uruchom `kilo run` z `--auto`, aby działać w pełni autonomicznie bez promptów, z myślą o pipeline'ach CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` wyłącza wszystkie pytania o uprawnienia i pozwala agentowi wykonywać dowolne działania bez potwierdzenia. Używaj tylko w zaufanych środowiskach.

### Dokumentacja

Konfigurację i wszystko inne znajdziesz w [dokumentacji](https://kilo.ai/docs).

### Wkład

Zapraszamy do wkładu programistów, autorów i wszystkich innych. Zacznij od [Contributing Guide](/CONTRIBUTING.md), aby skonfigurować środowisko, poznać standardy kodowania i sposób otwierania pull requestów. Zobacz [RELEASING.md](../RELEASING.md) dla procesu wydawania rozszerzenia VS Code i CLI oraz [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) dla pluginu JetBrains.

Przed zaangażowaniem przeczytaj nasz [Code of Conduct](/CODE_OF_CONDUCT.md).

### Licencja

MIT. Możesz używać, modyfikować i dystrybuować ten kod, również komercyjnie, o ile zachowasz informacje o autorstwie i licencji. Zobacz [License](/LICENSE).

### FAQ

<details>
<summary>Skąd pochodzi Kilo CLI?</summary>

Kilo CLI jest forkiem [OpenCode](https://github.com/anomalyco/opencode), rozszerzonym do działania w platformie agentic engineering Kilo.

</details>

---

**Dołącz do społeczności** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
