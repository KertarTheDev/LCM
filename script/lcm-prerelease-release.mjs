#!/usr/bin/env node
// kilocode_change - new file

import { execFile as execFileCallback } from "node:child_process"
import { appendFile, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"

const execFile = promisify(execFileCallback)

export const LCM_PRERELEASE_ASSETS = [
  "kilo-linux-arm64.tar.gz",
  "kilo-linux-x64.tar.gz",
  "kilo-linux-x64-baseline.tar.gz",
  "kilo-linux-arm64-musl.tar.gz",
  "kilo-linux-x64-musl.tar.gz",
  "kilo-linux-x64-baseline-musl.tar.gz",
  "kilo-darwin-arm64.zip",
  "kilo-darwin-x64.zip",
  "kilo-darwin-x64-baseline.zip",
  "kilo-windows-arm64.zip",
  "kilo-windows-x64.zip",
  "kilo-windows-x64-baseline.zip",
  "kilo-vscode-linux-x64.vsix",
  "kilo-vscode-linux-arm64.vsix",
  "kilo-vscode-alpine-x64.vsix",
  "kilo-vscode-alpine-arm64.vsix",
  "kilo-vscode-darwin-x64.vsix",
  "kilo-vscode-darwin-arm64.vsix",
  "kilo-vscode-win32-x64.vsix",
  "kilo-vscode-win32-arm64.vsix",
]

export const LCM_PRERELEASE_TRANSLATIONS = [
  "translations/README.ar.md",
  "translations/README.bn.md",
  "translations/README.br.md",
  "translations/README.bs.md",
  "translations/README.da.md",
  "translations/README.de.md",
  "translations/README.es.md",
  "translations/README.fr.md",
  "translations/README.gr.md",
  "translations/README.it.md",
  "translations/README.ja.md",
  "translations/README.ko.md",
  "translations/README.no.md",
  "translations/README.pl.md",
  "translations/README.ru.md",
  "translations/README.th.md",
  "translations/README.tr.md",
  "translations/README.uk.md",
  "translations/README.vi.md",
  "translations/README.zh.md",
  "translations/README.zht.md",
]

export const LCM_ONBOARDING_START = "<!-- LCM_ONBOARDING_START -->"
export const LCM_ONBOARDING_END = "<!-- LCM_ONBOARDING_END -->"
export const LCM_PAPER_URL = "https://arxiv.org/abs/2605.04050"
export const LCM_RELEASES_URL = "https://github.com/KertarTheDev/LCM/releases"

export const LCM_PRERELEASE_OVERLAY_PATHS = new Set([
  ".github/workflows/publish.yml",
  "README.md",
  "RELEASING.md",
  "packages/opencode/script/build.ts",
  "script/lcm-prerelease-release.mjs",
  "script/lcm-prerelease-release.test.mjs",
  ...LCM_PRERELEASE_TRANSLATIONS,
])

const onboardingLocales = {
  en: {
    title: "Try the LCM prerelease",
    intro:
      "This experimental Kilo Code build keeps long chats useful by turning older, already-used context into a searchable summary tree. Your recent work stays exact, and the agent can recover older detail when it needs it.",
    warning:
      "Builds with LCM are available only from this repository's GitHub Releases. Marketplace, Open VSX, npm, Homebrew, AUR, cloud, and JetBrains install the official Kilo Code version without LCM.",
    paper: "Want the idea behind it? Read the original LCM paper by Clint Ehrlich and Theodore Blackman.",
    choose:
      "Choose a VSIX if you use VS Code or VSCodium. Choose a CLI archive if you work in a terminal. Installing both is fine.",
    system:
      "Check Windows in Settings → System → About → System type; check macOS in Apple menu → About This Mac; on Linux run uname -m. x86_64 or amd64 means x64, while arm64 or aarch64 means ARM64.",
    variants:
      "Most Linux desktops use glibc. Alpine and some tiny containers use musl. Pick baseline only for an older x64 CPU or if the normal CLI exits with an illegal-instruction error; there is no separate baseline VSIX.",
    vscode:
      "You need VS Code or VSCodium 1.105.1 or newer. The VSIX uses the normal Kilo Code extension ID, so it replaces an installed Marketplace build.",
    vscodeInstall:
      "Download the matching file, turn off auto-update for Kilo Code, then use Extensions → … → Install from VSIX. Reload the window after installation. You can also use one of the commands below.",
    cli: "Download one archive from the table. Extract the whole archive into its own folder and keep every extracted support file beside the executable.",
    cliInstall:
      "Run the extracted binary once before adding its folder to PATH. If a different Kilo starts later, use the path checks below and move the LCM folder earlier in PATH.",
    setup:
      "Connect your usual provider and select a model first. Conversation Memory is on by default. In the extension, open Settings → Experimental to confirm it, then Settings → Context for the 40% soft threshold. Custom models need positive context and output token limits; an input limit is optional.",
    ollama:
      "For Ollama, use the real server address—often localhost:11434 on the same machine or the computer's LAN address from another device. Make sure Ollama listens on that address, the firewall allows it, and the model's num_ctx is at least the context limit you enter in Kilo.",
    verify:
      "Start a chat, select your provider/model, and run /lcm status. Look for enabled status and known capacity. The task header or Context settings will show pressure and activity. /compact requests one manual LCM cycle; a short new chat may have nothing to summarize.",
    tips: "Summary work uses model calls, so it can add a little latency and provider cost. Start with 40%; lower it for earlier maintenance or raise it for fewer calls. LCM memory belongs to the current chat. Context export can contain sensitive prompts and tool output, so treat it like the conversation itself.",
    trouble:
      "If you see lcm_capacity_unknown, fill in the selected custom model's context and output limits. If the extension changes back after a restart, disable auto-update and reinstall the VSIX. If the CLI version is wrong, check which -a kilo or where.exe kilo. On Alpine use musl; on an older x64 CPU try baseline.",
    update:
      "For an update, install the newer VSIX over the old one or replace the extracted CLI folder. Your chats remain in Kilo's SQLite database. To roll back quickly, set experimental.conversation_memory to false; you can also reinstall the official Kilo Code version or an older prerelease.",
    upstream:
      "The rest of this page describes the official Kilo Code version. The normal installation links below do not install this version with LCM.",
  },
  ar: {
    title: "جرّب إصدار LCM التجريبي",
    intro:
      "يساعد هذا الإصدار التجريبي من Kilo Code على إبقاء المحادثات الطويلة مفيدة، إذ يحوّل السياق الأقدم الذي استُخدم بالفعل إلى شجرة ملخصات قابلة للبحث. يبقى عملك الحديث كما هو، ويمكن للوكيل استرجاع التفاصيل القديمة عند الحاجة.",
    warning:
      "تتوفر نسخة LCM فقط ضمن GitHub Releases في هذا المستودع. أما التثبيت عبر Marketplace أو Open VSX أو npm أو Homebrew أو AUR أو السحابة أو JetBrains فيعطيك النسخة الرسمية من Kilo Code من دون LCM.",
    paper: "هل تريد معرفة الفكرة؟ اقرأ ورقة LCM الأصلية لكلينت إرليخ وثيودور بلاكمان.",
    choose:
      "إذا كنت تستخدم VS Code أو VSCodium فحمّل ملف VSIX. وإذا كنت تفضّل الطرفية فحمّل أرشيف CLI. ويمكنك تثبيت الاثنين معاً.",
    system:
      "في Windows افتح Settings → System → About → System type، وفي macOS افتح Apple menu → About This Mac، وفي Linux شغّل uname -m. تعني x86_64 أو amd64 بنية x64، وتعني arm64 أو aarch64 بنية ARM64.",
    variants:
      "تستخدم أغلب توزيعات Linux المكتبية glibc، بينما يستخدم Alpine وبعض الحاويات الصغيرة musl. اختر baseline فقط لمعالج x64 قديم أو إذا توقف CLI العادي بخطأ illegal instruction؛ ولا يوجد VSIX منفصل من نوع baseline.",
    vscode:
      "تحتاج إلى VS Code أو VSCodium بالإصدار 1.105.1 أو أحدث. يستخدم VSIX معرّف إضافة Kilo Code العادي، لذلك سيستبدل نسخة Marketplace المثبتة.",
    vscodeInstall:
      "نزّل الملف المناسب، وأوقف التحديث التلقائي لإضافة Kilo Code، ثم اختر Extensions → … → Install from VSIX. أعد تحميل النافذة بعد التثبيت. ويمكنك استخدام أحد الأوامر أدناه.",
    cli: "نزّل أرشيفاً واحداً من الجدول. فك الأرشيف كاملاً في مجلد مستقل، واترك كل ملفات الدعم المستخرجة بجانب الملف التنفيذي.",
    cliInstall:
      "شغّل الملف التنفيذي المستخرج مرة قبل إضافة مجلده إلى PATH. إذا اشتغلت نسخة Kilo أخرى لاحقاً، استخدم أوامر فحص المسار أدناه وضع مجلد LCM أولاً في PATH.",
    setup:
      "اربط مزوّد النماذج الذي تستخدمه عادةً واختر نموذجاً. تعمل Conversation Memory تلقائياً. في الإضافة، راجع Settings → Experimental، ثم افتح Settings → Context لضبط حد البدء الافتراضي، وهو 40%. مع النماذج المخصصة يجب إدخال حد موجب للسياق وحد موجب للمخرجات؛ أما حد الإدخال فاختياري.",
    ollama:
      "مع Ollama استخدم عنوان الخادم الحقيقي: غالباً localhost:11434 على الجهاز نفسه أو عنوان LAN للجهاز من جهاز آخر. تأكد أن Ollama يستمع إلى العنوان، وأن الجدار الناري يسمح به، وأن num_ctx للنموذج لا يقل عن حد السياق المسجل في Kilo.",
    verify:
      "ابدأ محادثة، واختر المزوّد والنموذج، ثم شغّل /lcm status. تأكد من أن الحالة enabled وأن السعة معروفة. يعرض رأس المهمة أو صفحة Context نسبة الاستخدام ونشاط LCM. يطلب /compact دورة LCM يدوية واحدة؛ وقد لا تجد محادثة قصيرة وحديثة شيئاً يستحق التلخيص.",
    tips: "يستخدم التلخيص استدعاءات للنموذج، لذلك قد يضيف قليلاً من التأخير والتكلفة. ابدأ بـ40%؛ اخفضها للصيانة المبكرة أو ارفعها لتقليل الاستدعاءات. ذاكرة LCM تخص المحادثة الحالية. قد يحتوي تصدير السياق على مطالبات ومخرجات أدوات حساسة، فتعامل معه مثل المحادثة.",
    trouble:
      "إذا ظهر lcm_capacity_unknown فأدخل حدود السياق والمخرجات للنموذج المخصص المحدد. إذا عادت الإضافة إلى نسخة أخرى بعد إعادة التشغيل، أوقف التحديث التلقائي وأعد تثبيت VSIX. إذا كان إصدار CLI خاطئاً، افحص which -a kilo أو where.exe kilo. استخدم musl على Alpine وجرّب baseline لمعالج x64 قديم.",
    update:
      "للتحديث ثبّت VSIX الأحدث فوق القديم أو استبدل مجلد CLI المستخرج. تبقى محادثاتك في قاعدة Kilo SQLite. للرجوع سريعاً اضبط experimental.conversation_memory على false؛ ويمكنك أيضاً إعادة تثبيت Kilo Code الأصلي أو إصدار تجريبي أقدم.",
    upstream: "يتناول باقي هذه الصفحة النسخة الرسمية من Kilo Code. روابط التثبيت المعتادة أدناه لا تثبّت نسخة LCM هذه.",
  },
  bn: {
    title: "LCM প্রিরিলিজ ব্যবহার করে দেখুন",
    intro:
      "Kilo Code-এর এই পরীক্ষামূলক বিল্ড পুরোনো, ইতিমধ্যে ব্যবহৃত কনটেক্সটকে খোঁজা যায় এমন সারাংশ-ট্রিতে বদলে দীর্ঘ চ্যাটকে কাজে লাগার মতো রাখে। সাম্প্রতিক কাজ হুবহু থাকে, আর দরকার হলে এজেন্ট পুরোনো বিস্তারিত ফেরত আনতে পারে।",
    warning:
      "LCM-সহ build শুধু এই repository-র GitHub Releases পাতায় পাওয়া যায়। Marketplace, Open VSX, npm, Homebrew, AUR, cloud বা JetBrains থেকে install করলে Kilo Code-এর সাধারণ সংস্করণ পাবেন; তাতে LCM নেই।",
    paper: "ভাবনাটির উৎস জানতে Clint Ehrlich ও Theodore Blackman-এর মূল LCM পেপার পড়ুন।",
    choose:
      "VS Code বা VSCodium ব্যবহার করলে VSIX file নিন। terminal-এ কাজ করলে CLI archive নিন। চাইলে দুটিই install করতে পারেন।",
    system:
      "Windows-এ Settings → System → About → System type, macOS-এ Apple menu → About This Mac দেখুন; Linux-এ uname -m চালান। x86_64 বা amd64 মানে x64, আর arm64 বা aarch64 মানে ARM64।",
    variants:
      "বেশিরভাগ Linux ডেস্কটপ glibc ব্যবহার করে; Alpine ও কিছু ছোট container musl ব্যবহার করে। শুধু পুরোনো x64 CPU বা সাধারণ CLI-তে illegal instruction হলে baseline নিন; আলাদা baseline VSIX নেই।",
    vscode:
      "VS Code বা VSCodium 1.105.1 বা নতুন লাগবে। VSIX সাধারণ Kilo Code extension ID ব্যবহার করে, তাই ইনস্টল করা Marketplace বিল্ডটি বদলে যাবে।",
    vscodeInstall:
      "সঠিক ফাইল ডাউনলোড করুন, Kilo Code-এর auto-update বন্ধ করুন, তারপর Extensions → … → Install from VSIX ব্যবহার করুন। ইনস্টলের পর window reload করুন। নিচের command-ও ব্যবহার করতে পারেন।",
    cli: "টেবিল থেকে একটি archive নিন। পুরো archive আলাদা folder-এ extract করুন এবং সব support file executable-এর পাশেই রাখুন।",
    cliInstall:
      "folder-টি PATH-এ দেওয়ার আগে extracted binary একবার চালান। পরে অন্য Kilo চালু হলে নিচের path check ব্যবহার করে LCM folder-টি PATH-এ আগে রাখুন।",
    setup:
      "প্রথমে আপনার নিয়মিত provider যুক্ত করে একটি model বেছে নিন। Conversation Memory ডিফল্টভাবেই চালু থাকে। extension-এ Settings → Experimental থেকে সেটি যাচাই করুন, তারপর Settings → Context-এ 40% শুরুর সীমা দেখুন। custom model-এর context ও output token limit অবশ্যই ধনাত্মক হতে হবে; input limit দেওয়া ঐচ্ছিক।",
    ollama:
      "Ollama-র আসল server address দিন—একই machine-এ সাধারণত localhost:11434, অন্য device থেকে computer-এর LAN address। Ollama যেন সেই address-এ শোনে, firewall অনুমতি দেয় এবং model-এর num_ctx যেন Kilo-তে দেওয়া context limit-এর সমান বা বেশি হয়।",
    verify:
      "একটি chat খুলে provider ও model বেছে /lcm status চালান। status যেন enabled হয় এবং capacity জানা থাকে। task header বা Context settings-এ ব্যবহার ও LCM-এর কাজ দেখা যাবে। /compact একটি LCM cycle হাতে চালায়; ছোট নতুন chat-এ সংক্ষেপ করার মতো কিছু নাও থাকতে পারে।",
    tips: "Summary তৈরিতে model call লাগে, তাই সামান্য সময় ও provider cost বাড়তে পারে। 40% দিয়ে শুরু করুন; আগে maintenance চাইলে কমান, কম call চাইলে বাড়ান। LCM memory শুধু বর্তমান chat-এর। Context export-এ sensitive prompt বা tool output থাকতে পারে, তাই chat-এর মতোই নিরাপদ রাখুন।",
    trouble:
      "lcm_capacity_unknown দেখলে নির্বাচিত custom model-এর context ও output limit পূরণ করুন। Restart-এর পর extension বদলে গেলে auto-update বন্ধ করে VSIX আবার দিন। CLI version ভুল হলে which -a kilo বা where.exe kilo দেখুন। Alpine-এ musl এবং পুরোনো x64 CPU-তে baseline চেষ্টা করুন।",
    update:
      "Update করতে নতুন VSIX পুরোনোটির উপর install করুন বা extracted CLI folder বদলান। Chat Kilo SQLite database-এ থাকে। দ্রুত rollback করতে experimental.conversation_memory false করুন; চাইলে Kilo Code-এর সাধারণ সংস্করণ বা পুরোনো prerelease আবার install করুন।",
    upstream:
      "এই পৃষ্ঠার বাকি অংশ Kilo Code-এর সাধারণ সংস্করণ নিয়ে। নিচের নিয়মিত install link দিয়ে এই LCM prerelease install হবে না।",
  },
  br: {
    title: "Experimente a prévia do LCM",
    intro:
      "Esta versão experimental do Kilo Code mantém conversas longas úteis ao transformar contexto antigo já usado em uma árvore de resumos pesquisável. O trabalho recente continua exato, e o agente pode recuperar detalhes antigos quando precisar.",
    warning:
      "As versões com LCM estão disponíveis somente nos GitHub Releases deste repositório. Marketplace, Open VSX, npm, Homebrew, AUR, serviços em nuvem e JetBrains instalam a versão oficial do Kilo Code, sem LCM.",
    paper: "Quer entender a ideia? Leia o artigo original do LCM, de Clint Ehrlich e Theodore Blackman.",
    choose:
      "Use um VSIX no VS Code ou VSCodium. Use um arquivo CLI se trabalha no terminal. Você pode instalar os dois.",
    system:
      "No Windows, veja Settings → System → About → System type; no macOS, Apple menu → About This Mac; no Linux, rode uname -m. x86_64 ou amd64 significa x64; arm64 ou aarch64 significa ARM64.",
    variants:
      "A maioria das distribuições Linux para desktop usa glibc; o Alpine e alguns contêineres mínimos usam musl. Escolha baseline somente para processadores x64 antigos ou se a CLI normal encerrar com o erro illegal instruction. Não existe um VSIX baseline separado.",
    vscode:
      "É preciso VS Code ou VSCodium 1.105.1 ou mais novo. O VSIX usa o ID normal da extensão Kilo Code, então substitui uma instalação do Marketplace.",
    vscodeInstall:
      "Baixe o arquivo certo, desative a atualização automática do Kilo Code e use Extensions → … → Install from VSIX. Recarregue a janela depois. Você também pode usar um dos comandos abaixo.",
    cli: "Baixe um arquivo da tabela. Extraia tudo em uma pasta própria e mantenha todos os arquivos de suporte junto do executável.",
    cliInstall:
      "Rode o binário extraído antes de adicionar a pasta ao PATH. Se outra versão do Kilo abrir depois, use as verificações abaixo e coloque a pasta do LCM antes no PATH.",
    setup:
      "Conecte o provedor que você já usa e escolha um modelo. Conversation Memory vem ativada por padrão. Na extensão, confirme em Settings → Experimental e abra Settings → Context para ajustar o ponto de início, que começa em 40%. Modelos personalizados precisam de limites positivos de contexto e de saída; o limite de entrada é opcional.",
    ollama:
      "No Ollama, use o endereço real do servidor: geralmente localhost:11434 na mesma máquina ou o endereço LAN do computador em outro dispositivo. Confirme que o Ollama escuta nesse endereço, que o firewall permite e que num_ctx é pelo menos o limite de contexto informado no Kilo.",
    verify:
      "Abra uma conversa, escolha o provedor e o modelo e rode /lcm status. O status deve aparecer como enabled e a capacidade precisa estar disponível. O cabeçalho da tarefa ou a tela Context mostra o uso e a atividade do LCM. /compact solicita um ciclo manual; em uma conversa nova e curta talvez ainda não haja nada para resumir.",
    tips: "Os resumos usam chamadas de modelo, então podem acrescentar um pouco de tempo e custo. Comece com 40%; diminua para manutenção mais cedo ou aumente para menos chamadas. A memória do LCM pertence à conversa atual. A exportação de contexto pode conter prompts e saídas sensíveis.",
    trouble:
      "Se aparecer lcm_capacity_unknown, preencha os limites de contexto e saída do modelo personalizado. Se a extensão voltar após reiniciar, desative auto-update e reinstale o VSIX. Se a CLI estiver errada, use which -a kilo ou where.exe kilo. No Alpine use musl; em CPU x64 antiga tente baseline.",
    update:
      "Para atualizar, instale o VSIX novo sobre o antigo ou troque a pasta extraída da CLI. Suas conversas ficam no SQLite do Kilo. Para voltar rápido, defina experimental.conversation_memory como false; também dá para reinstalar a versão oficial do Kilo Code ou uma prévia anterior.",
    upstream:
      "O restante desta página descreve a versão oficial do Kilo Code. Os links comuns de instalação abaixo não instalam esta versão com LCM.",
  },
  bs: {
    title: "Isprobajte LCM predizdanje",
    intro:
      "Ova eksperimentalna verzija Kilo Codea održava duge razgovore korisnim tako što stariji, već iskorišteni kontekst pretvara u pretraživo stablo sažetaka. Nedavni rad ostaje tačan, a agent može vratiti starije detalje kada zatrebaju.",
    warning:
      "LCM verzije dostupne su samo u GitHub Releases ovog repozitorija. Instalacije preko Marketplacea, Open VSX-a, npm-a, Homebrewa, AUR-a, clouda ili JetBrainsa daju službenu verziju Kilo Codea bez LCM-a.",
    paper: "Želite pozadinu ideje? Pročitajte originalni LCM rad Clinta Ehrlicha i Theodorea Blackmana.",
    choose: "Izaberite VSIX za VS Code ili VSCodium, a CLI arhivu za terminal. Možete instalirati oba.",
    system:
      "Na Windowsu otvorite Settings → System → About → System type; na macOS-u Apple menu → About This Mac; na Linuxu pokrenite uname -m. x86_64 ili amd64 znači x64, a arm64 ili aarch64 znači ARM64.",
    variants:
      "Većina Linux desktopa koristi glibc; Alpine i mali kontejneri koriste musl. baseline birajte samo za stari x64 CPU ili ako obični CLI završi s illegal instruction; poseban baseline VSIX ne postoji.",
    vscode:
      "Potreban je VS Code ili VSCodium 1.105.1 ili noviji. VSIX koristi isti ID kao obični Kilo Code, pa zamjenjuje Marketplace instalaciju.",
    vscodeInstall:
      "Preuzmite odgovarajući fajl, isključite automatsko ažuriranje za Kilo Code i odaberite Extensions → … → Install from VSIX. Zatim ponovo učitajte prozor. Možete koristiti i naredbe ispod.",
    cli: "Preuzmite jednu arhivu iz tabele. Raspakujte cijelu arhivu u zaseban folder i ostavite sve pomoćne fajlove uz izvršni fajl.",
    cliInstall:
      "Pokrenite raspakovani program prije dodavanja foldera u PATH. Ako se kasnije pokrene drugi Kilo, provjerite putanje ispod i stavite LCM folder ranije u PATH.",
    setup:
      "Prvo povežite pružaoca kojeg inače koristite i izaberite model. Conversation Memory je uključena prema zadanim postavkama. U ekstenziji to provjerite pod Settings → Experimental, a zatim otvorite Settings → Context; početni prag je 40%. Prilagođeni modeli moraju imati pozitivne limite konteksta i izlaza, dok je limit ulaza neobavezan.",
    ollama:
      "Za Ollama koristite stvarnu adresu servera—obično localhost:11434 na istom računaru ili LAN adresu računara s drugog uređaja. Ollama mora slušati na toj adresi, firewall je mora propustiti, a num_ctx mora biti barem jednak limitu konteksta u Kilou.",
    verify:
      "Pokrenite razgovor, izaberite pružaoca i model te unesite /lcm status. Status treba biti enabled, a kapacitet poznat. Zaglavlje zadatka ili stranica Context prikazuje iskorištenost i aktivnost LCM-a. /compact pokreće jedan ručni LCM ciklus; u kratkom novom razgovoru možda još nema šta sažeti.",
    tips: "Sažeci koriste pozive modelu pa mogu dodati malo vremena i troška. Počnite sa 40%; smanjite za ranije održavanje ili povećajte za manje poziva. LCM memorija pripada trenutnom razgovoru. Izvoz konteksta može sadržati osjetljive upite i izlaz alata.",
    trouble:
      "Ako vidite lcm_capacity_unknown, unesite limite konteksta i izlaza izabranog prilagođenog modela. Ako se ekstenzija vrati nakon restarta, isključite auto-update i ponovo instalirajte VSIX. Za pogrešan CLI provjerite which -a kilo ili where.exe kilo. Na Alpineu koristite musl, a na starom x64 CPU-u baseline.",
    update:
      "Za nadogradnju instalirajte novi VSIX preko starog ili zamijenite raspakovani CLI folder. Razgovori ostaju u Kilo SQLite bazi. Za brzo vraćanje postavite experimental.conversation_memory na false ili instalirajte službenu verziju Kilo Codea ili starije predizdanje.",
    upstream:
      "Ostatak stranice opisuje službenu verziju Kilo Codea. Uobičajeni linkovi za instalaciju ispod ne instaliraju ovu LCM verziju.",
  },
  da: {
    title: "Prøv LCM-prereleasen",
    intro:
      "Denne eksperimentelle Kilo Code-version holder lange samtaler brugbare ved at lave ældre, allerede brugt kontekst om til et søgbart resumé-træ. Dit seneste arbejde forbliver nøjagtigt, og agenten kan hente gamle detaljer frem efter behov.",
    warning:
      "LCM-builds findes kun under GitHub Releases i dette repository. Marketplace, Open VSX, npm, Homebrew, AUR, cloud og JetBrains installerer den officielle Kilo Code-version uden LCM.",
    paper: "Vil du kende idéen bag? Læs den oprindelige LCM-artikel af Clint Ehrlich og Theodore Blackman.",
    choose: "Vælg en VSIX til VS Code eller VSCodium. Vælg et CLI-arkiv til terminalen. Du må gerne installere begge.",
    system:
      "På Windows: Settings → System → About → System type. På macOS: Apple menu → About This Mac. På Linux: kør uname -m. x86_64 eller amd64 betyder x64; arm64 eller aarch64 betyder ARM64.",
    variants:
      "De fleste Linux-desktops bruger glibc; Alpine og små containere bruger musl. Vælg kun baseline til en ældre x64-CPU, eller hvis normal CLI stopper med illegal instruction. Der er ingen særskilt baseline-VSIX.",
    vscode:
      "Du skal bruge VS Code eller VSCodium 1.105.1 eller nyere. VSIX-filen bruger det normale Kilo Code-udvidelses-id og erstatter derfor en installeret Marketplace-version.",
    vscodeInstall:
      "Hent den rigtige fil, slå automatisk opdatering fra for Kilo Code, og vælg Extensions → … → Install from VSIX. Genindlæs vinduet bagefter. Du kan også bruge en af kommandoerne herunder.",
    cli: "Hent ét arkiv fra tabellen. Pak hele arkivet ud i sin egen mappe, og behold alle supportfiler ved siden af programmet.",
    cliInstall:
      "Kør den udpakkede binær én gang, før mappen tilføjes til PATH. Starter en anden Kilo senere, så brug sti-kontrollen herunder og placer LCM-mappen først i PATH.",
    setup:
      "Forbind den udbyder, du normalt bruger, og vælg en model. Conversation Memory er slået til som standard. Kontrollér det under Settings → Experimental, og åbn derefter Settings → Context; startgrænsen er 40 %. Egne modeller skal have positive grænser for kontekst og output, mens inputgrænsen er valgfri.",
    ollama:
      "Til Ollama skal du bruge den rigtige serveradresse—ofte localhost:11434 på samme maskine eller computerens LAN-adresse fra en anden enhed. Ollama skal lytte på adressen, firewallen skal tillade den, og modellens num_ctx skal mindst være kontekstgrænsen i Kilo.",
    verify:
      "Start en chat, vælg udbyder og model, og kør /lcm status. Status skal være enabled, og kapaciteten skal være kendt. Opgavehovedet eller siden Context viser forbrug og LCM-aktivitet. /compact starter én manuel LCM-cyklus; i en kort, ny chat er der måske endnu intet at opsummere.",
    tips: "Resuméarbejde bruger modelkald og kan derfor give lidt ekstra ventetid og pris. Start med 40%; sænk for tidligere vedligeholdelse eller hæv for færre kald. LCM-hukommelse hører til den aktuelle chat. Konteksteksport kan indeholde følsomme prompts og værktøjsoutput.",
    trouble:
      "Ved lcm_capacity_unknown skal du udfylde kontekst- og outputgrænser for den valgte egne model. Skifter udvidelsen tilbage efter genstart, så slå auto-update fra og geninstallér VSIX. Er CLI-versionen forkert, brug which -a kilo eller where.exe kilo. Brug musl på Alpine og baseline på gammel x64.",
    update:
      "Ved opdatering installeres den nye VSIX oven på den gamle, eller den udpakkede CLI-mappe udskiftes. Chats bliver i Kilos SQLite-database. For hurtig tilbagerulning sættes experimental.conversation_memory til false; du kan også geninstallere den officielle Kilo Code-version eller en ældre prerelease.",
    upstream:
      "Resten af siden beskriver den officielle Kilo Code-version. De normale installationslinks nedenfor installerer ikke denne LCM-version.",
  },
  de: {
    title: "LCM-Prerelease ausprobieren",
    intro:
      "Dieser experimentelle Kilo-Code-Build hält lange Chats nutzbar, indem er älteren, bereits verwendeten Kontext in einen durchsuchbaren Zusammenfassungsbaum umwandelt. Deine letzten Arbeitsschritte bleiben exakt erhalten, und der Agent kann ältere Details bei Bedarf zurückholen.",
    warning:
      "LCM-Builds werden ausschließlich über die GitHub Releases dieses Repositorys verteilt. Marketplace, Open VSX, npm, Homebrew, AUR, Cloud und JetBrains installieren die offizielle Kilo-Code-Version ohne LCM.",
    paper:
      "Du möchtest die Idee dahinter verstehen? Lies das ursprüngliche LCM-Paper von Clint Ehrlich und Theodore Blackman.",
    choose:
      "Nimm eine VSIX für VS Code oder VSCodium und ein CLI-Archiv für das Terminal. Beides zusammen ist kein Problem.",
    system:
      "Unter Windows: Settings → System → About → System type; unter macOS: Apple menu → About This Mac; unter Linux: uname -m. x86_64 oder amd64 bedeutet x64, arm64 oder aarch64 bedeutet ARM64.",
    variants:
      "Die meisten Linux-Desktopdistributionen verwenden glibc; Alpine und schlanke Container verwenden musl. Wähle baseline nur für ältere x64-Prozessoren oder wenn die normale CLI mit illegal instruction abbricht. Eine eigene baseline-VSIX gibt es nicht.",
    vscode:
      "Du brauchst VS Code oder VSCodium 1.105.1 oder neuer. Die VSIX verwendet dieselbe Erweiterungs-ID wie Kilo Code und ersetzt daher eine installierte Marketplace-Version.",
    vscodeInstall:
      "Lade die passende Datei herunter, deaktiviere automatische Updates für Kilo Code und wähle Extensions → … → Install from VSIX. Lade danach das Fenster neu. Alternativ funktionieren die Befehle unten.",
    cli: "Lade genau ein Archiv aus der Tabelle. Entpacke es vollständig in einen eigenen Ordner und lasse alle Supportdateien neben dem Programm.",
    cliInstall:
      "Starte das entpackte Programm einmal, bevor du den Ordner zu PATH hinzufügst. Startet später ein anderes Kilo, prüfe die Pfade unten und setze den LCM-Ordner in PATH nach vorn.",
    setup:
      "Verbinde den Anbieter, den du normalerweise nutzt, und wähle ein Modell. Conversation Memory ist standardmäßig aktiviert. Prüfe das unter Settings → Experimental und öffne anschließend Settings → Context; der Startwert liegt bei 40 %. Für eigene Modelle müssen Kontext- und Ausgabelimit positiv sein; das Eingabelimit ist optional.",
    ollama:
      "Nutze für Ollama die echte Serveradresse—meist localhost:11434 auf demselben Rechner oder dessen LAN-Adresse von einem anderen Gerät. Ollama muss dort lauschen, die Firewall muss den Zugriff erlauben, und num_ctx muss mindestens so groß wie die Kontextgrenze in Kilo sein.",
    verify:
      "Starte einen Chat, wähle Anbieter und Modell und führe /lcm status aus. Der Status sollte enabled sein und die Kapazität bekannt. Der Aufgabenkopf oder die Seite Context zeigt Auslastung und LCM-Aktivität. /compact startet einen manuellen LCM-Zyklus; in einem kurzen neuen Chat gibt es möglicherweise noch nichts zusammenzufassen.",
    tips: "Zusammenfassungen verwenden Modellaufrufe und können etwas Zeit und Kosten hinzufügen. Beginne mit 40%; senke den Wert für frühere Wartung oder erhöhe ihn für weniger Aufrufe. LCM-Speicher gehört zum aktuellen Chat. Ein Kontextexport kann vertrauliche Prompts und Werkzeugausgaben enthalten.",
    trouble:
      "Bei lcm_capacity_unknown trägst du Kontext- und Ausgabegrenzen des gewählten eigenen Modells ein. Springt die Erweiterung nach einem Neustart zurück, schalte auto-update aus und installiere die VSIX erneut. Bei falscher CLI helfen which -a kilo oder where.exe kilo. Auf Alpine nimm musl, auf alter x64-Hardware baseline.",
    update:
      "Zum Aktualisieren installierst du die neue VSIX über die alte oder ersetzt den entpackten CLI-Ordner. Chats bleiben in Kilos SQLite-Datenbank. Für ein schnelles Rollback setze experimental.conversation_memory auf false; du kannst auch Upstream-Kilo-Code oder eine ältere Prerelease installieren.",
    upstream:
      "Der Rest dieser Seite beschreibt die offizielle Kilo-Code-Version. Die normalen Installationslinks weiter unten installieren diese LCM-Version nicht.",
  },
  es: {
    title: "Prueba la versión preliminar de LCM",
    intro:
      "Esta compilación experimental de Kilo Code mantiene útiles los chats largos al convertir el contexto antiguo ya usado en un árbol de resúmenes que se puede buscar. Tu trabajo reciente se conserva exacto y el agente puede recuperar detalles anteriores cuando los necesite.",
    warning:
      "Las compilaciones con LCM solo se distribuyen desde los GitHub Releases de este repositorio. Marketplace, Open VSX, npm, Homebrew, AUR, los servicios en la nube y JetBrains instalan la versión oficial de Kilo Code, sin LCM.",
    paper: "¿Quieres conocer la idea? Lee el artículo original de LCM de Clint Ehrlich y Theodore Blackman.",
    choose: "Elige un VSIX para VS Code o VSCodium y un archivo CLI para la terminal. Puedes instalar los dos.",
    system:
      "En Windows mira Settings → System → About → System type; en macOS, Apple menu → About This Mac; en Linux ejecuta uname -m. x86_64 o amd64 significa x64; arm64 o aarch64 significa ARM64.",
    variants:
      "La mayoría de las distribuciones Linux de escritorio usa glibc; Alpine y algunos contenedores mínimos usan musl. Elige baseline solo para procesadores x64 antiguos o si la CLI normal se cierra con el error illegal instruction. No hay un VSIX baseline aparte.",
    vscode:
      "Necesitas VS Code o VSCodium 1.105.1 o posterior. El VSIX usa el ID normal de Kilo Code, así que reemplaza una instalación de Marketplace.",
    vscodeInstall:
      "Descarga el archivo correcto, desactiva la actualización automática de Kilo Code y usa Extensions → … → Install from VSIX. Recarga la ventana después. También puedes usar uno de los comandos siguientes.",
    cli: "Descarga un archivo de la tabla. Extrae todo en una carpeta propia y conserva todos los archivos auxiliares junto al ejecutable.",
    cliInstall:
      "Ejecuta una vez el binario extraído antes de añadir la carpeta a PATH. Si luego arranca otro Kilo, usa las comprobaciones de ruta de abajo y coloca antes la carpeta de LCM en PATH.",
    setup:
      "Conecta tu proveedor habitual y elige un modelo. Conversation Memory está activada por defecto. Compruébalo en Settings → Experimental y abre después Settings → Context; el punto de inicio es el 40 %. Los modelos personalizados necesitan límites positivos de contexto y salida; el límite de entrada es opcional.",
    ollama:
      "Para Ollama usa la dirección real del servidor: normalmente localhost:11434 en el mismo equipo o su dirección LAN desde otro dispositivo. Ollama debe escuchar allí, el cortafuegos debe permitirlo y num_ctx debe ser al menos el límite de contexto configurado en Kilo.",
    verify:
      "Inicia un chat, elige el proveedor y el modelo y ejecuta /lcm status. El estado debe ser enabled y la capacidad debe aparecer como conocida. La cabecera de la tarea o la página Context muestra el uso y la actividad de LCM. /compact inicia un ciclo manual; en un chat nuevo y corto quizá todavía no haya nada que resumir.",
    tips: "Los resúmenes usan llamadas al modelo, así que pueden añadir algo de tiempo y coste. Empieza con 40%; bájalo para mantenimiento más temprano o súbelo para menos llamadas. La memoria LCM pertenece al chat actual. La exportación de contexto puede contener prompts y salidas sensibles.",
    trouble:
      "Si ves lcm_capacity_unknown, completa los límites de contexto y salida del modelo personalizado. Si la extensión vuelve atrás tras reiniciar, desactiva auto-update y reinstala el VSIX. Si la CLI no es la correcta, usa which -a kilo o where.exe kilo. En Alpine usa musl; en x64 antiguo prueba baseline.",
    update:
      "Para actualizar, instala el VSIX nuevo sobre el anterior o sustituye la carpeta CLI extraída. Tus chats permanecen en SQLite de Kilo. Para volver rápido, pon experimental.conversation_memory en false; también puedes reinstalar la versión oficial de Kilo Code o una versión preliminar anterior.",
    upstream:
      "El resto de esta página describe la versión oficial de Kilo Code. Los enlaces de instalación habituales que aparecen más abajo no instalan esta versión con LCM.",
  },
  fr: {
    title: "Essayez la préversion LCM",
    intro:
      "Cette version expérimentale de Kilo Code permet de poursuivre de longues conversations sans perdre le fil : le contexte ancien déjà utilisé devient un arbre de résumés consultable. Les échanges récents restent intacts et l'agent peut retrouver les détails antérieurs au besoin.",
    warning:
      "Les versions avec LCM sont distribuées uniquement dans les GitHub Releases de ce dépôt. Marketplace, Open VSX, npm, Homebrew, AUR, les services cloud et JetBrains installent la version officielle de Kilo Code, sans LCM.",
    paper: "Vous voulez comprendre l'idée ? Lisez l'article LCM original de Clint Ehrlich et Theodore Blackman.",
    choose:
      "Choisissez un VSIX pour VS Code ou VSCodium, et une archive CLI pour le terminal. Vous pouvez installer les deux.",
    system:
      "Sous Windows : Settings → System → About → System type ; sous macOS : Apple menu → About This Mac ; sous Linux : uname -m. x86_64 ou amd64 signifie x64, arm64 ou aarch64 signifie ARM64.",
    variants:
      "La plupart des distributions Linux de bureau utilisent glibc ; Alpine et certains conteneurs légers utilisent musl. Choisissez la version baseline uniquement pour un ancien processeur x64 ou si la CLI normale s'arrête avec l'erreur illegal instruction. Il n'existe pas de VSIX baseline distinct.",
    vscode:
      "Il faut VS Code ou VSCodium 1.105.1 ou plus récent. Le VSIX utilise l'identifiant normal de Kilo Code et remplace donc une version Marketplace installée.",
    vscodeInstall:
      "Téléchargez le bon fichier, désactivez la mise à jour automatique de Kilo Code, puis choisissez Extensions → … → Install from VSIX. Rechargez la fenêtre ensuite. Vous pouvez aussi utiliser les commandes ci-dessous.",
    cli: "Téléchargez une archive du tableau. Décompressez-la entièrement dans un dossier dédié et conservez tous les fichiers fournis avec l'exécutable.",
    cliInstall:
      "Lancez une fois le programme extrait avant d'ajouter son dossier à PATH. Si un autre Kilo démarre ensuite, vérifiez les chemins ci-dessous et placez le dossier LCM plus tôt dans PATH.",
    setup:
      "Connectez votre fournisseur habituel et choisissez un modèle. Conversation Memory est activée par défaut. Vérifiez-le dans Settings → Experimental, puis ouvrez Settings → Context ; le seuil de déclenchement est fixé à 40 % par défaut. Les modèles personnalisés exigent des limites positives de contexte et de sortie ; la limite d'entrée est facultative.",
    ollama:
      "Pour Ollama, utilisez l'adresse réelle du serveur—souvent localhost:11434 sur la même machine ou son adresse LAN depuis un autre appareil. Ollama doit écouter sur cette adresse, le pare-feu doit l'autoriser et num_ctx doit être au moins égal à la limite de contexte renseignée dans Kilo.",
    verify:
      "Démarrez une discussion, choisissez le fournisseur et le modèle, puis lancez /lcm status. Le statut doit être enabled et la capacité doit être connue. L'en-tête de la tâche ou la page Context affiche l'utilisation et l'activité de LCM. /compact lance un cycle manuel ; une nouvelle discussion courte peut ne rien avoir à résumer.",
    tips: "Les résumés font des appels au modèle et peuvent donc ajouter un peu de délai et de coût. Commencez à 40 % ; baissez pour intervenir plus tôt ou augmentez pour moins d'appels. La mémoire LCM appartient à la discussion actuelle. Un export de contexte peut contenir des prompts et sorties sensibles.",
    trouble:
      "Si lcm_capacity_unknown apparaît, renseignez les limites de contexte et de sortie du modèle personnalisé. Si l'extension repasse à une autre version après le redémarrage, désactivez la mise à jour automatique et réinstallez le VSIX. Si la mauvaise CLI démarre, utilisez which -a kilo ou where.exe kilo. Sur Alpine, prenez musl ; sur un ancien processeur x64, essayez baseline.",
    update:
      "Pour mettre à jour, installez le nouveau VSIX par-dessus l'ancien ou remplacez le dossier CLI extrait. Vos discussions restent dans SQLite de Kilo. Pour revenir vite, mettez experimental.conversation_memory à false ; vous pouvez aussi réinstaller la version officielle de Kilo Code ou une ancienne préversion.",
    upstream:
      "Le reste de cette page décrit la version officielle de Kilo Code. Les liens d'installation habituels plus bas n'installent pas cette version avec LCM.",
  },
  gr: {
    title: "Δοκιμάστε την προέκδοση LCM",
    intro:
      "Αυτή η πειραματική έκδοση του Kilo Code βοηθά τις μεγάλες συνομιλίες να παραμένουν χρήσιμες, μετατρέποντας το παλιότερο περιβάλλον που έχει ήδη χρησιμοποιηθεί σε ένα δέντρο περιλήψεων με δυνατότητα αναζήτησης. Η πρόσφατη δουλειά μένει ανέπαφη και ο βοηθός μπορεί να ανακτήσει παλιότερες λεπτομέρειες όταν χρειαστεί.",
    warning:
      "Οι εκδόσεις με LCM διατίθενται μόνο από τα GitHub Releases αυτού του αποθετηρίου. Οι εγκαταστάσεις από Marketplace, Open VSX, npm, Homebrew, AUR, υπηρεσίες cloud και JetBrains αφορούν την επίσημη έκδοση του Kilo Code, χωρίς LCM.",
    paper: "Θέλετε το σκεπτικό; Διαβάστε την αρχική εργασία LCM των Clint Ehrlich και Theodore Blackman.",
    choose: "Επιλέξτε VSIX για VS Code ή VSCodium και αρχείο CLI για τερματικό. Μπορείτε να εγκαταστήσετε και τα δύο.",
    system:
      "Στα Windows δείτε Settings → System → About → System type, στο macOS Apple menu → About This Mac, και στο Linux τρέξτε uname -m. x86_64 ή amd64 σημαίνει x64, ενώ arm64 ή aarch64 σημαίνει ARM64.",
    variants:
      "Οι περισσότερες διανομές Linux για υπολογιστές χρησιμοποιούν glibc, ενώ το Alpine και ορισμένα μικρά κοντέινερ χρησιμοποιούν musl. Επιλέξτε baseline μόνο για παλιό επεξεργαστή x64 ή αν το κανονικό CLI τερματίζεται με illegal instruction. Δεν υπάρχει ξεχωριστό baseline VSIX.",
    vscode:
      "Χρειάζεστε VS Code ή VSCodium 1.105.1 ή νεότερο. Το VSIX χρησιμοποιεί το κανονικό extension ID του Kilo Code, οπότε αντικαθιστά εγκατεστημένη έκδοση Marketplace.",
    vscodeInstall:
      "Κατεβάστε το σωστό αρχείο, απενεργοποιήστε τις αυτόματες ενημερώσεις του Kilo Code και επιλέξτε Extensions → … → Install from VSIX. Έπειτα επαναφορτώστε το παράθυρο. Μπορείτε επίσης να χρησιμοποιήσετε τις παρακάτω εντολές.",
    cli: "Κατεβάστε ένα αρχείο από τον πίνακα. Αποσυμπιέστε όλο το αρχείο σε ξεχωριστό φάκελο και κρατήστε όλα τα βοηθητικά αρχεία δίπλα στο εκτελέσιμο.",
    cliInstall:
      "Τρέξτε μία φορά το εκτελέσιμο πριν προσθέσετε τον φάκελο στο PATH. Αν αργότερα ξεκινά άλλο Kilo, ελέγξτε τις διαδρομές παρακάτω και βάλτε τον φάκελο LCM νωρίτερα στο PATH.",
    setup:
      "Συνδέστε πρώτα τον πάροχο που χρησιμοποιείτε συνήθως και επιλέξτε μοντέλο. Το Conversation Memory είναι ενεργό από προεπιλογή. Στην επέκταση ελέγξτε Settings → Experimental και έπειτα ανοίξτε Settings → Context· το αρχικό όριο είναι 40%. Τα προσαρμοσμένα μοντέλα χρειάζονται θετικά όρια περιβάλλοντος και εξόδου, ενώ το όριο εισόδου είναι προαιρετικό.",
    ollama:
      "Για Ollama χρησιμοποιήστε την πραγματική διεύθυνση server—συνήθως localhost:11434 στο ίδιο μηχάνημα ή τη LAN διεύθυνσή του από άλλη συσκευή. Το Ollama πρέπει να ακούει εκεί, το firewall να το επιτρέπει και το num_ctx να είναι τουλάχιστον όσο το context limit στο Kilo.",
    verify:
      "Ξεκινήστε μια συνομιλία, επιλέξτε πάροχο και μοντέλο και εκτελέστε /lcm status. Η κατάσταση πρέπει να είναι enabled και η χωρητικότητα γνωστή. Η κεφαλίδα της εργασίας ή η σελίδα Context δείχνει τη χρήση και τη δραστηριότητα του LCM. Το /compact ξεκινά έναν χειροκίνητο κύκλο· μια σύντομη νέα συνομιλία ίσως να μην έχει ακόμη κάτι για περίληψη.",
    tips: "Οι περιλήψεις χρησιμοποιούν κλήσεις προς το μοντέλο, οπότε μπορεί να προσθέσουν λίγο χρόνο και κόστος. Ξεκινήστε με 40%· μειώστε το για νωρίτερη επεξεργασία ή αυξήστε το για λιγότερες κλήσεις. Η μνήμη LCM ανήκει στην τρέχουσα συνομιλία. Η εξαγωγή περιβάλλοντος μπορεί να περιέχει ευαίσθητες προτροπές και αποτελέσματα εργαλείων.",
    trouble:
      "Αν δείτε lcm_capacity_unknown, συμπληρώστε τα context και output limits του επιλεγμένου custom model. Αν το extension αλλάξει μετά restart, κλείστε auto-update και επανεγκαταστήστε το VSIX. Για λάθος CLI ελέγξτε which -a kilo ή where.exe kilo. Σε Alpine πάρτε musl, σε παλιό x64 δοκιμάστε baseline.",
    update:
      "Για αναβάθμιση εγκαταστήστε το νέο VSIX πάνω από το παλιό ή αντικαταστήστε τον φάκελο CLI. Οι συνομιλίες μένουν στη SQLite του Kilo. Για γρήγορη επιστροφή θέστε experimental.conversation_memory σε false ή εγκαταστήστε την επίσημη έκδοση του Kilo Code ή μια παλιότερη προέκδοση.",
    upstream:
      "Το υπόλοιπο της σελίδας περιγράφει την επίσημη έκδοση του Kilo Code. Οι συνηθισμένοι σύνδεσμοι εγκατάστασης παρακάτω δεν εγκαθιστούν αυτή την έκδοση με LCM.",
  },
  it: {
    title: "Prova la prerelease LCM",
    intro:
      "Questa build sperimentale di Kilo Code mantiene utili le chat lunghe trasformando il contesto più vecchio già usato in un albero di riepiloghi ricercabile. Il lavoro recente resta esatto e l'agente può recuperare i vecchi dettagli quando servono.",
    warning:
      "Le build con LCM sono distribuite solo nei GitHub Releases di questo repository. Marketplace, Open VSX, npm, Homebrew, AUR, i servizi cloud e JetBrains installano la versione ufficiale di Kilo Code, senza LCM.",
    paper: "Vuoi capire l'idea? Leggi il paper LCM originale di Clint Ehrlich e Theodore Blackman.",
    choose: "Scegli un VSIX per VS Code o VSCodium e un archivio CLI per il terminale. Puoi installarli entrambi.",
    system:
      "Su Windows guarda Settings → System → About → System type; su macOS Apple menu → About This Mac; su Linux esegui uname -m. x86_64 o amd64 significa x64; arm64 o aarch64 significa ARM64.",
    variants:
      "La maggior parte delle distribuzioni Linux desktop usa glibc; Alpine e alcuni container minimi usano musl. Scegli baseline solo per processori x64 datati o se la CLI normale si chiude con l'errore illegal instruction. Non esiste un VSIX baseline separato.",
    vscode:
      "Serve VS Code o VSCodium 1.105.1 o più recente. Il VSIX usa il normale ID dell'estensione Kilo Code, quindi sostituisce una build Marketplace installata.",
    vscodeInstall:
      "Scarica il file giusto, disattiva l'aggiornamento automatico di Kilo Code e scegli Extensions → … → Install from VSIX. Ricarica la finestra dopo. Puoi anche usare uno dei comandi qui sotto.",
    cli: "Scarica un archivio dalla tabella. Estrailo tutto in una cartella dedicata e tieni ogni file di supporto accanto all'eseguibile.",
    cliInstall:
      "Avvia una volta il binario estratto prima di aggiungere la cartella a PATH. Se poi parte un altro Kilo, usa i controlli qui sotto e metti prima la cartella LCM in PATH.",
    setup:
      "Collega il provider che usi di solito e scegli un modello. Conversation Memory è attiva per impostazione predefinita. Controlla in Settings → Experimental, poi apri Settings → Context; la soglia iniziale è impostata al 40%. I modelli personalizzati richiedono limiti positivi per contesto e output; il limite di input è facoltativo.",
    ollama:
      "Per Ollama usa il vero indirizzo del server: di solito localhost:11434 sulla stessa macchina o il suo indirizzo LAN da un altro dispositivo. Ollama deve ascoltare lì, il firewall deve consentirlo e num_ctx deve essere almeno il limite di contesto impostato in Kilo.",
    verify:
      "Avvia una chat, scegli provider e modello ed esegui /lcm status. Lo stato deve essere enabled e la capacità deve risultare nota. L'intestazione dell'attività o la pagina Context mostra l'utilizzo e l'attività di LCM. /compact avvia un ciclo manuale; una chat nuova e breve potrebbe non avere ancora nulla da riassumere.",
    tips: "I riepiloghi usano chiamate al modello, quindi possono aggiungere un po' di tempo e costo. Parti dal 40%; abbassa per intervenire prima o alza per meno chiamate. La memoria LCM appartiene alla chat corrente. L'export del contesto può contenere prompt e output sensibili.",
    trouble:
      "Se vedi lcm_capacity_unknown, inserisci i limiti di contesto e output del modello personalizzato. Se dopo il riavvio torna un'altra versione dell'estensione, disattiva gli aggiornamenti automatici e reinstalla il VSIX. Se parte la CLI sbagliata, usa which -a kilo o where.exe kilo. Su Alpine usa musl; su un vecchio processore x64 prova baseline.",
    update:
      "Per aggiornare, installa il nuovo VSIX sopra il vecchio o sostituisci la cartella CLI estratta. Le chat restano nel database SQLite di Kilo. Per tornare subito indietro, imposta experimental.conversation_memory su false; puoi anche reinstallare la versione ufficiale di Kilo Code o una prerelease precedente.",
    upstream:
      "Il resto della pagina descrive la versione ufficiale di Kilo Code. I normali link di installazione più in basso non installano questa versione con LCM.",
  },
  ja: {
    title: "LCM プレリリースを試す",
    intro:
      "この実験版 Kilo Code は、すでに使った古いコンテキストを検索できる要約ツリーにまとめ、長いチャットでも流れを保ちやすくします。最近の作業はそのまま残り、必要になればエージェントが以前の詳しい内容を取り出せます。",
    warning:
      "LCM 入りのビルドは、このリポジトリの GitHub Releases でのみ配布しています。Marketplace、Open VSX、npm、Homebrew、AUR、クラウド、JetBrains からインストールされるのは公式版 Kilo Code で、LCM は含まれません。",
    paper: "仕組みの元になった考え方は、Clint Ehrlich と Theodore Blackman による原著 LCM 論文をご覧ください。",
    choose: "VS Code または VSCodium なら VSIX、ターミナルなら CLI アーカイブを選びます。両方入れても問題ありません。",
    system:
      "Windows は Settings → System → About → System type、macOS は Apple menu → About This Mac を確認し、Linux は uname -m を実行します。x86_64 または amd64 は x64、arm64 または aarch64 は ARM64 です。",
    variants:
      "多くの Linux デスクトップは glibc、Alpine や小さなコンテナは musl を使います。baseline は古い x64 CPU、または通常版 CLI が illegal instruction で終了するときだけ選んでください。baseline 専用 VSIX はありません。",
    vscode:
      "VS Code または VSCodium 1.105.1 以降が必要です。VSIX は通常版 Kilo Code と同じ拡張機能 ID を使うため、インストール済みの Marketplace 版を置き換えます。",
    vscodeInstall:
      "対応ファイルをダウンロードし、Kilo Code の自動更新をオフにして、Extensions → … → Install from VSIX を選びます。インストール後にウィンドウを再読み込みしてください。下のコマンドでもできます。",
    cli: "表からアーカイブを1つダウンロードします。専用フォルダーへ全部展開し、サポートファイルを実行ファイルと同じ場所に置いたままにしてください。",
    cliInstall:
      "フォルダーを PATH に追加する前に、展開したバイナリを一度実行します。後で別の Kilo が起動する場合は、下のパス確認を使い、LCM フォルダーを PATH の先に置きます。",
    setup:
      "まず普段使っているプロバイダーを接続し、モデルを選びます。Conversation Memory は初期状態で有効です。拡張機能の Settings → Experimental で確認し、Settings → Context を開いてください。処理を始める基準値は 40% です。カスタムモデルでは、コンテキスト上限と出力トークン上限に正の値が必要です。入力上限は省略できます。",
    ollama:
      "Ollama には実際のサーバーアドレスを指定します。同じ端末なら通常 localhost:11434、別端末ならコンピューターの LAN アドレスです。Ollama がそのアドレスで待ち受け、firewall が許可し、num_ctx が Kilo に入力した context limit 以上か確認してください。",
    verify:
      "チャットを始め、プロバイダーとモデルを選んで /lcm status を実行します。状態が enabled で、容量が認識されていることを確認してください。タスクヘッダーまたは Context ページに使用量と LCM の動作状況が表示されます。/compact を使うと手動で LCM を1回実行できます。短い新規チャットでは、まだ要約する内容がない場合があります。",
    tips: "要約にはモデル呼び出しを使うため、少し時間と料金が増えることがあります。まずは 40% のまま使い、早めに整理したい場合は下げ、呼び出し回数を減らしたい場合は上げます。LCM の記憶は現在のチャット専用です。コンテキストの書き出しには、機密性の高いプロンプトやツール出力が含まれる場合があります。",
    trouble:
      "lcm_capacity_unknown が出たら、選択中のカスタムモデルの context と output limit を入力します。再起動後に拡張機能が戻るなら auto-update を切り、VSIX を再インストールします。CLI が違うなら which -a kilo または where.exe kilo を確認します。Alpine は musl、古い x64 は baseline を試します。",
    update:
      "更新するときは、新しい VSIX を上書きインストールするか、展開済みの CLI フォルダーを入れ替えます。チャットは Kilo の SQLite に残ります。すぐ元に戻すには experimental.conversation_memory を false にしてください。公式版 Kilo Code や以前のプレリリースを再インストールすることもできます。",
    upstream:
      "この先は公式版 Kilo Code の説明です。下にある通常のインストールリンクからは、この LCM 版はインストールされません。",
  },
  ko: {
    title: "LCM 프리릴리스 사용해 보기",
    intro:
      "이 실험용 Kilo Code 빌드는 이미 사용한 오래된 컨텍스트를 검색 가능한 요약 트리로 바꿔 긴 채팅을 계속 유용하게 만듭니다. 최근 작업은 정확히 남고, 에이전트는 필요할 때 이전 세부 내용을 다시 찾을 수 있습니다.",
    warning:
      "LCM이 포함된 빌드는 이 저장소의 GitHub Releases에서만 배포합니다. Marketplace, Open VSX, npm, Homebrew, AUR, 클라우드, JetBrains에서 설치하면 LCM이 없는 공식 Kilo Code 버전을 받게 됩니다.",
    paper: "아이디어가 궁금하다면 Clint Ehrlich와 Theodore Blackman의 원본 LCM 논문을 읽어 보세요.",
    choose: "VS Code 또는 VSCodium을 쓰면 VSIX, 터미널을 쓰면 CLI 압축 파일을 고르세요. 둘 다 설치해도 됩니다.",
    system:
      "Windows는 Settings → System → About → System type, macOS는 Apple menu → About This Mac을 확인하고 Linux는 uname -m을 실행하세요. x86_64 또는 amd64는 x64, arm64 또는 aarch64는 ARM64입니다.",
    variants:
      "대부분의 Linux 데스크톱은 glibc를, Alpine과 작은 컨테이너는 musl을 씁니다. baseline은 오래된 x64 CPU이거나 일반 CLI가 illegal instruction으로 끝날 때만 고르세요. 별도 baseline VSIX는 없습니다.",
    vscode:
      "VS Code 또는 VSCodium 1.105.1 이상이 필요합니다. VSIX는 일반 Kilo Code 확장 ID를 사용하므로 설치된 Marketplace 빌드를 교체합니다.",
    vscodeInstall:
      "맞는 파일을 내려받고 Kilo Code 자동 업데이트를 끈 뒤 Extensions → … → Install from VSIX를 선택하세요. 설치 후 창을 다시 로드하세요. 아래 명령을 사용해도 됩니다.",
    cli: "표에서 압축 파일 하나를 받으세요. 전용 폴더에 전체를 풀고 모든 지원 파일을 실행 파일 옆에 그대로 두세요.",
    cliInstall:
      "폴더를 PATH에 넣기 전에 추출한 바이너리를 한 번 실행하세요. 나중에 다른 Kilo가 실행되면 아래 경로 확인을 사용하고 LCM 폴더를 PATH 앞쪽에 놓으세요.",
    setup:
      "먼저 평소 사용하는 제공자를 연결하고 모델을 선택하세요. Conversation Memory는 기본으로 켜져 있습니다. 확장의 Settings → Experimental에서 확인한 다음 Settings → Context를 여세요. 작업을 시작하는 기본 기준은 40%입니다. 사용자 지정 모델에는 양수인 컨텍스트 한도와 출력 토큰 한도가 필요하며, 입력 한도는 선택 사항입니다.",
    ollama:
      "Ollama에는 실제 서버 주소를 쓰세요. 같은 컴퓨터라면 보통 localhost:11434, 다른 장치라면 컴퓨터의 LAN 주소입니다. Ollama가 그 주소에서 수신하고 firewall이 허용하며 model의 num_ctx가 Kilo에 넣은 context limit 이상인지 확인하세요.",
    verify:
      "채팅을 시작하고 제공자와 모델을 고른 뒤 /lcm status를 실행하세요. 상태가 enabled이고 용량이 인식되는지 확인합니다. 작업 헤더 또는 Context 화면에서 사용량과 LCM 동작을 볼 수 있습니다. /compact는 LCM을 수동으로 한 번 실행합니다. 짧은 새 채팅에는 아직 요약할 내용이 없을 수 있습니다.",
    tips: "요약에는 모델 호출이 사용되어 약간의 지연과 제공자 비용이 더 생길 수 있습니다. 40%로 시작하고 더 일찍 정리하려면 낮추고 호출을 줄이려면 높이세요. LCM 메모리는 현재 채팅에만 속합니다. 컨텍스트 내보내기에는 민감한 프롬프트와 도구 출력이 들어갈 수 있습니다.",
    trouble:
      "lcm_capacity_unknown이 보이면 선택한 custom model의 context와 output limit를 채우세요. 재시작 뒤 확장이 돌아가면 auto-update를 끄고 VSIX를 다시 설치하세요. CLI 버전이 다르면 which -a kilo 또는 where.exe kilo를 확인하세요. Alpine은 musl, 오래된 x64는 baseline을 쓰세요.",
    update:
      "업데이트하려면 새 VSIX를 기존 버전 위에 설치하거나 압축을 푼 CLI 폴더를 교체하세요. 채팅은 Kilo의 SQLite에 남습니다. 빠르게 되돌리려면 experimental.conversation_memory를 false로 설정하세요. 공식 Kilo Code나 이전 프리릴리스를 다시 설치해도 됩니다.",
    upstream:
      "아래 내용은 공식 Kilo Code에 관한 설명입니다. 아래의 일반 설치 링크로는 이 LCM 버전이 설치되지 않습니다.",
  },
  no: {
    title: "Prøv LCM-forhåndsversjonen",
    intro:
      "Denne eksperimentelle Kilo Code-versjonen holder lange samtaler nyttige ved å gjøre eldre, allerede brukt kontekst om til et søkbart sammendragstre. Nylig arbeid forblir nøyaktig, og agenten kan hente fram gamle detaljer ved behov.",
    warning:
      "Versjoner med LCM distribueres bare via GitHub Releases i dette repositoriet. Marketplace, Open VSX, npm, Homebrew, AUR, skytjenester og JetBrains installerer den offisielle Kilo Code-versjonen uten LCM.",
    paper: "Vil du forstå ideen? Les den opprinnelige LCM-artikkelen av Clint Ehrlich og Theodore Blackman.",
    choose: "Velg VSIX for VS Code eller VSCodium og et CLI-arkiv for terminalen. Du kan installere begge.",
    system:
      "I Windows: Settings → System → About → System type. I macOS: Apple menu → About This Mac. I Linux: kjør uname -m. x86_64 eller amd64 betyr x64; arm64 eller aarch64 betyr ARM64.",
    variants:
      "De fleste Linux-skrivebord bruker glibc; Alpine og små containere bruker musl. Velg baseline bare for en eldre x64-CPU eller hvis vanlig CLI stopper med illegal instruction. Det finnes ingen egen baseline-VSIX.",
    vscode:
      "Du trenger VS Code eller VSCodium 1.105.1 eller nyere. VSIX bruker samme utvidelses-ID som vanlig Kilo Code og erstatter derfor en installert Marketplace-versjon.",
    vscodeInstall:
      "Last ned riktig fil, slå av automatisk oppdatering for Kilo Code og velg Extensions → … → Install from VSIX. Last vinduet på nytt etterpå. Du kan også bruke kommandoene under.",
    cli: "Last ned ett arkiv fra tabellen. Pakk ut hele arkivet i en egen mappe og behold alle støttefiler ved siden av programmet.",
    cliInstall:
      "Kjør den utpakkede binærfilen én gang før mappen legges til PATH. Hvis en annen Kilo starter senere, bruk stikontrollene under og sett LCM-mappen tidligere i PATH.",
    setup:
      "Koble til leverandøren du vanligvis bruker, og velg en modell. Conversation Memory er slått på som standard. Kontroller dette under Settings → Experimental, og åpne deretter Settings → Context. Startgrensen er 40 %. Egne modeller må ha positive grenser for kontekst og utdata; inndatagrensen er valgfri.",
    ollama:
      "For Ollama bruker du den virkelige serveradressen—ofte localhost:11434 på samme maskin eller maskinens LAN-adresse fra en annen enhet. Ollama må lytte der, brannmuren må tillate det, og num_ctx må være minst kontekstgrensen du oppgir i Kilo.",
    verify:
      "Start en chat, velg leverandør og modell, og kjør /lcm status. Statusen skal være enabled, og kapasiteten skal være kjent. Oppgavehodet eller Context-siden viser bruk og LCM-aktivitet. /compact starter én manuell LCM-runde; en kort, ny chat har kanskje ikke noe å oppsummere ennå.",
    tips: "Sammendrag bruker modellkall og kan gi litt ekstra tid og kostnad. Start med 40%; senk for tidligere vedlikehold eller hev for færre kall. LCM-minnet tilhører gjeldende chat. Konteksteksport kan inneholde følsomme ledetekster og verktøyresultater.",
    trouble:
      "Ved lcm_capacity_unknown fyller du inn kontekst- og outputgrenser for valgt egen modell. Hvis utvidelsen byttes tilbake etter omstart, slå av auto-update og installer VSIX på nytt. Ved feil CLI bruker du which -a kilo eller where.exe kilo. På Alpine velger du musl, på gammel x64 baseline.",
    update:
      "For oppdatering installerer du ny VSIX over den gamle eller bytter ut den utpakkede CLI-mappen. Chattene blir i Kilos SQLite-database. For rask tilbakerulling setter du experimental.conversation_memory til false; du kan også reinstallere den offisielle Kilo Code-versjonen eller en eldre forhåndsversjon.",
    upstream:
      "Resten av siden beskriver den offisielle Kilo Code-versjonen. De vanlige installasjonslenkene lenger ned installerer ikke denne versjonen med LCM.",
  },
  pl: {
    title: "Wypróbuj wersję przedpremierową LCM",
    intro:
      "Ta eksperymentalna wersja Kilo Code pozwala zachować ciągłość długich rozmów, zamieniając starszy, już wykorzystany kontekst w przeszukiwalne drzewo podsumowań. Ostatnie wiadomości pozostają bez zmian, a agent może w razie potrzeby odzyskać wcześniejsze szczegóły.",
    warning:
      "Wersje z LCM są udostępniane wyłącznie w GitHub Releases tego repozytorium. Marketplace, Open VSX, npm, Homebrew, AUR, usługi chmurowe i JetBrains instalują oficjalną wersję Kilo Code bez LCM.",
    paper: "Chcesz poznać pomysł? Przeczytaj oryginalną pracę LCM autorstwa Clinta Ehrlicha i Theodore'a Blackmana.",
    choose: "Wybierz VSIX dla VS Code lub VSCodium, a archiwum CLI do terminala. Możesz zainstalować oba.",
    system:
      "W Windows sprawdź Settings → System → About → System type; w macOS Apple menu → About This Mac; w Linux uruchom uname -m. x86_64 lub amd64 oznacza x64, a arm64 lub aarch64 oznacza ARM64.",
    variants:
      "Większość desktopowych dystrybucji Linuksa używa glibc; Alpine i małe kontenery używają musl. Wariant baseline wybierz tylko dla starszego procesora x64 albo wtedy, gdy zwykłe CLI kończy pracę z błędem illegal instruction. Nie ma osobnego pliku VSIX w wariancie baseline.",
    vscode:
      "Potrzebujesz VS Code lub VSCodium 1.105.1 albo nowszego. VSIX używa zwykłego ID rozszerzenia Kilo Code, więc zastępuje zainstalowaną wersję Marketplace.",
    vscodeInstall:
      "Pobierz właściwy plik, wyłącz automatyczną aktualizację Kilo Code i wybierz Extensions → … → Install from VSIX. Potem przeładuj okno. Możesz też użyć poleceń poniżej.",
    cli: "Pobierz jedno archiwum z tabeli. Rozpakuj całość do osobnego katalogu i trzymaj wszystkie pliki pomocnicze obok programu.",
    cliInstall:
      "Uruchom rozpakowany program przed dodaniem katalogu do PATH. Jeśli później startuje inny Kilo, użyj kontroli ścieżek poniżej i ustaw katalog LCM wcześniej w PATH.",
    setup:
      "Najpierw podłącz używanego na co dzień dostawcę i wybierz model. Conversation Memory jest domyślnie włączona. Sprawdź to w Settings → Experimental, a następnie otwórz Settings → Context; próg początkowy wynosi 40%. Modele niestandardowe wymagają dodatnich limitów kontekstu i wyjścia, natomiast limit wejścia jest opcjonalny.",
    ollama:
      "Dla Ollama użyj prawdziwego adresu serwera—zwykle localhost:11434 na tym samym komputerze albo jego adresu LAN z innego urządzenia. Ollama musi nasłuchiwać pod tym adresem, firewall musi zezwalać, a num_ctx musi być co najmniej limitem kontekstu wpisanym w Kilo.",
    verify:
      "Rozpocznij rozmowę, wybierz dostawcę i model, a następnie uruchom /lcm status. Stan powinien mieć wartość enabled, a pojemność powinna być rozpoznana. Nagłówek zadania lub strona Context pokazuje wykorzystanie i działanie LCM. /compact uruchamia jeden ręczny cykl; krótka nowa rozmowa może nie mieć jeszcze nic do podsumowania.",
    tips: "Podsumowania używają wywołań modelu, więc mogą dodać trochę czasu i kosztu. Zacznij od 40%; obniż dla wcześniejszej pracy lub podnieś dla mniejszej liczby wywołań. Pamięć LCM należy do bieżącej rozmowy. Eksport kontekstu może zawierać poufne prompty i wyniki narzędzi.",
    trouble:
      "Przy lcm_capacity_unknown wpisz limity kontekstu i wyjścia wybranego modelu niestandardowego. Jeśli rozszerzenie wraca po restarcie, wyłącz auto-update i zainstaluj VSIX ponownie. Przy złym CLI użyj which -a kilo lub where.exe kilo. Na Alpine wybierz musl, na starym x64 baseline.",
    update:
      "Aby zaktualizować, zainstaluj nowy VSIX na starym lub wymień rozpakowany katalog CLI. Rozmowy pozostają w bazie SQLite Kilo. Aby szybko wrócić, ustaw experimental.conversation_memory na false; możesz też ponownie zainstalować oficjalną wersję Kilo Code lub starszą wersję przedpremierową.",
    upstream:
      "Dalsza część strony opisuje oficjalną wersję Kilo Code. Zwykłe linki instalacyjne poniżej nie instalują tej wersji z LCM.",
  },
  ru: {
    title: "Попробуйте пререлиз LCM",
    intro:
      "Эта экспериментальная сборка Kilo Code помогает не терять нить в длинных чатах: старый уже использованный контекст превращается в дерево доступных для поиска сводок. Последние сообщения остаются без изменений, а агент при необходимости может восстановить прежние подробности.",
    warning:
      "Сборки с LCM распространяются только через GitHub Releases этого репозитория. Marketplace, Open VSX, npm, Homebrew, AUR, облачные сервисы и JetBrains устанавливают официальную версию Kilo Code без LCM.",
    paper: "Хотите понять идею? Прочитайте оригинальную статью LCM Клинта Эрлиха и Теодора Блэкмана.",
    choose: "Для VS Code или VSCodium выберите VSIX, для терминала — архив CLI. Можно установить оба варианта.",
    system:
      "В Windows откройте Settings → System → About → System type, в macOS — Apple menu → About This Mac, в Linux выполните uname -m. x86_64 или amd64 означает x64, arm64 или aarch64 — ARM64.",
    variants:
      "Большинство настольных дистрибутивов Linux использует glibc, а Alpine и небольшие контейнеры — musl. Вариант baseline нужен только для старого процессора x64 или если обычный CLI завершается с ошибкой illegal instruction. Отдельного VSIX в варианте baseline нет.",
    vscode:
      "Нужен VS Code или VSCodium 1.105.1 или новее. VSIX использует обычный ID расширения Kilo Code, поэтому заменяет установленную сборку Marketplace.",
    vscodeInstall:
      "Скачайте подходящий файл, отключите автообновление Kilo Code и выберите Extensions → … → Install from VSIX. После установки перезагрузите окно. Можно использовать и команды ниже.",
    cli: "Скачайте один архив из таблицы. Полностью распакуйте его в отдельную папку и оставьте все служебные файлы рядом с программой.",
    cliInstall:
      "Запустите распакованный файл до добавления папки в PATH. Если позже запускается другой Kilo, проверьте пути командами ниже и поставьте папку LCM раньше в PATH.",
    setup:
      "Сначала подключите привычного провайдера и выберите модель. Conversation Memory включена по умолчанию. Проверьте это в Settings → Experimental, затем откройте Settings → Context; начальный порог составляет 40%. Для пользовательских моделей нужны положительные лимиты контекста и вывода, а лимит ввода можно не указывать.",
    ollama:
      "Для Ollama укажите настоящий адрес сервера: обычно localhost:11434 на том же компьютере или его LAN-адрес с другого устройства. Ollama должна слушать этот адрес, firewall — разрешать доступ, а num_ctx модели должен быть не меньше лимита контекста в Kilo.",
    verify:
      "Начните чат, выберите провайдера и модель и выполните /lcm status. Статус должен быть enabled, а ёмкость — определена. Заголовок задачи или страница Context покажет использование контекста и работу LCM. /compact запускает один ручной цикл; в коротком новом чате пока может быть нечего сводить.",
    tips: "Для создания сводок вызывается модель, поэтому могут немного вырасти задержка и стоимость. Начните с 40%; уменьшите значение для более ранней обработки или увеличьте, чтобы сократить число вызовов. Память LCM относится только к текущему чату. Экспорт контекста может содержать конфиденциальные промпты и вывод инструментов.",
    trouble:
      "Если появился lcm_capacity_unknown, заполните лимиты контекста и вывода выбранной пользовательской модели. Если после перезапуска расширение переключается на другую версию, отключите автообновление и снова установите VSIX. Если запускается не тот CLI, проверьте which -a kilo или where.exe kilo. Для Alpine берите musl, для старого x64 — baseline.",
    update:
      "Для обновления установите новый VSIX поверх старого или замените распакованную папку CLI. Чаты останутся в SQLite Kilo. Для быстрого отката задайте experimental.conversation_memory значение false; также можно вернуть официальную версию Kilo Code или предыдущий пререлиз.",
    upstream:
      "Остальная страница описывает официальную версию Kilo Code. Обычные ссылки установки ниже не устанавливают эту версию с LCM.",
  },
  th: {
    title: "ลองใช้ LCM รุ่นก่อนเผยแพร่",
    intro:
      "Kilo Code รุ่นทดลองนี้ช่วยให้แชตยาวยังใช้งานได้ โดยเปลี่ยนบริบทเก่าที่ใช้แล้วเป็นต้นไม้สรุปที่ค้นหาได้ งานล่าสุดยังคงตรงตามต้นฉบับ และเอเจนต์ดึงรายละเอียดเก่ากลับมาได้เมื่อต้องการ",
    warning:
      "รุ่นที่มี LCM เปิดให้ดาวน์โหลดเฉพาะใน GitHub Releases ของคลังนี้เท่านั้น ส่วน Marketplace, Open VSX, npm, Homebrew, AUR, บริการคลาวด์ และ JetBrains จะติดตั้ง Kilo Code รุ่นทางการที่ไม่มี LCM",
    paper: "อยากรู้แนวคิดเบื้องหลังหรือไม่ อ่านงานวิจัย LCM ต้นฉบับโดย Clint Ehrlich และ Theodore Blackman",
    choose:
      "หากใช้ VS Code หรือ VSCodium ให้เลือกไฟล์ VSIX หากทำงานในเทอร์มินัลให้เลือกไฟล์บีบอัด CLI และสามารถติดตั้งทั้งสองแบบได้",
    system:
      "บน Windows ดู Settings → System → About → System type; บน macOS ดู Apple menu → About This Mac; บน Linux รัน uname -m โดย x86_64 หรือ amd64 คือ x64 ส่วน arm64 หรือ aarch64 คือ ARM64",
    variants:
      "Linux สำหรับเดสก์ท็อปส่วนใหญ่ใช้ glibc ส่วน Alpine และคอนเทนเนอร์ขนาดเล็กใช้ musl เลือก baseline เฉพาะโปรเซสเซอร์ x64 รุ่นเก่า หรือเมื่อ CLI ปกติหยุดด้วยข้อผิดพลาด illegal instruction เท่านั้น ไม่มีไฟล์ VSIX แบบ baseline แยกต่างหาก",
    vscode:
      "ต้องใช้ VS Code หรือ VSCodium 1.105.1 ขึ้นไป VSIX ใช้ extension ID เดียวกับ Kilo Code ปกติ จึงแทนที่รุ่น Marketplace ที่ติดตั้งอยู่",
    vscodeInstall:
      "ดาวน์โหลดไฟล์ที่ตรงกับเครื่อง ปิดการอัปเดตอัตโนมัติของ Kilo Code แล้วเลือก Extensions → … → Install from VSIX จากนั้น reload หน้าต่าง หรือใช้คำสั่งด้านล่าง",
    cli: "ดาวน์โหลด archive หนึ่งไฟล์จากตาราง แตกไฟล์ทั้งหมดไว้ใน folder แยก และเก็บไฟล์สนับสนุนทุกไฟล์ไว้ข้าง executable",
    cliInstall:
      "ลองรัน binary ที่แตกไฟล์แล้วหนึ่งครั้งก่อนเพิ่ม folder ลง PATH หากภายหลังเปิด Kilo คนละรุ่น ให้ใช้คำสั่งตรวจ path ด้านล่างและวาง folder LCM ไว้ก่อนใน PATH",
    setup:
      "เชื่อมต่อผู้ให้บริการที่ใช้เป็นประจำแล้วเลือกโมเดล Conversation Memory เปิดไว้โดยค่าเริ่มต้น ตรวจสอบได้ที่ Settings → Experimental จากนั้นเปิด Settings → Context โดยจุดเริ่มต้นตั้งไว้ที่ 40% โมเดลที่กำหนดเองต้องระบุขีดจำกัดบริบทและโทเค็นขาออกเป็นจำนวนบวก ส่วนขีดจำกัดขาเข้าไม่บังคับ",
    ollama:
      "สำหรับ Ollama ให้ใช้ที่อยู่ server จริง—มักเป็น localhost:11434 บนเครื่องเดียวกัน หรือ LAN address ของคอมพิวเตอร์เมื่อเชื่อมจากอุปกรณ์อื่น ตรวจว่า Ollama ฟังอยู่ที่ address นั้น firewall อนุญาต และ num_ctx ไม่น้อยกว่า context limit ที่ใส่ใน Kilo",
    verify:
      "เริ่มแชต เลือกผู้ให้บริการและโมเดล แล้วรัน /lcm status สถานะควรเป็น enabled และระบบควรรู้ความจุ ส่วนหัวงานหรือหน้า Context จะแสดงการใช้งานและกิจกรรมของ LCM คำสั่ง /compact จะเริ่มรอบ LCM ด้วยตนเองหนึ่งครั้ง แชตใหม่สั้น ๆ อาจยังไม่มีเนื้อหาให้สรุป",
    tips: "การสรุปต้องเรียกใช้โมเดล จึงอาจเพิ่มเวลาและค่าใช้จ่ายเล็กน้อย เริ่มที่ 40% ลดค่าหากต้องการให้จัดการเร็วขึ้น หรือเพิ่มค่าเพื่อลดจำนวนครั้งที่เรียกโมเดล หน่วยความจำ LCM เป็นของแชตปัจจุบัน การส่งออกบริบทอาจมีพรอมต์และผลลัพธ์จากเครื่องมือที่เป็นข้อมูลสำคัญ",
    trouble:
      "หากเห็น lcm_capacity_unknown ให้กรอก context และ output limit ของ custom model หาก extension เปลี่ยนกลับหลัง restart ให้ปิด auto-update และติดตั้ง VSIX ใหม่ หาก CLI ผิดรุ่นให้ดู which -a kilo หรือ where.exe kilo บน Alpine ใช้ musl; CPU x64 เก่าให้ลอง baseline",
    update:
      "อัปเดตได้โดยติดตั้ง VSIX ใหม่ทับของเดิม หรือเปลี่ยนโฟลเดอร์ CLI ที่แตกไฟล์ไว้ แชตยังคงอยู่ใน SQLite ของ Kilo หากต้องย้อนกลับอย่างรวดเร็ว ให้ตั้ง experimental.conversation_memory เป็น false หรือกลับไปติดตั้ง Kilo Code รุ่นทางการหรือรุ่นก่อนเผยแพร่ที่เก่ากว่า",
    upstream:
      "เนื้อหาที่เหลือของหน้านี้อธิบาย Kilo Code รุ่นทางการ ลิงก์ติดตั้งทั่วไปด้านล่างจะไม่ติดตั้งรุ่นที่มี LCM นี้",
  },
  tr: {
    title: "LCM ön sürümünü deneyin",
    intro:
      "Bu deneysel Kilo Code derlemesi, kullanılmış eski bağlamı aranabilir bir özet ağacına dönüştürerek uzun sohbetleri kullanışlı tutar. Son çalışmalarınız aynen kalır; ajan gerektiğinde eski ayrıntıları geri getirebilir.",
    warning:
      "LCM içeren derlemeler yalnızca bu deponun GitHub Releases bölümünden dağıtılır. Marketplace, Open VSX, npm, Homebrew, AUR, bulut hizmetleri ve JetBrains üzerinden yapılan kurulumlar LCM içermeyen resmî Kilo Code sürümünü yükler.",
    paper: "Fikrin kaynağını mı merak ediyorsunuz? Clint Ehrlich ve Theodore Blackman'ın özgün LCM makalesini okuyun.",
    choose: "VS Code veya VSCodium için VSIX, terminal için CLI arşivi seçin. İkisini birden kurabilirsiniz.",
    system:
      "Windows'ta Settings → System → About → System type; macOS'ta Apple menu → About This Mac bölümüne bakın; Linux'ta uname -m çalıştırın. x86_64 veya amd64 x64, arm64 veya aarch64 ARM64 demektir.",
    variants:
      "Çoğu masaüstü Linux dağıtımı glibc, Alpine ve küçük konteynerler ise musl kullanır. baseline seçeneğini yalnızca eski bir x64 işlemci için veya normal CLI illegal instruction hatasıyla kapanırsa kullanın. Ayrı bir baseline VSIX yoktur.",
    vscode:
      "VS Code veya VSCodium 1.105.1 ya da daha yenisi gerekir. VSIX normal Kilo Code uzantı kimliğini kullanır ve kurulu Marketplace sürümünün yerini alır.",
    vscodeInstall:
      "Doğru dosyayı indirin, Kilo Code otomatik güncellemesini kapatın ve Extensions → … → Install from VSIX seçeneğini kullanın. Ardından pencereyi yenileyin. Aşağıdaki komutlardan birini de kullanabilirsiniz.",
    cli: "Tablodan bir arşiv indirin. Arşivin tamamını ayrı bir klasöre çıkarın ve bütün destek dosyalarını çalıştırılabilir dosyanın yanında tutun.",
    cliInstall:
      "Klasörü PATH'e eklemeden önce çıkarılan programı bir kez çalıştırın. Sonra başka Kilo açılırsa aşağıdaki yol kontrollerini kullanın ve LCM klasörünü PATH'te öne alın.",
    setup:
      "Önce her zamanki sağlayıcınızı bağlayın ve bir model seçin. Conversation Memory varsayılan olarak açıktır. Bunu Settings → Experimental bölümünde kontrol edin, ardından Settings → Context bölümünü açın; başlangıç eşiği %40'tır. Özel modellerde bağlam ve çıktı sınırları pozitif olmalıdır; giriş sınırı isteğe bağlıdır.",
    ollama:
      "Ollama için gerçek sunucu adresini kullanın—aynı makinede genellikle localhost:11434, başka cihazdan bilgisayarın LAN adresi. Ollama bu adreste dinlemeli, firewall izin vermeli ve num_ctx Kilo'ya girilen context limitinden küçük olmamalıdır.",
    verify:
      "Bir sohbet başlatın, sağlayıcıyı ve modeli seçin, ardından /lcm status çalıştırın. Durum enabled, kapasite ise biliniyor olmalıdır. Görev başlığı veya Context sayfası kullanımı ve LCM etkinliğini gösterir. /compact bir manuel LCM döngüsü başlatır; kısa ve yeni bir sohbette henüz özetlenecek bir şey olmayabilir.",
    tips: "Özetleme model çağrıları kullanır; biraz gecikme ve maliyet ekleyebilir. %40 ile başlayın; daha erken bakım için azaltın, daha az çağrı için artırın. LCM belleği mevcut sohbete aittir. Context export hassas prompt ve araç çıktıları içerebilir.",
    trouble:
      "lcm_capacity_unknown görürseniz seçili özel modelin context ve output limitlerini girin. Uzantı yeniden başlatınca değişirse auto-update'i kapatıp VSIX'i yeniden kurun. Yanlış CLI için which -a kilo veya where.exe kilo kullanın. Alpine'da musl, eski x64'te baseline deneyin.",
    update:
      "Güncellemek için yeni VSIX'i eskisinin üstüne kurun veya çıkarılmış CLI klasörünü değiştirin. Sohbetler Kilo SQLite veritabanında kalır. Hızlıca geri dönmek için experimental.conversation_memory değerini false yapın; resmî Kilo Code sürümünü veya daha eski bir ön sürümü de yeniden kurabilirsiniz.",
    upstream:
      "Sayfanın geri kalanı resmî Kilo Code sürümünü anlatır. Aşağıdaki normal kurulum bağlantıları bu LCM sürümünü kurmaz.",
  },
  uk: {
    title: "Спробуйте передрелізну версію LCM",
    intro:
      "Ця експериментальна збірка Kilo Code допомагає не втрачати нитку в довгих чатах: старий уже використаний контекст перетворюється на дерево підсумків із пошуком. Останні повідомлення лишаються без змін, а агент за потреби може відновити попередні подробиці.",
    warning:
      "Збірки з LCM поширюються лише через GitHub Releases цього репозиторію. Marketplace, Open VSX, npm, Homebrew, AUR, хмарні сервіси та JetBrains встановлюють офіційну версію Kilo Code без LCM.",
    paper: "Хочете зрозуміти ідею? Прочитайте оригінальну статтю LCM Клінта Ерліха й Теодора Блекмана.",
    choose: "Для VS Code або VSCodium виберіть VSIX, для термінала — архів CLI. Можна встановити обидва.",
    system:
      "У Windows відкрийте Settings → System → About → System type, у macOS — Apple menu → About This Mac, у Linux виконайте uname -m. x86_64 або amd64 означає x64, arm64 або aarch64 — ARM64.",
    variants:
      "Більшість настільних дистрибутивів Linux використовує glibc, а Alpine і невеликі контейнери — musl. Варіант baseline потрібен лише для старого процесора x64 або коли звичайний CLI завершується з помилкою illegal instruction. Окремого VSIX у варіанті baseline немає.",
    vscode:
      "Потрібен VS Code або VSCodium 1.105.1 чи новіший. VSIX використовує звичайний ID розширення Kilo Code, тому замінює встановлену Marketplace-версію.",
    vscodeInstall:
      "Завантажте відповідний файл, вимкніть автоматичне оновлення Kilo Code і виберіть Extensions → … → Install from VSIX. Потім перезавантажте вікно. Можна також скористатися командами нижче.",
    cli: "Завантажте один архів із таблиці. Повністю розпакуйте його в окрему папку й залиште всі службові файли поруч із програмою.",
    cliInstall:
      "Запустіть розпакований файл до додавання папки в PATH. Якщо пізніше запускається інший Kilo, перевірте шляхи командами нижче й поставте папку LCM раніше в PATH.",
    setup:
      "Спершу під'єднайте звичного провайдера й виберіть модель. Conversation Memory увімкнена за замовчуванням. Перевірте це в Settings → Experimental, а потім відкрийте Settings → Context; початковий поріг становить 40%. Для власних моделей потрібні додатні ліміти контексту й виводу, а ліміт вводу можна не вказувати.",
    ollama:
      "Для Ollama вкажіть справжню адресу сервера: зазвичай localhost:11434 на тому ж комп'ютері або його LAN-адресу з іншого пристрою. Ollama має слухати цю адресу, firewall — дозволяти доступ, а num_ctx моделі має бути не меншим за ліміт контексту в Kilo.",
    verify:
      "Почніть чат, виберіть провайдера й модель і виконайте /lcm status. Стан має бути enabled, а місткість — визначена. Заголовок завдання або сторінка Context покаже використання контексту й роботу LCM. /compact запускає один ручний цикл; у короткому новому чаті поки може не бути чого підсумовувати.",
    tips: "Для створення підсумків викликається модель, тому можуть трохи зрости затримка й вартість. Почніть із 40%; зменште значення для ранішої обробки або збільште, щоб скоротити кількість викликів. Пам'ять LCM належить лише поточному чату. Експорт контексту може містити конфіденційні промпти й вивід інструментів.",
    trouble:
      "За lcm_capacity_unknown заповніть ліміти контексту й виводу вибраної власної моделі. Якщо після перезапуску розширення замінилося, вимкніть auto-update і знову встановіть VSIX. За неправильного CLI перевірте which -a kilo або where.exe kilo. Для Alpine беріть musl, для старого x64 — baseline.",
    update:
      "Для оновлення встановіть новий VSIX поверх старого або замініть розпаковану папку CLI. Чати лишаться в SQLite Kilo. Для швидкого відкату задайте experimental.conversation_memory значення false; також можна повернути офіційну версію Kilo Code або старішу передрелізну версію.",
    upstream:
      "Решта сторінки описує офіційну версію Kilo Code. Звичайні посилання встановлення нижче не встановлюють цю версію з LCM.",
  },
  vi: {
    title: "Dùng thử bản phát hành trước LCM",
    intro:
      "Bản Kilo Code thử nghiệm này giúp bạn không mất mạch trong những cuộc trò chuyện dài: ngữ cảnh cũ đã dùng được gom thành cây tóm tắt có thể tìm kiếm. Nội dung gần đây vẫn được giữ nguyên, còn trợ lý có thể lấy lại các chi tiết trước đó khi cần.",
    warning:
      "Bản có LCM chỉ được phát hành trong mục GitHub Releases của kho mã này. Marketplace, Open VSX, npm, Homebrew, AUR, dịch vụ đám mây và JetBrains sẽ cài bản Kilo Code chính thức, không có LCM.",
    paper: "Muốn hiểu ý tưởng? Hãy đọc bài báo LCM gốc của Clint Ehrlich và Theodore Blackman.",
    choose:
      "Chọn VSIX nếu dùng VS Code hoặc VSCodium. Chọn gói CLI nếu làm việc trong terminal. Bạn có thể cài cả hai.",
    system:
      "Trên Windows xem Settings → System → About → System type; trên macOS xem Apple menu → About This Mac; trên Linux chạy uname -m. x86_64 hoặc amd64 là x64, còn arm64 hoặc aarch64 là ARM64.",
    variants:
      "Phần lớn bản phân phối Linux cho máy tính để bàn dùng glibc; Alpine và các container nhỏ dùng musl. Chỉ chọn baseline cho bộ xử lý x64 cũ hoặc khi CLI thông thường dừng với lỗi illegal instruction. Không có VSIX baseline riêng.",
    vscode:
      "Cần VS Code hoặc VSCodium 1.105.1 trở lên. VSIX dùng cùng extension ID với Kilo Code thường nên sẽ thay thế bản Marketplace đã cài.",
    vscodeInstall:
      "Tải đúng file, tắt tự động cập nhật Kilo Code rồi chọn Extensions → … → Install from VSIX. Reload cửa sổ sau khi cài. Bạn cũng có thể dùng lệnh bên dưới.",
    cli: "Tải một gói trong bảng. Giải nén toàn bộ vào folder riêng và giữ mọi file hỗ trợ bên cạnh file chạy.",
    cliInstall:
      "Chạy binary đã giải nén một lần trước khi thêm folder vào PATH. Nếu sau đó một Kilo khác chạy, dùng lệnh kiểm tra đường dẫn bên dưới và đặt folder LCM sớm hơn trong PATH.",
    setup:
      "Trước tiên, hãy kết nối nhà cung cấp bạn thường dùng và chọn một mô hình. Conversation Memory được bật mặc định. Kiểm tra trong Settings → Experimental, rồi mở Settings → Context; ngưỡng khởi động ban đầu là 40%. Mô hình tùy chỉnh cần giới hạn ngữ cảnh và đầu ra lớn hơn 0; giới hạn đầu vào là tùy chọn.",
    ollama:
      "Với Ollama, dùng địa chỉ server thật—thường là localhost:11434 trên cùng máy hoặc địa chỉ LAN của máy tính từ thiết bị khác. Đảm bảo Ollama lắng nghe ở đó, firewall cho phép và num_ctx ít nhất bằng giới hạn context đã nhập trong Kilo.",
    verify:
      "Bắt đầu một cuộc trò chuyện, chọn nhà cung cấp và mô hình rồi chạy /lcm status. Trạng thái phải là enabled và dung lượng phải được nhận diện. Phần đầu tác vụ hoặc trang Context hiển thị mức sử dụng và hoạt động của LCM. /compact chạy một vòng LCM thủ công; cuộc trò chuyện mới và ngắn có thể chưa có gì để tóm tắt.",
    tips: "Việc tóm tắt cần gọi mô hình nên có thể tốn thêm một chút thời gian và chi phí. Hãy bắt đầu với 40%; giảm xuống để xử lý sớm hơn hoặc tăng lên để giảm số lần gọi. Bộ nhớ LCM chỉ thuộc cuộc trò chuyện hiện tại. Bản xuất ngữ cảnh có thể chứa câu lệnh và kết quả công cụ nhạy cảm.",
    trouble:
      "Nếu thấy lcm_capacity_unknown, điền giới hạn context và output của custom model đã chọn. Nếu extension đổi lại sau khi restart, tắt auto-update và cài lại VSIX. Nếu sai CLI, kiểm tra which -a kilo hoặc where.exe kilo. Trên Alpine dùng musl; CPU x64 cũ thử baseline.",
    update:
      "Để cập nhật, cài VSIX mới đè lên bản cũ hoặc thay thư mục CLI đã giải nén. Cuộc trò chuyện vẫn nằm trong SQLite của Kilo. Để quay lại nhanh, đặt experimental.conversation_memory thành false; bạn cũng có thể cài lại bản Kilo Code chính thức hoặc một bản phát hành trước cũ hơn.",
    upstream:
      "Phần còn lại của trang mô tả bản Kilo Code chính thức. Các liên kết cài đặt thông thường bên dưới không cài bản có LCM này.",
  },
  zh: {
    title: "试用 LCM 预发行版",
    intro:
      "这个实验版 Kilo Code 会把已经使用过的旧上下文变成可搜索的摘要树，让长对话继续保持实用。最近的工作会原样保留，代理需要时也能找回早期细节。",
    warning:
      "带 LCM 的版本仅通过本仓库的 GitHub Releases 发布。从 Marketplace、Open VSX、npm、Homebrew、AUR、云服务或 JetBrains 安装的都是不含 LCM 的 Kilo Code 官方版。",
    paper: "想了解背后的思路？请阅读 Clint Ehrlich 和 Theodore Blackman 的 LCM 原始论文。",
    choose: "使用 VS Code 或 VSCodium 时选择 VSIX；在终端工作时选择 CLI 压缩包。两者可以同时安装。",
    system:
      "Windows 请查看 Settings → System → About → System type；macOS 请查看 Apple menu → About This Mac；Linux 请运行 uname -m。x86_64 或 amd64 表示 x64，arm64 或 aarch64 表示 ARM64。",
    variants:
      "大多数 Linux 桌面使用 glibc；Alpine 和一些小型容器使用 musl。仅当 x64 CPU 较旧，或普通 CLI 因 illegal instruction 退出时选择 baseline；没有单独的 baseline VSIX。",
    vscode:
      "需要 VS Code 或 VSCodium 1.105.1 或更高版本。VSIX 使用普通 Kilo Code 的扩展 ID，因此会替换已安装的 Marketplace 版本。",
    vscodeInstall:
      "下载匹配的文件，关闭 Kilo Code 自动更新，然后选择 Extensions → … → Install from VSIX。安装后重新加载窗口。也可以使用下面的命令。",
    cli: "从表格中下载一个压缩包。把整个压缩包解压到独立文件夹，并让所有支持文件和可执行文件保持在一起。",
    cliInstall:
      "将文件夹加入 PATH 前，先运行一次解压后的程序。如果之后启动了其他 Kilo，请用下面的命令检查路径，并把 LCM 文件夹放到 PATH 更靠前的位置。",
    setup:
      "先连接你常用的服务商并选择模型。Conversation Memory 默认开启，可在 Settings → Experimental 中确认。然后打开 Settings → Context；默认从 40% 开始处理。自定义模型的上下文上限和输出令牌上限必须为正数，输入上限可以不填。",
    ollama:
      "Ollama 请填写真实服务器地址：同一台机器通常是 localhost:11434，其他设备则使用电脑的 LAN 地址。确认 Ollama 在该地址监听、firewall 允许访问，而且 model 的 num_ctx 不小于 Kilo 中填写的 context limit。",
    verify:
      "开始聊天，选择服务商和模型，然后运行 /lcm status。状态应为 enabled，并且容量已识别。任务标题或 Context 页面会显示上下文用量和 LCM 活动。/compact 会手动运行一次 LCM；较短的新聊天可能还没有内容可摘要。",
    tips: "生成摘要需要调用模型，因此可能增加少量延迟和费用。建议先用 40%；想更早处理可调低，想减少调用可调高。LCM 记忆仅属于当前聊天。上下文导出可能包含敏感的提示词和工具输出，请像保护聊天内容一样妥善保管。",
    trouble:
      "看到 lcm_capacity_unknown 时，请填写所选自定义 model 的 context 和 output limit。如果重启后扩展变回其他版本，请关闭 auto-update 并重新安装 VSIX。如果 CLI 版本不对，请检查 which -a kilo 或 where.exe kilo。Alpine 使用 musl；旧 x64 CPU 尝试 baseline。",
    update:
      "更新时，在旧版上安装新版 VSIX，或替换已解压的 CLI 文件夹。聊天仍保存在 Kilo 的 SQLite 中。要快速回退，把 experimental.conversation_memory 设为 false；也可以重新安装 Kilo Code 官方版或较早的预发行版。",
    upstream: "本页其余内容介绍 Kilo Code 官方版。下方的常规安装链接不会安装这个带 LCM 的版本。",
  },
  zht: {
    title: "試用 LCM 預發行版",
    intro:
      "這個實驗版 Kilo Code 會把已使用的舊內容轉成可搜尋的摘要樹，讓長對話繼續實用。最近的工作會原樣保留，代理需要時也能找回較早的細節。",
    warning:
      "含有 LCM 的版本只會透過本儲存庫的 GitHub Releases 發布。從 Marketplace、Open VSX、npm、Homebrew、AUR、雲端服務或 JetBrains 安裝的，都是不含 LCM 的 Kilo Code 官方版。",
    paper: "想了解背後的想法？請閱讀 Clint Ehrlich 與 Theodore Blackman 的 LCM 原始論文。",
    choose: "使用 VS Code 或 VSCodium 時選 VSIX；在終端機工作時選 CLI 壓縮檔。兩者可以同時安裝。",
    system:
      "Windows 請查看 Settings → System → About → System type；macOS 請查看 Apple menu → About This Mac；Linux 請執行 uname -m。x86_64 或 amd64 代表 x64，arm64 或 aarch64 代表 ARM64。",
    variants:
      "大多數 Linux 桌面使用 glibc；Alpine 和小型 container 使用 musl。只有舊 x64 CPU，或一般 CLI 因 illegal instruction 結束時才選 baseline；沒有獨立的 baseline VSIX。",
    vscode:
      "需要 VS Code 或 VSCodium 1.105.1 或更新版本。VSIX 使用一般 Kilo Code 的 extension ID，因此會取代已安裝的 Marketplace 版本。",
    vscodeInstall:
      "下載相符檔案，關閉 Kilo Code 自動更新，再選 Extensions → … → Install from VSIX。安裝後重新載入視窗。也可使用下方指令。",
    cli: "從表格下載一個壓縮檔。把整個壓縮檔解壓縮到獨立資料夾，並讓所有支援檔案留在執行檔旁。",
    cliInstall:
      "把資料夾加入 PATH 前，先執行一次解壓縮的程式。若之後啟動了其他 Kilo，請用下方指令檢查路徑，並把 LCM 資料夾放在 PATH 前面。",
    setup:
      "先連接常用的服務供應商並選擇模型。Conversation Memory 預設開啟，可在 Settings → Experimental 中確認。接著開啟 Settings → Context；預設會從 40% 開始處理。自訂模型的內容上限與輸出權杖上限必須是正數，輸入上限可不填。",
    ollama:
      "Ollama 請填真實 server 位址：同一台機器通常是 localhost:11434，其他裝置則用電腦的 LAN 位址。確認 Ollama 在該位址監聽、firewall 允許連線，且 model 的 num_ctx 不小於 Kilo 中填入的 context limit。",
    verify:
      "開始聊天，選擇服務供應商和模型，再執行 /lcm status。狀態應為 enabled，而且系統已識別容量。工作標題或 Context 頁面會顯示內容用量與 LCM 活動。/compact 會手動執行一次 LCM；較短的新聊天可能還沒有內容可摘要。",
    tips: "產生摘要需要呼叫模型，因此可能增加少量等待和費用。建議先用 40%；想提早處理就調低，想減少呼叫就調高。LCM 記憶只屬於目前聊天。內容匯出可能含有敏感的提示詞與工具輸出，請像保護聊天內容一樣妥善保管。",
    trouble:
      "看到 lcm_capacity_unknown 時，請填入所選自訂 model 的 context 與 output limit。若重啟後 extension 變回其他版本，請關閉 auto-update 並重裝 VSIX。若 CLI 版本不對，請檢查 which -a kilo 或 where.exe kilo。Alpine 使用 musl；舊 x64 CPU 可試 baseline。",
    update:
      "更新時，在舊版上安裝新版 VSIX，或替換已解壓縮的 CLI 資料夾。聊天仍保存在 Kilo 的 SQLite。要快速還原，把 experimental.conversation_memory 設為 false；也可重裝 Kilo Code 官方版或較舊的預發行版。",
    upstream: "本頁其餘內容介紹 Kilo Code 官方版。下方的一般安裝連結不會安裝這個含 LCM 的版本。",
  },
}

const onboardingLabels = {
  en: [
    "Pick what to download",
    "Find your system",
    "VS Code / VSCodium",
    "CLI",
    "Set up Kilo and LCM",
    "Ollama",
    "Check that it works",
    "A few useful tips",
    "Quick fixes",
    "Update or roll back",
    "System",
    "Asset",
    "Current prerelease",
  ],
  ar: [
    "اختر ما ستنزله",
    "اعرف نظامك",
    "VS Code / VSCodium",
    "CLI",
    "إعداد Kilo وLCM",
    "Ollama",
    "تأكد أنه يعمل",
    "نصائح مفيدة",
    "حلول سريعة",
    "التحديث أو الرجوع",
    "النظام",
    "الملف",
    "الإصدار التجريبي الحالي",
  ],
  bn: [
    "কোনটি ডাউনলোড করবেন",
    "আপনার system চিনুন",
    "VS Code / VSCodium",
    "CLI",
    "Kilo ও LCM setup",
    "Ollama",
    "কাজ করছে কি না দেখুন",
    "কিছু দরকারি tip",
    "দ্রুত সমাধান",
    "Update বা rollback",
    "System",
    "Asset",
    "বর্তমান prerelease",
  ],
  br: [
    "Escolha o download",
    "Descubra seu sistema",
    "VS Code / VSCodium",
    "CLI",
    "Configure Kilo e LCM",
    "Ollama",
    "Confira se funciona",
    "Algumas dicas",
    "Correções rápidas",
    "Atualize ou volte",
    "Sistema",
    "Arquivo",
    "Prévia atual",
  ],
  bs: [
    "Izaberite preuzimanje",
    "Provjerite sistem",
    "VS Code / VSCodium",
    "CLI",
    "Podesite Kilo i LCM",
    "Ollama",
    "Provjerite rad",
    "Korisni savjeti",
    "Brza rješenja",
    "Nadogradnja ili vraćanje",
    "Sistem",
    "Fajl",
    "Trenutno predizdanje",
  ],
  da: [
    "Vælg download",
    "Find dit system",
    "VS Code / VSCodium",
    "CLI",
    "Opsæt Kilo og LCM",
    "Ollama",
    "Kontrollér at det virker",
    "Nyttige tips",
    "Hurtige løsninger",
    "Opdatér eller rul tilbage",
    "System",
    "Fil",
    "Aktuel prerelease",
  ],
  de: [
    "Download auswählen",
    "System bestimmen",
    "VS Code / VSCodium",
    "CLI",
    "Kilo und LCM einrichten",
    "Ollama",
    "Funktion prüfen",
    "Nützliche Tipps",
    "Schnelle Lösungen",
    "Aktualisieren oder zurückrollen",
    "System",
    "Datei",
    "Aktuelle Prerelease",
  ],
  es: [
    "Elige la descarga",
    "Identifica tu sistema",
    "VS Code / VSCodium",
    "CLI",
    "Configura Kilo y LCM",
    "Ollama",
    "Comprueba que funciona",
    "Consejos útiles",
    "Soluciones rápidas",
    "Actualiza o vuelve atrás",
    "Sistema",
    "Archivo",
    "Versión preliminar actual",
  ],
  fr: [
    "Choisir le téléchargement",
    "Identifier votre système",
    "VS Code / VSCodium",
    "CLI",
    "Configurer Kilo et LCM",
    "Ollama",
    "Vérifier le fonctionnement",
    "Conseils utiles",
    "Solutions rapides",
    "Mettre à jour ou revenir",
    "Système",
    "Fichier",
    "Préversion actuelle",
  ],
  gr: [
    "Επιλέξτε λήψη",
    "Βρείτε το σύστημά σας",
    "VS Code / VSCodium",
    "CLI",
    "Ρύθμιση Kilo και LCM",
    "Ollama",
    "Έλεγχος λειτουργίας",
    "Χρήσιμες συμβουλές",
    "Γρήγορες λύσεις",
    "Αναβάθμιση ή επιστροφή",
    "Σύστημα",
    "Αρχείο",
    "Τρέχουσα προέκδοση",
  ],
  it: [
    "Scegli il download",
    "Trova il tuo sistema",
    "VS Code / VSCodium",
    "CLI",
    "Configura Kilo e LCM",
    "Ollama",
    "Controlla che funzioni",
    "Consigli utili",
    "Soluzioni rapide",
    "Aggiorna o torna indietro",
    "Sistema",
    "File",
    "Prerelease attuale",
  ],
  ja: [
    "ダウンロードを選ぶ",
    "システムを確認",
    "VS Code / VSCodium",
    "CLI",
    "Kilo と LCM の設定",
    "Ollama",
    "動作確認",
    "便利なヒント",
    "すぐできる対処",
    "更新またはロールバック",
    "システム",
    "ファイル",
    "現在のプレリリース",
  ],
  ko: [
    "다운로드 선택",
    "시스템 확인",
    "VS Code / VSCodium",
    "CLI",
    "Kilo와 LCM 설정",
    "Ollama",
    "작동 확인",
    "유용한 팁",
    "빠른 해결",
    "업데이트 또는 되돌리기",
    "시스템",
    "파일",
    "현재 프리릴리스",
  ],
  no: [
    "Velg nedlasting",
    "Finn systemet ditt",
    "VS Code / VSCodium",
    "CLI",
    "Sett opp Kilo og LCM",
    "Ollama",
    "Kontroller at det virker",
    "Nyttige tips",
    "Raske løsninger",
    "Oppdater eller rull tilbake",
    "System",
    "Fil",
    "Gjeldende forhåndsversjon",
  ],
  pl: [
    "Wybierz plik",
    "Sprawdź system",
    "VS Code / VSCodium",
    "CLI",
    "Skonfiguruj Kilo i LCM",
    "Ollama",
    "Sprawdź działanie",
    "Przydatne wskazówki",
    "Szybkie rozwiązania",
    "Aktualizacja lub powrót",
    "System",
    "Plik",
    "Bieżąca wersja",
  ],
  ru: [
    "Выберите загрузку",
    "Определите систему",
    "VS Code / VSCodium",
    "CLI",
    "Настройте Kilo и LCM",
    "Ollama",
    "Проверьте работу",
    "Полезные советы",
    "Быстрые решения",
    "Обновление или откат",
    "Система",
    "Файл",
    "Текущий пререлиз",
  ],
  th: [
    "เลือกไฟล์ดาวน์โหลด",
    "ตรวจระบบของคุณ",
    "VS Code / VSCodium",
    "CLI",
    "ตั้งค่า Kilo และ LCM",
    "Ollama",
    "ตรวจว่าใช้งานได้",
    "เคล็ดลับ",
    "วิธีแก้ด่วน",
    "อัปเดตหรือย้อนกลับ",
    "ระบบ",
    "ไฟล์",
    "รุ่นปัจจุบัน",
  ],
  tr: [
    "İndirmeyi seçin",
    "Sisteminizi bulun",
    "VS Code / VSCodium",
    "CLI",
    "Kilo ve LCM kurulumu",
    "Ollama",
    "Çalıştığını doğrulayın",
    "Faydalı ipuçları",
    "Hızlı çözümler",
    "Güncelleme veya geri dönüş",
    "Sistem",
    "Dosya",
    "Güncel ön sürüm",
  ],
  uk: [
    "Виберіть завантаження",
    "Визначте систему",
    "VS Code / VSCodium",
    "CLI",
    "Налаштуйте Kilo й LCM",
    "Ollama",
    "Перевірте роботу",
    "Корисні поради",
    "Швидкі рішення",
    "Оновлення або відкат",
    "Система",
    "Файл",
    "Поточна версія",
  ],
  vi: [
    "Chọn file tải",
    "Xác định hệ thống",
    "VS Code / VSCodium",
    "CLI",
    "Thiết lập Kilo và LCM",
    "Ollama",
    "Kiểm tra hoạt động",
    "Mẹo hữu ích",
    "Cách sửa nhanh",
    "Cập nhật hoặc quay lại",
    "Hệ thống",
    "File",
    "Bản hiện tại",
  ],
  zh: [
    "选择下载文件",
    "确认系统",
    "VS Code / VSCodium",
    "CLI",
    "设置 Kilo 和 LCM",
    "Ollama",
    "检查是否正常",
    "实用提示",
    "快速排查",
    "更新或回退",
    "系统",
    "文件",
    "当前预发行版",
  ],
  zht: [
    "選擇下載檔案",
    "確認系統",
    "VS Code / VSCodium",
    "CLI",
    "設定 Kilo 和 LCM",
    "Ollama",
    "檢查是否正常",
    "實用提示",
    "快速排解",
    "更新或回復",
    "系統",
    "檔案",
    "目前預發行版",
  ],
}

const onboardingCompaction = {
  en: "compaction.auto controls only Kilo's older compaction system while LCM is enabled; it does not switch LCM off.",
  ar: "يتحكم compaction.auto فقط في نظام الضغط القديم في Kilo أثناء تفعيل LCM، ولا يوقف LCM.",
  bn: "LCM চালু থাকলে compaction.auto শুধু Kilo-এর পুরোনো compaction ব্যবস্থা নিয়ন্ত্রণ করে; এটি LCM বন্ধ করে না।",
  br: "Com LCM ativo, compaction.auto controla apenas o sistema antigo de compactação do Kilo; ele não desliga o LCM.",
  bs: "Dok je LCM uključen, compaction.auto upravlja samo starim Kilo sistemom sažimanja; ne isključuje LCM.",
  da: "Når LCM er aktiv, styrer compaction.auto kun Kilos ældre komprimeringssystem; det slår ikke LCM fra.",
  de: "Bei aktivem LCM steuert compaction.auto nur Kilos älteres Kompaktierungssystem; es schaltet LCM nicht aus.",
  es: "Con LCM activo, compaction.auto solo controla el sistema anterior de compactación de Kilo; no desactiva LCM.",
  fr: "Quand LCM est actif, compaction.auto ne contrôle que l'ancien système de compactage de Kilo ; il ne désactive pas LCM.",
  gr: "Με ενεργό LCM, το compaction.auto ελέγχει μόνο το παλιό σύστημα συμπίεσης του Kilo· δεν απενεργοποιεί το LCM.",
  it: "Con LCM attivo, compaction.auto controlla solo il vecchio sistema di compattazione di Kilo; non disattiva LCM.",
  ja: "LCM が有効な間、compaction.auto は Kilo の旧 compaction 機能だけを制御し、LCM 自体はオフにしません。",
  ko: "LCM이 켜진 동안 compaction.auto는 Kilo의 기존 compaction 기능만 제어하며 LCM을 끄지는 않습니다.",
  no: "Når LCM er aktivt, styrer compaction.auto bare Kilos eldre komprimeringssystem; det slår ikke av LCM.",
  pl: "Gdy LCM jest włączone, compaction.auto steruje tylko starszym systemem kompaktowania Kilo; nie wyłącza LCM.",
  ru: "При включённом LCM параметр compaction.auto управляет только старой системой сжатия Kilo и не отключает LCM.",
  th: "เมื่อเปิด LCM ค่า compaction.auto จะควบคุมเฉพาะระบบย่อบริบทแบบเก่าของ Kilo และไม่ได้ปิด LCM",
  tr: "LCM açıkken compaction.auto yalnızca Kilo'nun eski sıkıştırma sistemini yönetir; LCM'i kapatmaz.",
  uk: "Коли LCM увімкнено, compaction.auto керує лише старою системою стиснення Kilo й не вимикає LCM.",
  vi: "Khi LCM bật, compaction.auto chỉ điều khiển hệ thống nén cũ của Kilo; nó không tắt LCM.",
  zh: "启用 LCM 时，compaction.auto 只控制 Kilo 旧的压缩系统，不会关闭 LCM。",
  zht: "啟用 LCM 時，compaction.auto 只控制 Kilo 舊的壓縮系統，不會關閉 LCM。",
}

const readmeLocales = new Map([
  ["README.md", "en"],
  ...LCM_PRERELEASE_TRANSLATIONS.map((file) => [file, /README\.([^.]+)\.md$/.exec(file)?.[1]]),
])

export const LCM_PREVIOUS_PRERELEASE_TAG = "v7.4.23-lcm.11"
export const LCM_CURRENT_PRERELEASE_TAG = "v7.4.23-lcm.12"
export const LCM_PRERELEASE_CHANGELOG = [
  {
    title: "One bounded exact search across a complete semantic unit",
    body: "`lcm_grep` now accepts the same ordered 1–32 `sourceRanges` scope as `lcm_expand_query`. A model can search or count across a structurally bounded document, episode, or section in one call instead of fanning out over transport records. The tool preserves supplied range order, reports effective bounds, deduplicates source-record totals across multiple intervals, and keeps literal complete-scope totals exact even when returned occurrence excerpts are bounded.",
  },
  {
    title: "More resilient semantic recovery",
    body: "`lcm_expand_query` may retry once after a transient provider failure, matching the bounded retry already used for summary generation. Its descriptions now direct one complete scoped query followed by only the decisive bounded grep/read verification, reducing open-ended recovery chains without imposing a model-specific call cap.",
  },
  {
    title: "Honest completeness reporting",
    body: "A generated query answer that claims `full` coverage is downgraded to `partial` whenever retrieval omitted or clipped in-scope evidence. Models can still use the cited candidate, but cannot mistake it for proof of an exhaustive count, first/last event, or complete list.",
  },
]

export function validateTranslationReadmePaths(files) {
  const actual = [...files].sort()
  const expected = [...LCM_PRERELEASE_TRANSLATIONS].sort()
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    const wanted = new Set(expected)
    const found = new Set(actual)
    const missing = expected.filter((file) => !found.has(file))
    const extra = actual.filter((file) => !wanted.has(file))
    throw new Error(`LCM onboarding translation set changed: missing=[${missing}] extra=[${extra}]`)
  }
  return actual
}

function renderAssetTable(labels, rows) {
  return [`|${labels[10]}|${labels[11]}|`, "|---|---|", ...rows.map(([system, asset]) => `|${system}|\`${asset}\`|`)]
}

export function renderOnboarding(locale, tag = LCM_CURRENT_PRERELEASE_TAG) {
  const copy = onboardingLocales[locale]
  const labels = onboardingLabels[locale]
  const compaction = onboardingCompaction[locale]
  if (!copy || !labels || !compaction) throw new Error(`No LCM onboarding translation for ${locale}`)
  if (!/^v\d+\.\d+\.\d+-lcm\.\d+$/.test(tag)) throw new Error(`Invalid LCM prerelease tag: ${tag}`)

  const vscodeRows = [
    ["Windows x64", "kilo-vscode-win32-x64.vsix"],
    ["Windows ARM64", "kilo-vscode-win32-arm64.vsix"],
    ["macOS x64 (Intel)", "kilo-vscode-darwin-x64.vsix"],
    ["macOS ARM64 (Apple Silicon)", "kilo-vscode-darwin-arm64.vsix"],
    ["Linux x64 (glibc)", "kilo-vscode-linux-x64.vsix"],
    ["Linux ARM64 (glibc)", "kilo-vscode-linux-arm64.vsix"],
    ["Alpine x64 (musl)", "kilo-vscode-alpine-x64.vsix"],
    ["Alpine ARM64 (musl)", "kilo-vscode-alpine-arm64.vsix"],
  ]
  const cliRows = [
    ["Windows x64", "kilo-windows-x64.zip"],
    ["Windows x64 baseline", "kilo-windows-x64-baseline.zip"],
    ["Windows ARM64", "kilo-windows-arm64.zip"],
    ["macOS x64 (Intel)", "kilo-darwin-x64.zip"],
    ["macOS x64 baseline", "kilo-darwin-x64-baseline.zip"],
    ["macOS ARM64 (Apple Silicon)", "kilo-darwin-arm64.zip"],
    ["Linux x64 (glibc)", "kilo-linux-x64.tar.gz"],
    ["Linux x64 baseline (glibc)", "kilo-linux-x64-baseline.tar.gz"],
    ["Linux ARM64 (glibc)", "kilo-linux-arm64.tar.gz"],
    ["Linux x64 (musl)", "kilo-linux-x64-musl.tar.gz"],
    ["Linux x64 baseline (musl)", "kilo-linux-x64-baseline-musl.tar.gz"],
    ["Linux ARM64 (musl)", "kilo-linux-arm64-musl.tar.gz"],
  ]
  const releaseURL = `${LCM_RELEASES_URL}/tag/${tag}`

  return [
    LCM_ONBOARDING_START,
    '<a id="install-lcm-prerelease"></a>',
    `## ${copy.title}`,
    "",
    copy.intro,
    "",
    "> [!IMPORTANT]",
    `> ${copy.warning}`,
    "",
    `[${copy.paper}](${LCM_PAPER_URL})`,
    "",
    `**${labels[12]}:** [\`${tag}\`](${releaseURL})`,
    "",
    `### ${labels[0]}`,
    "",
    copy.choose,
    "",
    `#### ${labels[1]}`,
    "",
    copy.system,
    "",
    copy.variants,
    "",
    `#### ${labels[2]}`,
    "",
    copy.vscode,
    "",
    ...renderAssetTable(labels, vscodeRows),
    "",
    copy.vscodeInstall,
    "",
    "```bash",
    "code --install-extension ./kilo-vscode-linux-x64.vsix --force",
    "codium --install-extension ./kilo-vscode-linux-x64.vsix --force",
    "```",
    "",
    `#### ${labels[3]}`,
    "",
    copy.cli,
    "",
    ...renderAssetTable(labels, cliRows),
    "",
    copy.cliInstall,
    "",
    "```bash",
    "mkdir -p kilo-lcm",
    "tar -xzf kilo-linux-x64.tar.gz -C kilo-lcm",
    "./kilo-lcm/kilo --version",
    "",
    "unzip kilo-darwin-arm64.zip -d kilo-lcm",
    "./kilo-lcm/kilo --version",
    "",
    "which -a kilo",
    "```",
    "",
    "```powershell",
    "Expand-Archive .\\kilo-windows-x64.zip .\\kilo-lcm",
    ".\\kilo-lcm\\kilo.exe --version",
    "where.exe kilo",
    "```",
    "",
    `### ${labels[4]}`,
    "",
    copy.setup,
    "",
    "```jsonc",
    "{",
    '  "experimental": {',
    '    "conversation_memory": true',
    "  },",
    '  "conversation_memory": {',
    '    "soft_threshold_percent": 40',
    "  }",
    "}",
    "```",
    "",
    compaction,
    "",
    `#### ${labels[5]}`,
    "",
    copy.ollama,
    "",
    `### ${labels[6]}`,
    "",
    copy.verify,
    "",
    `### ${labels[7]}`,
    "",
    copy.tips,
    "",
    `#### ${labels[8]}`,
    "",
    copy.trouble,
    "",
    `#### ${labels[9]}`,
    "",
    copy.update,
    "",
    "> [!NOTE]",
    `> ${copy.upstream}`,
    "",
    LCM_ONBOARDING_END,
  ].join("\n")
}

function onboardingBlock(readme) {
  const start = readme.indexOf(LCM_ONBOARDING_START)
  const end = readme.indexOf(LCM_ONBOARDING_END)
  if (start === -1 || end === -1 || end < start) throw new Error("README has no complete LCM onboarding block")
  if (readme.indexOf(LCM_ONBOARDING_START, start + 1) !== -1 || readme.indexOf(LCM_ONBOARDING_END, end + 1) !== -1) {
    throw new Error("README has duplicate LCM onboarding markers")
  }
  return readme.slice(start, end + LCM_ONBOARDING_END.length)
}

function onboardingTag(readme) {
  const expression = new RegExp(`${escapeRegExp(LCM_RELEASES_URL)}/tag/(v\\d+\\.\\d+\\.\\d+-lcm\\.\\d+)`)
  const value = expression.exec(onboardingBlock(readme))?.[1]
  if (!value) throw new Error("English onboarding has no exact prerelease tag link")
  return value
}

function withOnboarding(readme, file, rendered) {
  if (readme.includes(LCM_ONBOARDING_START) || readme.includes(LCM_ONBOARDING_END)) {
    const current = onboardingBlock(readme)
    if (file === "translations/README.ar.md") {
      const wrapped = `<div dir="rtl">\n\n${current}\n\n</div>\n\n<div dir="rtl">`
      if (readme.includes(wrapped)) return readme.replace(wrapped, `<div dir="rtl">\n\n${rendered}`)
    }
    return readme.replace(current, rendered)
  }

  let next = readme
  if (file === "README.md") {
    const oldStart = next.indexOf("### KiloCode-LCM prerelease")
    const oldEnd = next.indexOf("### Agents", oldStart)
    if (oldStart !== -1 && oldEnd !== -1) next = `${next.slice(0, oldStart)}${next.slice(oldEnd)}`
  }
  const anchor = file === "translations/README.ar.md" ? '<div dir="rtl">' : "</p>"
  const navEnd = next.indexOf(anchor)
  if (navEnd === -1) throw new Error(`${file} has no language navigation block`)
  const insertion = navEnd + anchor.length
  return `${next.slice(0, insertion)}\n\n${rendered}${next.slice(insertion)}`
}

export function validateOnboardingReadme(readme, input) {
  const { file, locale, tag, vscodeEngine } = input
  const block = onboardingBlock(readme)
  const expected = renderOnboarding(locale, tag)
  if (block !== expected) throw new Error(`${file} LCM onboarding is not synchronized with the ${locale} source`)
  if (readme.indexOf(LCM_ONBOARDING_START) > readme.indexOf("marketplace.visualstudio.com")) {
    throw new Error(`${file} must show LCM onboarding before upstream installation badges`)
  }
  if (block.includes("/releases/latest")) throw new Error(`${file} must not use GitHub's stable-only latest link`)
  const required = [
    LCM_PAPER_URL,
    `${LCM_RELEASES_URL}/tag/${tag}`,
    vscodeEngine.replace(/^[^\d]*/, ""),
    "experimental.conversation_memory",
    "conversation_memory",
    "soft_threshold_percent",
    "compaction.auto",
    "lcm_capacity_unknown",
    "num_ctx",
    "/lcm status",
    "/compact",
    "which -a kilo",
    "where.exe kilo",
    "Marketplace",
    "Open VSX",
    "npm",
    "Homebrew",
    "AUR",
    "JetBrains",
    "glibc",
    "musl",
    "baseline",
    "ARM64",
    "x64",
    ...LCM_PRERELEASE_ASSETS,
  ]
  const missing = required.filter((value) => !block.includes(value))
  if (missing.length > 0) throw new Error(`${file} LCM onboarding is missing: ${missing.join(", ")}`)
  return { file, locale, tag }
}

export async function validateOnboardingSet(read, input = {}) {
  const english = await read("README.md")
  const tag = input.tag ?? onboardingTag(english)
  const packageJSON = JSON.parse(await read("packages/kilo-vscode/package.json"))
  const vscodeEngine = packageJSON.engines?.vscode
  if (typeof vscodeEngine !== "string") throw new Error("VS Code engine requirement is missing")
  const files = ["README.md", ...LCM_PRERELEASE_TRANSLATIONS]
  const values = []
  for (const file of files) {
    const locale = readmeLocales.get(file)
    if (!locale) throw new Error(`No locale mapping for ${file}`)
    values.push(validateOnboardingReadme(await read(file), { file, locale, tag, vscodeEngine }))
  }
  return { tag, vscodeEngine, files: values.map((value) => value.file) }
}

export async function syncOnboarding(options, input = {}) {
  const cwd = input.cwd ?? process.cwd()
  const read = input.read ?? ((file) => readFile(path.resolve(cwd, file), "utf8"))
  const write = input.write ?? ((file, value) => writeFile(path.resolve(cwd, file), value))
  let tag = options.tag
  if (!tag) {
    try {
      tag = onboardingTag(await read("README.md"))
    } catch {
      tag = LCM_CURRENT_PRERELEASE_TAG
    }
  }
  const translations =
    input.translations ??
    (await readdir(path.resolve(cwd, "translations")))
      .filter((file) => /^README\.[^.]+\.md$/.test(file))
      .map((file) => `translations/${file}`)
  validateTranslationReadmePaths(translations)
  const files = ["README.md", ...LCM_PRERELEASE_TRANSLATIONS]
  const changed = []
  for (const file of files) {
    const locale = readmeLocales.get(file)
    const current = await read(file)
    const next = withOnboarding(current, file, renderOnboarding(locale, tag))
    if (next === current) continue
    changed.push(file)
    if (options.write) await write(file, next)
  }
  if (changed.length > 0 && !options.write) throw new Error(`LCM onboarding needs sync: ${changed.join(", ")}`)
  await validateOnboardingSet(read, { tag })
  console.log(`onboarding\t${tag}\t${files.length}\tchanged=${changed.length}`)
  return { tag, files, changed }
}

function usage() {
  console.log(`Usage:
  lcm-prerelease-release.mjs verify-overlay --base-ref <ref> [--head-ref <ref>]
  lcm-prerelease-release.mjs sync-onboarding [--tag <tag>] [--write]
  lcm-prerelease-release.mjs write-notes --base <x.y.z> --tag <tag> --sha <sha> --output-file <path>
  lcm-prerelease-release.mjs next-version --repo <owner/repo> --base <x.y.z> --sha <sha> [--output <github-output>]
  lcm-prerelease-release.mjs create-draft --repo <owner/repo> --tag <tag> --sha <sha> --title <title> --body-file <path> [--output <github-output>]
  lcm-prerelease-release.mjs update-notes --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --body-file <path> --profile lcm-prerelease
  lcm-prerelease-release.mjs upload-assets --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --profile lcm-prerelease --asset <absolute-path>...
  lcm-prerelease-release.mjs validate-release --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --profile lcm-prerelease --body-file <path> --draft <true|false>
  lcm-prerelease-release.mjs publish --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha> --title <title> --body-file <path> --profile lcm-prerelease
  lcm-prerelease-release.mjs cleanup --repo <owner/repo> --release-id <id> --tag <tag> --sha <sha>

Uses GITHUB_TOKEN or GH_TOKEN. Tokens are never printed.
`)
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return { help: true }
  const options = { command: argv[0], assets: [] }
  const repeated = new Set(["--asset"])
  const flags = new Set(["--write"])
  const values = new Set([
    "--repo",
    "--base",
    "--output",
    "--release-id",
    "--tag",
    "--sha",
    "--title",
    "--body-file",
    "--profile",
    "--asset",
    "--draft",
    "--base-ref",
    "--head-ref",
    "--output-file",
  ])
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }
    if (flags.has(arg)) {
      options[arg.slice(2)] = true
      continue
    }
    if (!values.has(arg)) throw new Error(`Unknown argument: ${arg}`)
    const value = argv[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (repeated.has(arg)) {
      options.assets.push(value)
      continue
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())
    options[key] = value
  }
  return options
}

function required(options, key) {
  const value = options[key]
  if (typeof value !== "string" || value.length === 0) throw new Error(`${options.command} requires --${key}`)
  return value
}

function expectedSha(options) {
  const value = required(options, "sha").toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("--sha must be a full 40-character commit SHA")
  return value
}

function token() {
  const value = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!value) throw new Error("GITHUB_TOKEN or GH_TOKEN is required")
  return value
}

export class GitHubApiError extends Error {
  constructor(status, body) {
    super(`GitHub API ${status}: ${body}`)
    this.status = status
  }
}

export async function github(options, apiPath, init = {}) {
  const url = apiPath.startsWith("https://")
    ? apiPath
    : `https://api.github.com/repos/${required(options, "repo")}${apiPath}`
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) throw new GitHubApiError(response.status, await response.text())
  if (response.status === 204) return undefined
  return response.json()
}

export async function allPages(request, apiPath) {
  const items = []
  for (let page = 1; ; page++) {
    const separator = apiPath.includes("?") ? "&" : "?"
    const data = await request(`${apiPath}${separator}per_page=100&page=${page}`)
    if (!Array.isArray(data)) throw new Error(`Expected an array from ${apiPath}`)
    items.push(...data)
    if (data.length < 100) return items
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function nextPrereleaseVersion(base, releases, refs) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`Invalid upstream base version: ${base}`)
  const expression = new RegExp(`^v${escapeRegExp(base)}-lcm\\.(\\d+)$`)
  const names = [
    ...releases.map((release) => release.tag_name),
    ...refs.map((ref) => ref.ref?.replace(/^refs\/tags\//, "")),
  ]
  const used = names
    .map((name) => (typeof name === "string" ? expression.exec(name)?.[1] : undefined))
    .filter(Boolean)
    .map(Number)
  const suffix = Math.max(0, ...used) + 1
  return { base, version: `${base}-lcm.${suffix}`, tag: `v${base}-lcm.${suffix}` }
}

export function validateAssetManifest(assets, expectedNames = LCM_PRERELEASE_ASSETS) {
  const counts = new Map()
  for (const asset of assets) counts.set(asset.name, (counts.get(asset.name) ?? 0) + 1)
  const expected = new Set(expectedNames)
  const missing = expectedNames.filter((name) => !counts.has(name))
  const extra = [...counts.keys()].filter((name) => !expected.has(name))
  const duplicate = [...counts].filter(([, count]) => count !== 1).map(([name]) => name)
  const empty = assets.filter((asset) => !Number.isFinite(asset.size) || asset.size <= 0).map((asset) => asset.name)
  if (missing.length || extra.length || duplicate.length || empty.length || assets.length !== expectedNames.length) {
    throw new Error(
      `Invalid asset manifest: missing=[${missing}] extra=[${extra}] duplicate=[${duplicate}] empty=[${empty}] count=${assets.length}`,
    )
  }
  return assets
}

export function assertReleaseIdentity(release, input) {
  if (String(release.id) !== String(input.releaseID)) throw new Error(`Release ID changed from ${input.releaseID}`)
  if (release.tag_name !== input.tag)
    throw new Error(`Release ${release.id} has tag ${release.tag_name}, expected ${input.tag}`)
  if (release.target_commitish?.toLowerCase() !== input.sha) {
    throw new Error(`Release ${release.id} targets ${release.target_commitish}, expected ${input.sha}`)
  }
  if (input.draft !== undefined && release.draft !== input.draft) {
    throw new Error(`Release ${release.id} draft=${release.draft}, expected ${input.draft}`)
  }
  return release
}

export async function resolveTagCommitSha(request, tag) {
  let object = (await request(`/git/ref/tags/${encodeURIComponent(tag)}`))?.object
  for (let depth = 0; depth < 8; depth++) {
    if (!object || typeof object.sha !== "string") throw new Error(`Tag ${tag} has no resolvable object`)
    if (object.type === "commit") return object.sha.toLowerCase()
    if (object.type !== "tag") throw new Error(`Tag ${tag} resolves to unsupported object type ${object.type}`)
    object = (await request(`/git/tags/${encodeURIComponent(object.sha)}`))?.object
  }
  throw new Error(`Tag ${tag} exceeds the annotated-tag peel limit`)
}

export async function waitForTagCommitSha(request, tag, sha, input = {}) {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const attempts = input.attempts ?? 10
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resolved = await resolveTagCommitSha(request, tag)
      if (resolved !== sha) throw new Error(`Tag ${tag} resolves to ${resolved}, expected ${sha}`)
      return resolved
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404 || attempt === attempts) throw error
      await sleep(1000)
    }
  }
  throw new Error(`Tag ${tag} did not become visible`)
}

export function assetUploadUrl(uploadURL, name) {
  const base = uploadURL.replace(/\{.*$/, "")
  return `${base}?name=${encodeURIComponent(name)}`
}

async function writeOutputs(file, values) {
  if (!file) return
  await appendFile(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  )
}

function requester(options, request) {
  return request ?? ((apiPath, init) => github(options, apiPath, init))
}

async function releaseAssets(request, releaseID) {
  return allPages(request, `/releases/${encodeURIComponent(releaseID)}/assets`)
}

async function validateLocalAssets(files) {
  const assets = []
  for (const file of files) {
    if (!path.isAbsolute(file)) throw new Error(`Asset path must be absolute: ${file}`)
    const info = await stat(file)
    if (!info.isFile()) throw new Error(`Asset is not a file: ${file}`)
    assets.push({ name: path.basename(file), size: info.size, path: file })
  }
  validateAssetManifest(assets)
  return assets
}

export async function nextVersion(options, input = {}) {
  const base = required(options, "base")
  const sha = expectedSha(options)
  const request = requester(options, input.request)
  const releases = await allPages(request, "/releases")
  const duplicate = releases.filter((release) => release.target_commitish?.toLowerCase() === sha)
  if (duplicate.length > 0) {
    throw new Error(`Commit ${sha} already has release(s): ${duplicate.map((release) => release.tag_name).join(", ")}`)
  }
  const refs = await allPages(request, `/git/matching-refs/tags/${encodeURIComponent(`v${base}-lcm.`)}`)
  const value = nextPrereleaseVersion(base, releases, refs)
  await writeOutputs(options.output, value)
  console.log(`${value.version}\t${value.tag}`)
  return value
}

export function validatePrereleaseChangelog(input) {
  const { base, previousTag, changes } = input
  if (!/^v\d+\.\d+\.\d+-lcm\.\d+$/.test(previousTag) || !previousTag.startsWith(`v${base}-lcm.`))
    throw new Error(`Previous prerelease tag ${previousTag} does not match upstream base ${base}`)
  if (!Array.isArray(changes) || changes.length < 2)
    throw new Error("Prerelease changelog requires at least two concrete LCM behavior changes")
  for (const [index, change] of changes.entries()) {
    if (typeof change?.title !== "string" || change.title.trim().length < 12)
      throw new Error(`Prerelease changelog entry ${index + 1} needs a meaningful title`)
    if (typeof change?.body !== "string" || change.body.trim().length < 80)
      throw new Error(`Prerelease changelog entry ${index + 1} needs a concrete behavior and user impact`)
  }
  const detail = changes.map((change) => `${change.title}\n${change.body}`).join("\n")
  const concrete = [
    "lcm_grep",
    "lcm_expand_query",
    "sourceRanges",
    "summary",
    "projection",
    "sidecar",
    "coverage",
    "context",
  ]
  if (!concrete.some((marker) => detail.includes(marker)))
    throw new Error("Prerelease changelog is generic boilerplate rather than a concrete LCM product delta")
  return changes
}

export function validatePrereleaseNotesBody(body, input = {}) {
  const previousTag = input.previousTag ?? LCM_PREVIOUS_PRERELEASE_TAG
  if (!body.includes(`## What changed since ${previousTag}`))
    throw new Error(`Prerelease notes must identify the concrete delta since ${previousTag}`)
  for (const marker of ["lcm_grep", "lcm_expand_query", "sourceRanges", "coverage"])
    if (!body.includes(marker)) throw new Error(`Prerelease notes are missing concrete LCM delta marker: ${marker}`)
  if (!body.includes("175k")) throw new Error("Prerelease notes must report the current 175k evidence or limitation")
  return body
}

export function renderPrereleaseNotes(input) {
  const { base, tag, sha } = input
  const previousTag = input.previousTag ?? LCM_PREVIOUS_PRERELEASE_TAG
  const changes = validatePrereleaseChangelog({
    base,
    previousTag,
    changes: input.changes ?? LCM_PRERELEASE_CHANGELOG,
  })
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`Invalid upstream base version: ${base}`)
  if (tag !== `v${base}-lcm.${tag.match(/-lcm\.(\d+)$/)?.[1] ?? ""}`)
    throw new Error(`Tag ${tag} does not match v${base}-lcm.N`)
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Release notes require a full 40-character commit SHA")
  const body = [
    `This prerelease adds Conversation Memory to Kilo Code v${base}. It keeps long chats useful by summarizing older, already-used context into a searchable tree while preserving recent work exactly.`,
    "",
    `See the [installation and setup guide](https://github.com/KertarTheDev/LCM#install-lcm-prerelease) to choose one of the 12 CLI archives or eight VSIX files, configure Kilo or Ollama over LAN, troubleshoot problems, update, or roll back.`,
    "",
    `The original idea and rationale are in the [LCM paper](${LCM_PAPER_URL}).`,
    "",
    "> LCM is available only in the assets attached to this GitHub prerelease. Marketplace, Open VSX, npm, Homebrew, AUR, cloud, and JetBrains provide the official Kilo Code version without LCM.",
    "",
    `## What changed since ${previousTag}`,
    "",
    ...changes.flatMap((change) => [`- **${change.title}.** ${change.body}`, ""]),
    "The exact published `.11` 175k LCM-only trace exposed the silently ignored range scope and transient semantic-query failures that motivated these model-neutral changes. The fixed-binary 175k rerun is pending at publication time and will be reported as evidence rather than claimed in advance.",
    "",
    "Focused LCM tool, store, tree, projection, API, export, documentation, contract, upstream-compatibility, and deterministic long-context gates passed for product commit `18b87e3110a09edb9f3d71188db7f74b108dfbb4`. This release workflow also completes all canonical package typechecks, generated-contract checks, builds, and packaged-runtime smoke before publication.",
    "",
    "Upgrade note: this recovery-interface change does not alter raw conversation storage or require a sidecar schema migration. Existing Kilo chats remain in SQLite and derived LCM state remains rebuildable.",
    "",
    `Tag: \`${tag}\``,
    `Commit: \`${sha.toLowerCase()}\``,
    "",
    "Your regular Kilo chats stay in SQLite. LCM's derived summary data is separate and rebuildable, so trying the prerelease does not replace the raw conversation history.",
    "",
  ].join("\n")
  return validatePrereleaseNotesBody(body, { previousTag })
}

export async function writeNotes(options) {
  const base = required(options, "base")
  const tag = required(options, "tag")
  const sha = expectedSha(options)
  const body = renderPrereleaseNotes({ base, tag, sha })
  await writeFile(required(options, "outputFile"), body)
  console.log(`notes\t${tag}\t${sha}`)
  return body
}

export async function updateNotes(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  if (options.profile !== "lcm-prerelease") throw new Error("update-notes requires --profile lcm-prerelease")
  const body = input.readBody
    ? await input.readBody(required(options, "bodyFile"))
    : await readFile(required(options, "bodyFile"), "utf8")
  validatePrereleaseNotesBody(body)
  const request = requester(options, input.request)
  const release = assertReleaseIdentity(await request(`/releases/${releaseID}`), {
    releaseID,
    tag,
    sha,
    draft: false,
  })
  if (!release.prerelease) throw new Error(`Release ${releaseID} is not marked prerelease`)
  validateAssetManifest(await releaseAssets(request, releaseID))
  if ((await resolveTagCommitSha(request, tag)) !== sha) throw new Error(`Tag ${tag} does not resolve to ${sha}`)
  const updated = assertReleaseIdentity(
    await request(`/releases/${releaseID}`, { method: "PATCH", body: JSON.stringify({ body }) }),
    { releaseID, tag, sha, draft: false },
  )
  if (!updated.prerelease || updated.body !== body)
    throw new Error(`Release ${releaseID} notes were not updated exactly`)
  const verified = assertReleaseIdentity(await request(`/releases/${releaseID}`), {
    releaseID,
    tag,
    sha,
    draft: false,
  })
  if (!verified.prerelease || verified.body !== body)
    throw new Error(`Release ${releaseID} notes failed refetch verification`)
  console.log(`updated-notes\t${releaseID}\t${tag}\t${sha}`)
  return verified
}

export async function createDraft(options, input = {}) {
  const sha = expectedSha(options)
  const tag = required(options, "tag")
  const title = required(options, "title")
  const body = await readFile(required(options, "bodyFile"), "utf8")
  validatePrereleaseNotesBody(body)
  const request = requester(options, input.request)
  const release = await request("/releases", {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: title,
      body,
      draft: true,
      prerelease: true,
    }),
  })
  assertReleaseIdentity(release, { releaseID: release.id, tag, sha, draft: true })
  if (!release.prerelease) throw new Error(`Draft ${release.id} is not marked prerelease`)
  if (typeof release.upload_url !== "string") throw new Error(`Draft ${release.id} has no upload URL`)
  await writeOutputs(options.output, { id: release.id, upload_url: release.upload_url })
  console.log(`created\t${release.id}\t${tag}\t${sha}`)
  return release
}

export async function uploadAssets(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  if (options.profile !== "lcm-prerelease") throw new Error("upload-assets requires --profile lcm-prerelease")
  const files = await (input.validateLocalAssets ?? validateLocalAssets)(options.assets)
  const request = requester(options, input.request)
  const release = assertReleaseIdentity(await request(`/releases/${releaseID}`), { releaseID, tag, sha, draft: true })
  if ((await releaseAssets(request, releaseID)).length !== 0) throw new Error(`Draft ${releaseID} already has assets`)
  for (const asset of files) {
    const body = input.readAsset ? await input.readAsset(asset.path) : await readFile(asset.path)
    const uploaded = await request(assetUploadUrl(release.upload_url, asset.name), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    })
    if (uploaded.name !== asset.name || uploaded.size <= 0)
      throw new Error(`Upload failed validation for ${asset.name}`)
  }
  const uploaded = await releaseAssets(request, releaseID)
  validateAssetManifest(uploaded)
  console.log(`uploaded\t${releaseID}\t${uploaded.length}`)
  return uploaded
}

export async function validateRelease(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  if (options.profile !== "lcm-prerelease") throw new Error("validate-release requires --profile lcm-prerelease")
  if (options.draft !== "true" && options.draft !== "false") throw new Error("--draft must be true or false")
  const draft = options.draft === "true"
  const request = requester(options, input.request)
  const release = assertReleaseIdentity(await request(`/releases/${releaseID}`), { releaseID, tag, sha, draft })
  if (!release.prerelease) throw new Error(`Release ${releaseID} is not marked prerelease`)
  const expectedBody =
    input.expectedBody ??
    (options.bodyFile
      ? input.readBody
        ? await input.readBody(options.bodyFile)
        : await readFile(options.bodyFile, "utf8")
      : undefined)
  if (expectedBody !== undefined) {
    validatePrereleaseNotesBody(expectedBody)
    if (release.body !== expectedBody) throw new Error(`Release ${releaseID} notes do not match the reviewed body`)
  }
  const assets = await releaseAssets(request, releaseID)
  validateAssetManifest(assets)
  if (!draft && (await resolveTagCommitSha(request, tag)) !== sha)
    throw new Error(`Tag ${tag} does not resolve to ${sha}`)
  console.log(`validated\t${releaseID}\t${tag}\t${assets.length}\tdraft=${draft}`)
  return { release, assets }
}

export async function publishRelease(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  const title = required(options, "title")
  if (options.profile !== "lcm-prerelease") throw new Error("publish requires --profile lcm-prerelease")
  const bodyFile = required(options, "bodyFile")
  const body = input.readBody ? await input.readBody(bodyFile) : await readFile(bodyFile, "utf8")
  validatePrereleaseNotesBody(body)
  const request = requester(options, input.request)
  await validateRelease({ ...options, command: "validate-release", draft: "true" }, { request, expectedBody: body })
  const release = await request(`/releases/${releaseID}`, {
    method: "PATCH",
    body: JSON.stringify({ draft: false, prerelease: true, name: title }),
  })
  assertReleaseIdentity(release, { releaseID, tag, sha, draft: false })
  if (!release.prerelease) throw new Error(`Published release ${releaseID} is not marked prerelease`)
  if (release.body !== body) throw new Error(`Published release ${releaseID} lost the reviewed changelog body`)
  await waitForTagCommitSha(request, tag, sha, { sleep: input.sleep })
  const verified = assertReleaseIdentity(await request(`/releases/${releaseID}`), {
    releaseID,
    tag,
    sha,
    draft: false,
  })
  if (!verified.prerelease || verified.body !== body)
    throw new Error(`Published release ${releaseID} changelog failed exact refetch verification`)
  console.log(`published\t${releaseID}\t${tag}\t${sha}`)
  return verified
}

export async function cleanup(options, input = {}) {
  const sha = expectedSha(options)
  const releaseID = required(options, "releaseId")
  const tag = required(options, "tag")
  const request = requester(options, input.request)
  let release
  try {
    release = await request(`/releases/${releaseID}`)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return { releaseDeleted: false, tagDeleted: false }
    throw error
  }
  try {
    assertReleaseIdentity(release, { releaseID, tag, sha, draft: true })
  } catch (error) {
    console.error(`${error.message}; leaving release ${releaseID} intact`)
    return { releaseDeleted: false, tagDeleted: false }
  }
  await request(`/releases/${releaseID}`, { method: "DELETE" })
  let tagSha
  try {
    tagSha = await resolveTagCommitSha(request, tag)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return { releaseDeleted: true, tagDeleted: false }
    throw error
  }
  if (tagSha !== sha) {
    console.error(`Tag ${tag} resolves to ${tagSha}, not ${sha}; leaving it intact`)
    return { releaseDeleted: true, tagDeleted: false }
  }
  await request(`/git/refs/tags/${encodeURIComponent(tag)}`, { method: "DELETE" })
  return { releaseDeleted: true, tagDeleted: true }
}

export function validatePrereleaseOverlayPaths(files) {
  const invalid = files.filter((file) => !LCM_PRERELEASE_OVERLAY_PATHS.has(file))
  if (invalid.length > 0) {
    throw new Error(`Prerelease branch changes product paths: ${invalid.join(", ")}`)
  }
  return files
}

function withoutOnboarding(readme) {
  if (!readme.includes(LCM_ONBOARDING_START) && !readme.includes(LCM_ONBOARDING_END)) return readme
  const block = onboardingBlock(readme)
  const inserted = `\n\n${block}`
  if (!readme.includes(inserted)) throw new Error("LCM onboarding block is not at its generated insertion boundary")
  return readme.replace(inserted, "")
}

async function runGit(args, cwd) {
  const result = await execFile("git", args, { cwd })
  return result.stdout.trim()
}

export async function verifyPrereleaseOverlay(options, input = {}) {
  const baseRef = required(options, "baseRef")
  const headRef = options.headRef ?? "HEAD"
  const git = input.git ?? ((args) => runGit(args, input.cwd ?? process.cwd()))
  const baseSha = (await git(["rev-parse", `${baseRef}^{commit}`])).toLowerCase()
  const headSha = (await git(["rev-parse", `${headRef}^{commit}`])).toLowerCase()
  const mergeBase = (await git(["merge-base", baseSha, headSha])).toLowerCase()
  if (mergeBase !== baseSha) {
    throw new Error(`Prerelease head ${headSha} is not based on product commit ${baseSha}`)
  }
  const output = await git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${baseSha}..${headSha}`])
  const files = output
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
  validatePrereleaseOverlayPaths(files)
  const readAtHead = input.readAtRef ?? ((file) => git(["show", `${headSha}:${file}`]))
  const readAtBase = input.readAtBase ?? ((file) => git(["show", `${baseSha}:${file}`]))
  if (input.validateTranslations !== false) {
    const translationOutput = await git(["ls-tree", "-r", "--name-only", headSha, "translations"])
    validateTranslationReadmePaths(
      translationOutput
        .split("\n")
        .map((file) => file.trim())
        .filter((file) => /^translations\/README\.[^.]+\.md$/.test(file)),
    )
    for (const file of LCM_PRERELEASE_TRANSLATIONS) {
      if (withoutOnboarding(await readAtHead(file)) !== withoutOnboarding(await readAtBase(file))) {
        throw new Error(`${file} changes content outside the generated LCM onboarding block`)
      }
    }
  }
  if (input.validateOnboarding !== false) {
    await validateOnboardingSet(readAtHead)
  }
  console.log(`overlay\t${baseSha}\t${headSha}\t${files.length}`)
  return { baseSha, headSha, files }
}

export async function runCommand(options, input = {}) {
  if (options.command === "verify-overlay") return verifyPrereleaseOverlay(options, input)
  if (options.command === "sync-onboarding") return syncOnboarding(options, input)
  if (options.command === "write-notes") return writeNotes(options, input)
  if (options.command === "next-version") return nextVersion(options, input)
  if (options.command === "create-draft") return createDraft(options, input)
  if (options.command === "update-notes") return updateNotes(options, input)
  if (options.command === "upload-assets") return uploadAssets(options, input)
  if (options.command === "validate-release") return validateRelease(options, input)
  if (options.command === "publish") return publishRelease(options, input)
  if (options.command === "cleanup") return cleanup(options, input)
  throw new Error(`Unknown command: ${options.command}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return usage()
  await runCommand(options)
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
