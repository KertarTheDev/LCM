<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | Українська | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Спробуйте передрелізну версію LCM

Ця експериментальна збірка Kilo Code допомагає не втрачати нитку в довгих чатах: старий уже використаний контекст перетворюється на дерево підсумків із пошуком. Останні повідомлення лишаються без змін, а агент за потреби може відновити попередні подробиці.

> [!IMPORTANT]
> Збірки з LCM поширюються лише через GitHub Releases цього репозиторію. Marketplace, Open VSX, npm, Homebrew, AUR, хмарні сервіси та JetBrains встановлюють офіційну версію Kilo Code без LCM.

[Хочете зрозуміти ідею? Прочитайте оригінальну статтю LCM Клінта Ерліха й Теодора Блекмана.](https://arxiv.org/abs/2605.04050)

**Поточна версія:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Виберіть завантаження

Для VS Code або VSCodium виберіть VSIX, для термінала — архів CLI. Можна встановити обидва.

#### Визначте систему

У Windows відкрийте Settings → System → About → System type, у macOS — Apple menu → About This Mac, у Linux виконайте uname -m. x86_64 або amd64 означає x64, arm64 або aarch64 — ARM64.

Більшість настільних дистрибутивів Linux використовує glibc, а Alpine і невеликі контейнери — musl. Варіант baseline потрібен лише для старого процесора x64 або коли звичайний CLI завершується з помилкою illegal instruction. Окремого VSIX у варіанті baseline немає.

#### VS Code / VSCodium

Потрібен VS Code або VSCodium 1.105.1 чи новіший. VSIX використовує звичайний ID розширення Kilo Code, тому замінює встановлену Marketplace-версію.

|Система|Файл|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Завантажте відповідний файл, вимкніть автоматичне оновлення Kilo Code і виберіть Extensions → … → Install from VSIX. Потім перезавантажте вікно. Можна також скористатися командами нижче.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Завантажте один архів із таблиці. Повністю розпакуйте його в окрему папку й залиште всі службові файли поруч із програмою.

|Система|Файл|
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

Запустіть розпакований файл до додавання папки в PATH. Якщо пізніше запускається інший Kilo, перевірте шляхи командами нижче й поставте папку LCM раніше в PATH.

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

### Налаштуйте Kilo й LCM

Спершу під'єднайте звичного провайдера й виберіть модель. Conversation Memory увімкнена за замовчуванням. Перевірте це в Settings → Experimental, а потім відкрийте Settings → Context; початковий поріг становить 40%. Для власних моделей потрібні додатні ліміти контексту й виводу, а ліміт вводу можна не вказувати.

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

Коли LCM увімкнено, compaction.auto керує лише старою системою стиснення Kilo й не вимикає LCM.

#### Ollama

Для Ollama вкажіть справжню адресу сервера: зазвичай localhost:11434 на тому ж комп'ютері або його LAN-адресу з іншого пристрою. Ollama має слухати цю адресу, firewall — дозволяти доступ, а num_ctx моделі має бути не меншим за ліміт контексту в Kilo.

### Перевірте роботу

Почніть чат, виберіть провайдера й модель і виконайте /lcm status. Стан має бути enabled, а місткість — визначена. Заголовок завдання або сторінка Context покаже використання контексту й роботу LCM. /compact запускає один ручний цикл; у короткому новому чаті поки може не бути чого підсумовувати.

### Корисні поради

Для створення підсумків викликається модель, тому можуть трохи зрости затримка й вартість. Почніть із 40%; зменште значення для ранішої обробки або збільште, щоб скоротити кількість викликів. Пам'ять LCM належить лише поточному чату. Експорт контексту може містити конфіденційні промпти й вивід інструментів.

#### Швидкі рішення

За lcm_capacity_unknown заповніть ліміти контексту й виводу вибраної власної моделі. Якщо після перезапуску розширення замінилося, вимкніть auto-update і знову встановіть VSIX. За неправильного CLI перевірте which -a kilo або where.exe kilo. Для Alpine беріть musl, для старого x64 — baseline.

#### Оновлення або відкат

Для оновлення встановіть новий VSIX поверх старого або замініть розпаковану папку CLI. Чати лишаться в SQLite Kilo. Для швидкого відкату задайте experimental.conversation_memory значення false; також можна повернути офіційну версію Kilo Code або старішу передрелізну версію.

> [!NOTE]
> Решта сторінки описує офіційну версію Kilo Code. Звичайні посилання встановлення нижче не встановлюють цю версію з LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source-агент для програмування з AI у VS Code, JetBrains або CLI.</p>

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

Kilo Code — це AI-агент для програмування, який працює там, де працюєте ви: у [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) і [CLI](https://kilo.ai/cli). Він має відкритий код і відкриту модель ціноутворення. Ви обираєте з понад 500 моделей, перемикаєтеся між ними під час завдання і платите тариф постачальника моделі без націнки. Для старту API-ключі не потрібні.

### Встановлення

Оберіть, де ви хочете запускати Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Встановіть [розширення Kilo Code](vscode:extension/kilocode.kilo-code) напряму або завантажте його з [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Створіть обліковий запис і отримайте доступ до понад 500 моделей, зокрема GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 і Gemini 3.1 Pro Preview, усі за цінами постачальників.

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

Потім запустіть `kilo` у будь-якому каталозі проєкту.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Встановіть [плагін Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) з JetBrains Marketplace або знайдіть "Kilo Code" у `Settings → Plugins` у будь-якій JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Запускайте Kilo з вебу, без локальної машини, на [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Налаштуйте автоматичні AI-рев'ю коду для ваших pull request на [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Запустіть свого постійно активного AI-агента на [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Встановити CLI з GitHub Releases (бінарні файли)</summary>

Завантажте найновіший бінарний файл зі [сторінки Releases](https://github.com/Kilo-Org/kilocode/releases).

| Платформа | Файл |
|---|---|
| Windows (більшість ПК) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Примітки: `x64-baseline` — сумісна збірка для старих CPU без AVX. `musl` — статично зв'язана збірка для Alpine або мінімальних Docker-образів без glibc. `kilo-vscode-*.vsix` — пакет розширення VS Code, а не CLI. Архіви `Source code` призначені для збірки з вихідного коду.

</details>

### Agents

Kilo постачається зі спеціалізованими agents, між якими можна перемикатися залежно від завдання. Ви також можете створювати власні agents.

- **Code** - Типовий. Реалізує та редагує код з природної мови.
- **Plan** - Проєктує архітектуру і пише плани реалізації до написання коду.
- **Ask** - Відповідає на запитання про кодову базу, не змінюючи файли.
- **Debug** - Діагностує та відстежує проблеми.
- **Review** - Переглядає ваші зміни та виявляє проблеми продуктивності, безпеки, стилю і покриття тестами.

Дізнайтеся більше про [agents і власні agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Що він робить

- **Генерація коду** з природної мови в кількох файлах.
- **Вбудоване автодоповнення** з ghost-text-підказками та прийняттям через Tab.
- **Самоперевірка**, щоб агент перевіряв і виправляв власну роботу.
- **Керування терміналом і браузером** для запуску команд і автоматизації вебу.
- **MCP marketplace** для пошуку й підключення MCP-серверів, які розширюють можливості агента.
- **Понад 500 моделей** з перемиканням під час завдання, щоб узгодити затримку, вартість і reasoning з роботою.

### Автономний режим (CI/CD)

Запустіть `kilo run` з `--auto` для повністю автономної роботи без prompts, створеної для CI/CD-пайплайнів:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` вимикає всі запити дозволів і дає агенту змогу виконувати будь-яку дію без підтвердження. Використовуйте лише в довірених середовищах.

### Документація

Для налаштування та всього іншого перегляньте [документацію](https://kilo.ai/docs).

### Участь

Ми вітаємо внески від розробників, авторів і всіх охочих. Почніть з [Contributing Guide](/CONTRIBUTING.md), щоб налаштувати середовище, ознайомитися зі стандартами коду та дізнатися, як відкрити pull request. Див. [RELEASING.md](../RELEASING.md) для процесу релізу розширення VS Code і CLI, а також [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) для плагіна JetBrains.

Перед участю прочитайте наш [Code of Conduct](/CODE_OF_CONDUCT.md).

### Ліцензія

MIT. Ви можете використовувати, змінювати й поширювати цей код, зокрема комерційно, якщо зберігаєте зазначення авторства та ліцензійні повідомлення. Див. [License](/LICENSE).

### FAQ

<details>
<summary>Звідки взявся Kilo CLI?</summary>

Kilo CLI — це fork [OpenCode](https://github.com/anomalyco/opencode), розширений для роботи в платформі agentic engineering Kilo.

</details>

---

**Долучайтеся до спільноти** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
