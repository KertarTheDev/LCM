<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | Ελληνικά | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Δοκιμάστε την προέκδοση LCM

Αυτή η πειραματική έκδοση του Kilo Code βοηθά τις μεγάλες συνομιλίες να παραμένουν χρήσιμες, μετατρέποντας το παλιότερο περιβάλλον που έχει ήδη χρησιμοποιηθεί σε ένα δέντρο περιλήψεων με δυνατότητα αναζήτησης. Η πρόσφατη δουλειά μένει ανέπαφη και ο βοηθός μπορεί να ανακτήσει παλιότερες λεπτομέρειες όταν χρειαστεί.

> [!IMPORTANT]
> Οι εκδόσεις με LCM διατίθενται μόνο από τα GitHub Releases αυτού του αποθετηρίου. Οι εγκαταστάσεις από Marketplace, Open VSX, npm, Homebrew, AUR, υπηρεσίες cloud και JetBrains αφορούν την επίσημη έκδοση του Kilo Code, χωρίς LCM.

[Θέλετε το σκεπτικό; Διαβάστε την αρχική εργασία LCM των Clint Ehrlich και Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Τρέχουσα προέκδοση:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### Επιλέξτε λήψη

Επιλέξτε VSIX για VS Code ή VSCodium και αρχείο CLI για τερματικό. Μπορείτε να εγκαταστήσετε και τα δύο.

#### Βρείτε το σύστημά σας

Στα Windows δείτε Settings → System → About → System type, στο macOS Apple menu → About This Mac, και στο Linux τρέξτε uname -m. x86_64 ή amd64 σημαίνει x64, ενώ arm64 ή aarch64 σημαίνει ARM64.

Οι περισσότερες διανομές Linux για υπολογιστές χρησιμοποιούν glibc, ενώ το Alpine και ορισμένα μικρά κοντέινερ χρησιμοποιούν musl. Επιλέξτε baseline μόνο για παλιό επεξεργαστή x64 ή αν το κανονικό CLI τερματίζεται με illegal instruction. Δεν υπάρχει ξεχωριστό baseline VSIX.

#### VS Code / VSCodium

Χρειάζεστε VS Code ή VSCodium 1.105.1 ή νεότερο. Το VSIX χρησιμοποιεί το κανονικό extension ID του Kilo Code, οπότε αντικαθιστά εγκατεστημένη έκδοση Marketplace.

|Σύστημα|Αρχείο|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Κατεβάστε το σωστό αρχείο, απενεργοποιήστε τις αυτόματες ενημερώσεις του Kilo Code και επιλέξτε Extensions → … → Install from VSIX. Έπειτα επαναφορτώστε το παράθυρο. Μπορείτε επίσης να χρησιμοποιήσετε τις παρακάτω εντολές.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Κατεβάστε ένα αρχείο από τον πίνακα. Αποσυμπιέστε όλο το αρχείο σε ξεχωριστό φάκελο και κρατήστε όλα τα βοηθητικά αρχεία δίπλα στο εκτελέσιμο.

|Σύστημα|Αρχείο|
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

Τρέξτε μία φορά το εκτελέσιμο πριν προσθέσετε τον φάκελο στο PATH. Αν αργότερα ξεκινά άλλο Kilo, ελέγξτε τις διαδρομές παρακάτω και βάλτε τον φάκελο LCM νωρίτερα στο PATH.

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

### Ρύθμιση Kilo και LCM

Συνδέστε πρώτα τον πάροχο που χρησιμοποιείτε συνήθως και επιλέξτε μοντέλο. Το Conversation Memory είναι ενεργό από προεπιλογή. Στην επέκταση ελέγξτε Settings → Experimental και έπειτα ανοίξτε Settings → Context· το αρχικό όριο είναι 60%. Τα προσαρμοσμένα μοντέλα χρειάζονται θετικά όρια περιβάλλοντος και εξόδου, ενώ το όριο εισόδου είναι προαιρετικό.

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

Με ενεργό LCM, το compaction.auto ελέγχει μόνο το παλιό σύστημα συμπίεσης του Kilo· δεν απενεργοποιεί το LCM.

#### Ollama

Για Ollama χρησιμοποιήστε την πραγματική διεύθυνση server—συνήθως localhost:11434 στο ίδιο μηχάνημα ή τη LAN διεύθυνσή του από άλλη συσκευή. Το Ollama πρέπει να ακούει εκεί, το firewall να το επιτρέπει και το num_ctx να είναι τουλάχιστον όσο το context limit στο Kilo.

### Έλεγχος λειτουργίας

Ξεκινήστε μια συνομιλία, επιλέξτε πάροχο και μοντέλο και εκτελέστε /lcm status. Η κατάσταση πρέπει να είναι enabled και η χωρητικότητα γνωστή. Η κεφαλίδα της εργασίας ή η σελίδα Context δείχνει τη χρήση και τη δραστηριότητα του LCM. Το /compact ξεκινά έναν χειροκίνητο κύκλο· μια σύντομη νέα συνομιλία ίσως να μην έχει ακόμη κάτι για περίληψη.

### Χρήσιμες συμβουλές

Οι περιλήψεις χρησιμοποιούν κλήσεις προς το μοντέλο, οπότε μπορεί να προσθέσουν λίγο χρόνο και κόστος. Ξεκινήστε με 60%· μειώστε το για νωρίτερη επεξεργασία ή αυξήστε το για λιγότερες κλήσεις. Η μνήμη LCM ανήκει στην τρέχουσα συνομιλία. Η εξαγωγή περιβάλλοντος μπορεί να περιέχει ευαίσθητες προτροπές και αποτελέσματα εργαλείων.

#### Γρήγορες λύσεις

Αν δείτε lcm_capacity_unknown, συμπληρώστε τα context και output limits του επιλεγμένου custom model. Αν το extension αλλάξει μετά restart, κλείστε auto-update και επανεγκαταστήστε το VSIX. Για λάθος CLI ελέγξτε which -a kilo ή where.exe kilo. Σε Alpine πάρτε musl, σε παλιό x64 δοκιμάστε baseline.

#### Αναβάθμιση ή επιστροφή

Για αναβάθμιση εγκαταστήστε το νέο VSIX πάνω από το παλιό ή αντικαταστήστε τον φάκελο CLI. Οι συνομιλίες μένουν στη SQLite του Kilo. Για γρήγορη επιστροφή θέστε experimental.conversation_memory σε false ή εγκαταστήστε την επίσημη έκδοση του Kilo Code ή μια παλιότερη προέκδοση.

> [!NOTE]
> Το υπόλοιπο της σελίδας περιγράφει την επίσημη έκδοση του Kilo Code. Οι συνηθισμένοι σύνδεσμοι εγκατάστασης παρακάτω δεν εγκαθιστούν αυτή την έκδοση με LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Ο open source agent προγραμματισμού για δημιουργία με AI σε VS Code, JetBrains ή CLI.</p>

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

Το Kilo Code είναι ένας AI agent προγραμματισμού που σας συναντά παντού όπου εργάζεστε: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) και [CLI](https://kilo.ai/cli). Είναι open source με ανοιχτή τιμολόγηση. Επιλέγετε από περισσότερα από 500 μοντέλα, αλλάζετε μεταξύ τους στη μέση μιας εργασίας και πληρώνετε την τιμή του παρόχου του μοντέλου χωρίς προσαύξηση. Δεν απαιτούνται API keys για να ξεκινήσετε.

### Εγκατάσταση

Επιλέξτε πού θέλετε να εκτελέσετε το Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Εγκαταστήστε απευθείας την [επέκταση Kilo Code](vscode:extension/kilocode.kilo-code) ή κατεβάστε τη από το [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Δημιουργήστε λογαριασμό και θα έχετε πρόσβαση σε περισσότερα από 500 μοντέλα, όπως GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 και Gemini 3.1 Pro Preview, όλα στην τιμή του παρόχου.

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

Στη συνέχεια εκτελέστε `kilo` σε οποιονδήποτε κατάλογο έργου για να ξεκινήσετε.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Εγκαταστήστε το [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) από το JetBrains Marketplace ή αναζητήστε "Kilo Code" στο `Settings → Plugins` σε οποιοδήποτε JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Εκτελέστε το Kilo από τον ιστό, χωρίς τοπικό μηχάνημα, στο [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Ρυθμίστε αυτοματοποιημένα AI code reviews στα pull requests σας στο [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Εκκινήστε τον πάντα ενεργό AI agent σας στο [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Εγκατάσταση CLI από GitHub Releases (binaries)</summary>

Κατεβάστε το πιο πρόσφατο binary από τη [σελίδα Releases](https://github.com/Kilo-Org/kilocode/releases).

| Πλατφόρμα | Asset |
|---|---|
| Windows (οι περισσότεροι υπολογιστές) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Σημειώσεις: Το `x64-baseline` είναι build συμβατότητας για παλαιότερους CPU χωρίς AVX. Το `musl` είναι το στατικά συνδεδεμένο build για Alpine ή ελάχιστες Docker images χωρίς glibc. Το `kilo-vscode-*.vsix` είναι το πακέτο επέκτασης VS Code, όχι το CLI. Τα αρχεία `Source code` είναι για build από τον πηγαίο κώδικα.

</details>

### Agents

Το Kilo περιλαμβάνει εξειδικευμένους agents ανάμεσα στους οποίους αλλάζετε ανάλογα με την εργασία. Μπορείτε επίσης να δημιουργήσετε τους δικούς σας custom agents.

- **Code** - Ο προεπιλεγμένος. Υλοποιεί και επεξεργάζεται κώδικα από φυσική γλώσσα.
- **Plan** - Σχεδιάζει αρχιτεκτονική και γράφει πλάνα υλοποίησης πριν γραφτεί κώδικας.
- **Ask** - Απαντά σε ερωτήσεις για το codebase σας χωρίς να πειράζει αρχεία.
- **Debug** - Αντιμετωπίζει και εντοπίζει προβλήματα.
- **Review** - Ελέγχει τις αλλαγές σας και εντοπίζει ζητήματα απόδοσης, ασφάλειας, στυλ και κάλυψης δοκιμών.

Μάθετε περισσότερα για τους [agents και custom agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Τι κάνει

- **Παραγωγή κώδικα** από φυσική γλώσσα, σε πολλά αρχεία.
- **Inline autocomplete** με ghost-text προτάσεις και Tab για αποδοχή.
- **Αυτοέλεγχος** ώστε ο agent να ελέγχει και να διορθώνει τη δουλειά του.
- **Έλεγχος terminal και browser** για εκτέλεση εντολών και αυτοματοποίηση του web.
- **MCP marketplace** για εύρεση και σύνδεση MCP servers που επεκτείνουν τις δυνατότητες του agent.
- **Περισσότερα από 500 μοντέλα** με αλλαγή στη μέση της εργασίας, ώστε να ταιριάζετε latency, κόστος και reasoning στη δουλειά.

### Αυτόνομη λειτουργία (CI/CD)

Εκτελέστε `kilo run` με `--auto` για πλήρως αυτόνομη λειτουργία χωρίς prompts, σχεδιασμένη για CI/CD pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

Το `--auto` απενεργοποιεί όλα τα prompts αδειών και επιτρέπει στον agent να εκτελεί οποιαδήποτε ενέργεια χωρίς επιβεβαίωση. Χρησιμοποιήστε το μόνο σε αξιόπιστα περιβάλλοντα.

### Τεκμηρίωση

Για ρυθμίσεις και όλα τα υπόλοιπα, δείτε την [τεκμηρίωση](https://kilo.ai/docs).

### Συνεισφορά

Οι συνεισφορές είναι ευπρόσδεκτες από developers, writers και όλους. Ξεκινήστε με τον [Contributing Guide](/CONTRIBUTING.md) για ρύθμιση περιβάλλοντος, πρότυπα κώδικα και άνοιγμα pull request. Δείτε το [RELEASING.md](../RELEASING.md) για τη διαδικασία release της επέκτασης VS Code και του CLI, και το [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) για το JetBrains plugin.

Παρακαλούμε διαβάστε τον [Code of Conduct](/CODE_OF_CONDUCT.md) πριν συμμετάσχετε.

### Άδεια

MIT. Μπορείτε να χρησιμοποιήσετε, να τροποποιήσετε και να διανείμετε αυτόν τον κώδικα, ακόμη και εμπορικά, αρκεί να διατηρήσετε τις αναφορές απόδοσης και άδειας. Δείτε [License](/LICENSE).

### FAQ

<details>
<summary>Από πού προήλθε το Kilo CLI;</summary>

Το Kilo CLI είναι fork του [OpenCode](https://github.com/anomalyco/opencode), βελτιωμένο για να λειτουργεί μέσα στην Kilo agentic engineering platform.

</details>

---

**Γίνετε μέλος της κοινότητας** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
