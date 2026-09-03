<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | العربية | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<div dir="rtl">

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## جرّب إصدار LCM التجريبي

يساعد هذا الإصدار التجريبي من Kilo Code على إبقاء المحادثات الطويلة مفيدة، إذ يحوّل السياق الأقدم الذي استُخدم بالفعل إلى شجرة ملخصات قابلة للبحث. يبقى عملك الحديث كما هو، ويمكن للوكيل استرجاع التفاصيل القديمة عند الحاجة.

> [!IMPORTANT]
> تتوفر نسخة LCM فقط ضمن GitHub Releases في هذا المستودع. أما التثبيت عبر Marketplace أو Open VSX أو npm أو Homebrew أو AUR أو السحابة أو JetBrains فيعطيك النسخة الرسمية من Kilo Code من دون LCM.

[هل تريد معرفة الفكرة؟ اقرأ ورقة LCM الأصلية لكلينت إرليخ وثيودور بلاكمان.](https://arxiv.org/abs/2605.04050)

**الإصدار التجريبي الحالي:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### اختر ما ستنزله

إذا كنت تستخدم VS Code أو VSCodium فحمّل ملف VSIX. وإذا كنت تفضّل الطرفية فحمّل أرشيف CLI. ويمكنك تثبيت الاثنين معاً.

#### اعرف نظامك

في Windows افتح Settings → System → About → System type، وفي macOS افتح Apple menu → About This Mac، وفي Linux شغّل uname -m. تعني x86_64 أو amd64 بنية x64، وتعني arm64 أو aarch64 بنية ARM64.

تستخدم أغلب توزيعات Linux المكتبية glibc، بينما يستخدم Alpine وبعض الحاويات الصغيرة musl. اختر baseline فقط لمعالج x64 قديم أو إذا توقف CLI العادي بخطأ illegal instruction؛ ولا يوجد VSIX منفصل من نوع baseline.

#### VS Code / VSCodium

تحتاج إلى VS Code أو VSCodium بالإصدار 1.105.1 أو أحدث. يستخدم VSIX معرّف إضافة Kilo Code العادي، لذلك سيستبدل نسخة Marketplace المثبتة.

|النظام|الملف|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

نزّل الملف المناسب، وأوقف التحديث التلقائي لإضافة Kilo Code، ثم اختر Extensions → … → Install from VSIX. أعد تحميل النافذة بعد التثبيت. ويمكنك استخدام أحد الأوامر أدناه.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

نزّل أرشيفاً واحداً من الجدول. فك الأرشيف كاملاً في مجلد مستقل، واترك كل ملفات الدعم المستخرجة بجانب الملف التنفيذي.

|النظام|الملف|
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

شغّل الملف التنفيذي المستخرج مرة قبل إضافة مجلده إلى PATH. إذا اشتغلت نسخة Kilo أخرى لاحقاً، استخدم أوامر فحص المسار أدناه وضع مجلد LCM أولاً في PATH.

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

### إعداد Kilo وLCM

اربط مزوّد النماذج الذي تستخدمه عادةً واختر نموذجاً. تعمل Conversation Memory تلقائياً. في الإضافة، راجع Settings → Experimental، ثم افتح Settings → Context لضبط حد البدء الافتراضي، وهو 60%. مع النماذج المخصصة يجب إدخال حد موجب للسياق وحد موجب للمخرجات؛ أما حد الإدخال فاختياري.

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

يتحكم compaction.auto فقط في نظام الضغط القديم في Kilo أثناء تفعيل LCM، ولا يوقف LCM.

#### Ollama

مع Ollama استخدم عنوان الخادم الحقيقي: غالباً localhost:11434 على الجهاز نفسه أو عنوان LAN للجهاز من جهاز آخر. تأكد أن Ollama يستمع إلى العنوان، وأن الجدار الناري يسمح به، وأن num_ctx للنموذج لا يقل عن حد السياق المسجل في Kilo.

### تأكد أنه يعمل

ابدأ محادثة، واختر المزوّد والنموذج، ثم شغّل /lcm status. تأكد من أن الحالة enabled وأن السعة معروفة. يعرض رأس المهمة أو صفحة Context نسبة الاستخدام ونشاط LCM. يطلب /compact دورة LCM يدوية واحدة؛ وقد لا تجد محادثة قصيرة وحديثة شيئاً يستحق التلخيص.

### نصائح مفيدة

يستخدم التلخيص استدعاءات للنموذج، لذلك قد يضيف قليلاً من التأخير والتكلفة. ابدأ بـ60%؛ اخفضها للصيانة المبكرة أو ارفعها لتقليل الاستدعاءات. ذاكرة LCM تخص المحادثة الحالية. قد يحتوي تصدير السياق على مطالبات ومخرجات أدوات حساسة، فتعامل معه مثل المحادثة.

#### حلول سريعة

إذا ظهر lcm_capacity_unknown فأدخل حدود السياق والمخرجات للنموذج المخصص المحدد. إذا عادت الإضافة إلى نسخة أخرى بعد إعادة التشغيل، أوقف التحديث التلقائي وأعد تثبيت VSIX. إذا كان إصدار CLI خاطئاً، افحص which -a kilo أو where.exe kilo. استخدم musl على Alpine وجرّب baseline لمعالج x64 قديم.

#### التحديث أو الرجوع

للتحديث ثبّت VSIX الأحدث فوق القديم أو استبدل مجلد CLI المستخرج. تبقى محادثاتك في قاعدة Kilo SQLite. للرجوع سريعاً اضبط experimental.conversation_memory على false؛ ويمكنك أيضاً إعادة تثبيت Kilo Code الأصلي أو إصدار تجريبي أقدم.

> [!NOTE]
> يتناول باقي هذه الصفحة النسخة الرسمية من Kilo Code. روابط التثبيت المعتادة أدناه لا تثبّت نسخة LCM هذه.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">وكيل برمجة مفتوح المصدر للبناء باستخدام الذكاء الاصطناعي في VS Code أو JetBrains أو CLI.</p>

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

Kilo Code هو وكيل برمجة بالذكاء الاصطناعي يعمل معك أينما تعمل: [VS Code](https://kilo.ai/landing/vs-code) و[JetBrains](https://kilo.ai/features/jetbrains-native) و[CLI](https://kilo.ai/cli). إنه مفتوح المصدر وبتسعير مفتوح. يمكنك الاختيار من بين أكثر من 500 نموذج، والتبديل بينها أثناء المهمة، ودفع سعر مزود النموذج من دون أي هامش إضافي. لا تحتاج إلى مفاتيح API للبدء.

### التثبيت

اختر المكان الذي تريد تشغيل Kilo فيه.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

ثبّت [إضافة Kilo Code](vscode:extension/kilocode.kilo-code) مباشرة، أو احصل عليها من [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). أنشئ حسابًا وستحصل على إمكانية الوصول إلى أكثر من 500 نموذج، بما في ذلك GPT-5.5 وClaude Opus 4.7 وClaude Sonnet 4.6 وGemini 3.1 Pro Preview، كلها بسعر المزود.

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

بعد ذلك شغّل `kilo` في أي مجلد مشروع للبدء.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

ثبّت [إضافة Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) من JetBrains Marketplace، أو ابحث عن "Kilo Code" في `Settings → Plugins` داخل أي JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

شغّل Kilo من الويب، من دون جهاز محلي، على [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>مراجعات الكود</strong></summary>

<br>

أعدّ مراجعات كود آلية بالذكاء الاصطناعي لطلبات السحب الخاصة بك على [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

شغّل وكيل الذكاء الاصطناعي الدائم لديك على [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>تثبيت CLI من GitHub Releases (ملفات ثنائية)</summary>

نزّل أحدث ملف ثنائي من [صفحة Releases](https://github.com/Kilo-Org/kilocode/releases).

| المنصة | الملف |
|---|---|
| Windows (معظم أجهزة PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

ملاحظات: `x64-baseline` هو بناء توافق للمعالجات القديمة التي لا تدعم AVX. `musl` هو البناء المرتبط ثابتًا لـ Alpine أو صور Docker البسيطة من دون glibc. `kilo-vscode-*.vsix` هو حزمة إضافة VS Code وليس CLI. أرشيفات `Source code` مخصصة للبناء من المصدر.

</details>

### Agents

يأتي Kilo مع agents متخصصة يمكنك التبديل بينها حسب المهمة. يمكنك أيضًا إنشاء agents مخصصة خاصة بك.

- **Code** - الافتراضي. ينفذ الكود ويعدّله من اللغة الطبيعية.
- **Plan** - يصمم البنية ويكتب خطط التنفيذ قبل كتابة أي كود.
- **Ask** - يجيب عن الأسئلة حول قاعدة الكود من دون تعديل الملفات.
- **Debug** - يستكشف المشكلات ويتتبعها.
- **Review** - يراجع تغييراتك ويكشف مشكلات الأداء والأمان والأسلوب وتغطية الاختبارات.

تعرّف أكثر على [agents وagents المخصصة](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### ما الذي يفعله

- **توليد الكود** من اللغة الطبيعية عبر ملفات متعددة.
- **إكمال تلقائي داخل السطر** مع اقتراحات ghost-text والضغط على Tab للقبول.
- **فحص ذاتي** لكي يراجع الوكيل عمله ويصححه.
- **تحكم في الطرفية والمتصفح** لتشغيل الأوامر وأتمتة الويب.
- **سوق MCP** للعثور على خوادم MCP وربطها لتوسيع قدرات الوكيل.
- **أكثر من 500 نموذج** مع التبديل أثناء المهمة، لتطابق زمن الاستجابة والتكلفة والاستدلال مع العمل.

### الوضع المستقل (CI/CD)

شغّل `kilo run` مع `--auto` للعمل بشكل مستقل بالكامل ومن دون prompts، وهو مصمم لخطوط CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

يعطّل `--auto` كل مطالبات الأذونات ويسمح للوكيل بتنفيذ أي إجراء من دون تأكيد. استخدمه فقط في بيئات موثوقة.

### التوثيق

لإعدادات التكوين وكل ما عدا ذلك، راجع [التوثيق](https://kilo.ai/docs).

### المساهمة

نرحب بمساهمات المطورين والكتّاب والجميع. ابدأ بـ [Contributing Guide](/CONTRIBUTING.md) لإعداد البيئة ومعايير الكود وكيفية فتح pull request. راجع [RELEASING.md](../RELEASING.md) لعملية إصدار إضافة VS Code وCLI، و[packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) لإضافة JetBrains.

يرجى قراءة [Code of Conduct](/CODE_OF_CONDUCT.md) قبل المشاركة.

### الترخيص

MIT. يمكنك استخدام هذا الكود وتعديله وتوزيعه، بما في ذلك تجاريًا، ما دمت تحتفظ بإشعارات النسبة والترخيص. راجع [License](/LICENSE).

### FAQ

<details>
<summary>من أين جاء Kilo CLI؟</summary>

Kilo CLI هو fork من [OpenCode](https://github.com/anomalyco/opencode)، وتم تحسينه للعمل داخل منصة Kilo agentic engineering.

</details>

---

**انضم إلى المجتمع** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)

</div>
