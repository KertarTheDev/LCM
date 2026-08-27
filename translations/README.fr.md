<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | Français | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Essayez la préversion LCM

Cette version expérimentale de Kilo Code permet de poursuivre de longues conversations sans perdre le fil : le contexte ancien déjà utilisé devient un arbre de résumés consultable. Les échanges récents restent intacts et l'agent peut retrouver les détails antérieurs au besoin.

> [!IMPORTANT]
> Les versions avec LCM sont distribuées uniquement dans les GitHub Releases de ce dépôt. Marketplace, Open VSX, npm, Homebrew, AUR, les services cloud et JetBrains installent la version officielle de Kilo Code, sans LCM.

[Vous voulez comprendre l'idée ? Lisez l'article LCM original de Clint Ehrlich et Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Préversion actuelle:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Choisir le téléchargement

Choisissez un VSIX pour VS Code ou VSCodium, et une archive CLI pour le terminal. Vous pouvez installer les deux.

#### Identifier votre système

Sous Windows : Settings → System → About → System type ; sous macOS : Apple menu → About This Mac ; sous Linux : uname -m. x86_64 ou amd64 signifie x64, arm64 ou aarch64 signifie ARM64.

La plupart des distributions Linux de bureau utilisent glibc ; Alpine et certains conteneurs légers utilisent musl. Choisissez la version baseline uniquement pour un ancien processeur x64 ou si la CLI normale s'arrête avec l'erreur illegal instruction. Il n'existe pas de VSIX baseline distinct.

#### VS Code / VSCodium

Il faut VS Code ou VSCodium 1.105.1 ou plus récent. Le VSIX utilise l'identifiant normal de Kilo Code et remplace donc une version Marketplace installée.

|Système|Fichier|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Téléchargez le bon fichier, désactivez la mise à jour automatique de Kilo Code, puis choisissez Extensions → … → Install from VSIX. Rechargez la fenêtre ensuite. Vous pouvez aussi utiliser les commandes ci-dessous.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Téléchargez une archive du tableau. Décompressez-la entièrement dans un dossier dédié et conservez tous les fichiers fournis avec l'exécutable.

|Système|Fichier|
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

Lancez une fois le programme extrait avant d'ajouter son dossier à PATH. Si un autre Kilo démarre ensuite, vérifiez les chemins ci-dessous et placez le dossier LCM plus tôt dans PATH.

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

### Configurer Kilo et LCM

Connectez votre fournisseur habituel et choisissez un modèle. Conversation Memory est activée par défaut. Vérifiez-le dans Settings → Experimental, puis ouvrez Settings → Context ; le seuil de déclenchement est fixé à 40 % par défaut. Les modèles personnalisés exigent des limites positives de contexte et de sortie ; la limite d'entrée est facultative.

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

Quand LCM est actif, compaction.auto ne contrôle que l'ancien système de compactage de Kilo ; il ne désactive pas LCM.

#### Ollama

Pour Ollama, utilisez l'adresse réelle du serveur—souvent localhost:11434 sur la même machine ou son adresse LAN depuis un autre appareil. Ollama doit écouter sur cette adresse, le pare-feu doit l'autoriser et num_ctx doit être au moins égal à la limite de contexte renseignée dans Kilo.

### Vérifier le fonctionnement

Démarrez une discussion, choisissez le fournisseur et le modèle, puis lancez /lcm status. Le statut doit être enabled et la capacité doit être connue. L'en-tête de la tâche ou la page Context affiche l'utilisation et l'activité de LCM. /compact lance un cycle manuel ; une nouvelle discussion courte peut ne rien avoir à résumer.

### Conseils utiles

Les résumés font des appels au modèle et peuvent donc ajouter un peu de délai et de coût. Commencez à 40 % ; baissez pour intervenir plus tôt ou augmentez pour moins d'appels. La mémoire LCM appartient à la discussion actuelle. Un export de contexte peut contenir des prompts et sorties sensibles.

#### Solutions rapides

Si lcm_capacity_unknown apparaît, renseignez les limites de contexte et de sortie du modèle personnalisé. Si l'extension repasse à une autre version après le redémarrage, désactivez la mise à jour automatique et réinstallez le VSIX. Si la mauvaise CLI démarre, utilisez which -a kilo ou where.exe kilo. Sur Alpine, prenez musl ; sur un ancien processeur x64, essayez baseline.

#### Mettre à jour ou revenir

Pour mettre à jour, installez le nouveau VSIX par-dessus l'ancien ou remplacez le dossier CLI extrait. Vos discussions restent dans SQLite de Kilo. Pour revenir vite, mettez experimental.conversation_memory à false ; vous pouvez aussi réinstaller la version officielle de Kilo Code ou une ancienne préversion.

> [!NOTE]
> Le reste de cette page décrit la version officielle de Kilo Code. Les liens d'installation habituels plus bas n'installent pas cette version avec LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">L'agent de codage open source pour construire avec l'IA dans VS Code, JetBrains ou la CLI.</p>

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

Kilo Code est un agent de codage avec IA qui vous accompagne partout où vous travaillez : [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) et la [CLI](https://kilo.ai/cli). Il est open source avec une tarification ouverte. Vous choisissez parmi plus de 500 modèles, vous pouvez en changer en cours de tâche et vous payez le tarif du fournisseur du modèle sans majoration. Aucune clé API n'est nécessaire pour commencer.

### Installation

Choisissez où vous voulez exécuter Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installez directement l'[extension Kilo Code](vscode:extension/kilocode.kilo-code), ou récupérez-la sur le [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Créez un compte et vous aurez accès à plus de 500 modèles, dont GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 et Gemini 3.1 Pro Preview, tous au prix fournisseur.

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

Exécutez ensuite `kilo` dans n'importe quel répertoire de projet pour commencer.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installez le [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) depuis JetBrains Marketplace, ou recherchez "Kilo Code" dans `Settings → Plugins` dans n'importe quel IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Exécutez Kilo depuis le web, sans machine locale, sur [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Revues de code</strong></summary>

<br>

Configurez des revues de code IA automatisées sur vos pull requests à l'adresse [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Lancez votre agent IA toujours actif sur [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Installer la CLI depuis GitHub Releases (binaires)</summary>

Téléchargez le dernier binaire depuis la [page des releases](https://github.com/Kilo-Org/kilocode/releases).

| Plateforme | Fichier |
|---|---|
| Windows (la plupart des PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notes : `x64-baseline` est une build de compatibilité pour les anciens processeurs sans AVX. `musl` est la build liée statiquement pour Alpine ou les images Docker minimales sans glibc. `kilo-vscode-*.vsix` est le paquet de l'extension VS Code, pas la CLI. Les archives `Source code` servent à compiler depuis les sources.

</details>

### Agents

Kilo inclut des agents spécialisés entre lesquels vous pouvez basculer selon la tâche. Vous pouvez aussi créer vos propres agents personnalisés.

- **Code** - Par défaut. Implémente et modifie le code à partir du langage naturel.
- **Plan** - Conçoit l'architecture et rédige des plans d'implémentation avant l'écriture du code.
- **Ask** - Répond aux questions sur votre base de code sans modifier les fichiers.
- **Debug** - Diagnostique et trace les problèmes.
- **Review** - Examine vos changements et signale les problèmes de performance, sécurité, style et couverture de tests.

En savoir plus sur les [agents et agents personnalisés](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Fonctionnalités

- **Génération de code** en langage naturel, sur plusieurs fichiers.
- **Autocomplétion en ligne** avec suggestions ghost-text et Tab pour accepter.
- **Auto-vérification** pour que l'agent relise et corrige son propre travail.
- **Contrôle du terminal et du navigateur** pour exécuter des commandes et automatiser le web.
- **Marketplace MCP** pour trouver et connecter des serveurs MCP qui étendent les capacités de l'agent.
- **Plus de 500 modèles** avec changement en cours de tâche, pour adapter latence, coût et raisonnement au travail.

### Mode autonome (CI/CD)

Exécutez `kilo run` avec `--auto` pour un fonctionnement entièrement autonome sans prompts, conçu pour les pipelines CI/CD :

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` désactive toutes les demandes d'autorisation et permet à l'agent d'exécuter n'importe quelle action sans confirmation. Utilisez-le uniquement dans des environnements de confiance.

### Documentation

Pour la configuration et tout le reste, consultez la [documentation](https://kilo.ai/docs).

### Contribuer

Les contributions des développeurs, rédacteurs et de toute personne intéressée sont les bienvenues. Commencez par le [guide de contribution](/CONTRIBUTING.md) pour la configuration de l'environnement, les standards de code et l'ouverture d'une pull request. Consultez [RELEASING.md](../RELEASING.md) pour le processus de release de l'extension VS Code et de la CLI, et [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) pour le plugin JetBrains.

Veuillez lire notre [Code de conduite](/CODE_OF_CONDUCT.md) avant de participer.

### Licence

MIT. Vous pouvez utiliser, modifier et distribuer ce code, y compris commercialement, tant que vous conservez les mentions d'attribution et de licence. Voir [License](/LICENSE).

### FAQ

<details>
<summary>D'où vient Kilo CLI ?</summary>

Kilo CLI est un fork d'[OpenCode](https://github.com/anomalyco/opencode), amélioré pour fonctionner au sein de la plateforme d'ingénierie agentique Kilo.

</details>

---

**Rejoindre la communauté** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
