<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | Русский | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Попробуйте пререлиз LCM

Эта экспериментальная сборка Kilo Code помогает не терять нить в длинных чатах: старый уже использованный контекст превращается в дерево доступных для поиска сводок. Последние сообщения остаются без изменений, а агент при необходимости может восстановить прежние подробности.

> [!IMPORTANT]
> Сборки с LCM распространяются только через GitHub Releases этого репозитория. Marketplace, Open VSX, npm, Homebrew, AUR, облачные сервисы и JetBrains устанавливают официальную версию Kilo Code без LCM.

[Хотите понять идею? Прочитайте оригинальную статью LCM Клинта Эрлиха и Теодора Блэкмана.](https://arxiv.org/abs/2605.04050)

**Текущий пререлиз:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Выберите загрузку

Для VS Code или VSCodium выберите VSIX, для терминала — архив CLI. Можно установить оба варианта.

#### Определите систему

В Windows откройте Settings → System → About → System type, в macOS — Apple menu → About This Mac, в Linux выполните uname -m. x86_64 или amd64 означает x64, arm64 или aarch64 — ARM64.

Большинство настольных дистрибутивов Linux использует glibc, а Alpine и небольшие контейнеры — musl. Вариант baseline нужен только для старого процессора x64 или если обычный CLI завершается с ошибкой illegal instruction. Отдельного VSIX в варианте baseline нет.

#### VS Code / VSCodium

Нужен VS Code или VSCodium 1.105.1 или новее. VSIX использует обычный ID расширения Kilo Code, поэтому заменяет установленную сборку Marketplace.

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

Скачайте подходящий файл, отключите автообновление Kilo Code и выберите Extensions → … → Install from VSIX. После установки перезагрузите окно. Можно использовать и команды ниже.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Скачайте один архив из таблицы. Полностью распакуйте его в отдельную папку и оставьте все служебные файлы рядом с программой.

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

Запустите распакованный файл до добавления папки в PATH. Если позже запускается другой Kilo, проверьте пути командами ниже и поставьте папку LCM раньше в PATH.

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

### Настройте Kilo и LCM

Сначала подключите привычного провайдера и выберите модель. Conversation Memory включена по умолчанию. Проверьте это в Settings → Experimental, затем откройте Settings → Context; начальный порог составляет 40%. Для пользовательских моделей нужны положительные лимиты контекста и вывода, а лимит ввода можно не указывать.

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

При включённом LCM параметр compaction.auto управляет только старой системой сжатия Kilo и не отключает LCM.

#### Ollama

Для Ollama укажите настоящий адрес сервера: обычно localhost:11434 на том же компьютере или его LAN-адрес с другого устройства. Ollama должна слушать этот адрес, firewall — разрешать доступ, а num_ctx модели должен быть не меньше лимита контекста в Kilo.

### Проверьте работу

Начните чат, выберите провайдера и модель и выполните /lcm status. Статус должен быть enabled, а ёмкость — определена. Заголовок задачи или страница Context покажет использование контекста и работу LCM. /compact запускает один ручной цикл; в коротком новом чате пока может быть нечего сводить.

### Полезные советы

Для создания сводок вызывается модель, поэтому могут немного вырасти задержка и стоимость. Начните с 40%; уменьшите значение для более ранней обработки или увеличьте, чтобы сократить число вызовов. Память LCM относится только к текущему чату. Экспорт контекста может содержать конфиденциальные промпты и вывод инструментов.

#### Быстрые решения

Если появился lcm_capacity_unknown, заполните лимиты контекста и вывода выбранной пользовательской модели. Если после перезапуска расширение переключается на другую версию, отключите автообновление и снова установите VSIX. Если запускается не тот CLI, проверьте which -a kilo или where.exe kilo. Для Alpine берите musl, для старого x64 — baseline.

#### Обновление или откат

Для обновления установите новый VSIX поверх старого или замените распакованную папку CLI. Чаты останутся в SQLite Kilo. Для быстрого отката задайте experimental.conversation_memory значение false; также можно вернуть официальную версию Kilo Code или предыдущий пререлиз.

> [!NOTE]
> Остальная страница описывает официальную версию Kilo Code. Обычные ссылки установки ниже не устанавливают эту версию с LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source-агент для разработки с ИИ в VS Code, JetBrains или CLI.</p>

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

Kilo Code — это AI-агент для написания кода, который работает там, где работаете вы: в [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) и [CLI](https://kilo.ai/cli). Он имеет открытый исходный код и открытую модель ценообразования. Вы выбираете из более чем 500 моделей, переключаетесь между ними во время задачи и платите по тарифу поставщика модели без наценки. Для начала не нужны API-ключи.

### Установка

Выберите, где вы хотите запускать Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Установите [расширение Kilo Code](vscode:extension/kilocode.kilo-code) напрямую или скачайте его из [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Создайте аккаунт и получите доступ к более чем 500 моделям, включая GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 и Gemini 3.1 Pro Preview, все по ценам поставщиков.

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

Затем запустите `kilo` в любом каталоге проекта.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Установите [плагин Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) из JetBrains Marketplace или найдите "Kilo Code" в `Settings → Plugins` в любой IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Запускайте Kilo из веба без локальной машины на [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Настройте автоматические AI-ревью кода для ваших pull request на [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Запустите своего постоянно активного AI-агента на [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Установить CLI из GitHub Releases (бинарные файлы)</summary>

Скачайте последний бинарный файл со [страницы Releases](https://github.com/Kilo-Org/kilocode/releases).

| Платформа | Файл |
|---|---|
| Windows (большинство ПК) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Примечания: `x64-baseline` — совместимая сборка для старых CPU без AVX. `musl` — статически связанная сборка для Alpine или минимальных Docker-образов без glibc. `kilo-vscode-*.vsix` — пакет расширения VS Code, а не CLI. Архивы `Source code` предназначены для сборки из исходного кода.

</details>

### Agents

Kilo поставляется со специализированными agents, между которыми можно переключаться в зависимости от задачи. Вы также можете создавать собственные agents.

- **Code** - По умолчанию. Реализует и редактирует код по описанию на естественном языке.
- **Plan** - Проектирует архитектуру и пишет планы реализации до написания кода.
- **Ask** - Отвечает на вопросы о кодовой базе, не изменяя файлы.
- **Debug** - Диагностирует и отслеживает проблемы.
- **Review** - Проверяет ваши изменения и выявляет проблемы производительности, безопасности, стиля и покрытия тестами.

Подробнее об [agents и пользовательских agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Возможности

- **Генерация кода** из естественного языка в нескольких файлах.
- **Встроенное автодополнение** с ghost-text-подсказками и принятием по Tab.
- **Самопроверка**, чтобы агент проверял и исправлял собственную работу.
- **Управление терминалом и браузером** для запуска команд и автоматизации веба.
- **MCP marketplace** для поиска и подключения MCP-серверов, расширяющих возможности агента.
- **Более 500 моделей** с переключением во время задачи, чтобы подобрать задержку, стоимость и reasoning под работу.

### Автономный режим (CI/CD)

Запустите `kilo run` с `--auto` для полностью автономной работы без prompts, предназначенной для CI/CD-пайплайнов:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` отключает все запросы разрешений и позволяет агенту выполнять любые действия без подтверждения. Используйте только в доверенных средах.

### Документация

Для настройки и всего остального перейдите к [документации](https://kilo.ai/docs).

### Участие

Мы приветствуем вклад разработчиков, авторов и всех желающих. Начните с [Contributing Guide](/CONTRIBUTING.md), чтобы настроить окружение, изучить стандарты кода и узнать, как открыть pull request. См. [RELEASING.md](../RELEASING.md) для процесса релиза расширения VS Code и CLI, а также [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) для плагина JetBrains.

Перед участием ознакомьтесь с нашим [Code of Conduct](/CODE_OF_CONDUCT.md).

### Лицензия

MIT. Вы можете использовать, изменять и распространять этот код, в том числе коммерчески, если сохраняете указания авторства и лицензионные уведомления. См. [License](/LICENSE).

### FAQ

<details>
<summary>Откуда появился Kilo CLI?</summary>

Kilo CLI — это fork [OpenCode](https://github.com/anomalyco/opencode), расширенный для работы в платформе agentic engineering Kilo.

</details>

---

**Присоединяйтесь к сообществу** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
