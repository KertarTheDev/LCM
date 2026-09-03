<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | 日本語 | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## LCM プレリリースを試す

この実験版 Kilo Code は、すでに使った古いコンテキストを検索できる要約ツリーにまとめ、長いチャットでも流れを保ちやすくします。最近の作業はそのまま残り、必要になればエージェントが以前の詳しい内容を取り出せます。

> [!IMPORTANT]
> LCM 入りのビルドは、このリポジトリの GitHub Releases でのみ配布しています。Marketplace、Open VSX、npm、Homebrew、AUR、クラウド、JetBrains からインストールされるのは公式版 Kilo Code で、LCM は含まれません。

[仕組みの元になった考え方は、Clint Ehrlich と Theodore Blackman による原著 LCM 論文をご覧ください。](https://arxiv.org/abs/2605.04050)

**現在のプレリリース:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### ダウンロードを選ぶ

VS Code または VSCodium なら VSIX、ターミナルなら CLI アーカイブを選びます。両方入れても問題ありません。

#### システムを確認

Windows は Settings → System → About → System type、macOS は Apple menu → About This Mac を確認し、Linux は uname -m を実行します。x86_64 または amd64 は x64、arm64 または aarch64 は ARM64 です。

多くの Linux デスクトップは glibc、Alpine や小さなコンテナは musl を使います。baseline は古い x64 CPU、または通常版 CLI が illegal instruction で終了するときだけ選んでください。baseline 専用 VSIX はありません。

#### VS Code / VSCodium

VS Code または VSCodium 1.105.1 以降が必要です。VSIX は通常版 Kilo Code と同じ拡張機能 ID を使うため、インストール済みの Marketplace 版を置き換えます。

|システム|ファイル|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

対応ファイルをダウンロードし、Kilo Code の自動更新をオフにして、Extensions → … → Install from VSIX を選びます。インストール後にウィンドウを再読み込みしてください。下のコマンドでもできます。

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

表からアーカイブを1つダウンロードします。専用フォルダーへ全部展開し、サポートファイルを実行ファイルと同じ場所に置いたままにしてください。

|システム|ファイル|
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

フォルダーを PATH に追加する前に、展開したバイナリを一度実行します。後で別の Kilo が起動する場合は、下のパス確認を使い、LCM フォルダーを PATH の先に置きます。

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

### Kilo と LCM の設定

まず普段使っているプロバイダーを接続し、モデルを選びます。Conversation Memory は初期状態で有効です。拡張機能の Settings → Experimental で確認し、Settings → Context を開いてください。処理を始める基準値は 60% です。カスタムモデルでは、コンテキスト上限と出力トークン上限に正の値が必要です。入力上限は省略できます。

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

LCM が有効な間、compaction.auto は Kilo の旧 compaction 機能だけを制御し、LCM 自体はオフにしません。

#### Ollama

Ollama には実際のサーバーアドレスを指定します。同じ端末なら通常 localhost:11434、別端末ならコンピューターの LAN アドレスです。Ollama がそのアドレスで待ち受け、firewall が許可し、num_ctx が Kilo に入力した context limit 以上か確認してください。

### 動作確認

チャットを始め、プロバイダーとモデルを選んで /lcm status を実行します。状態が enabled で、容量が認識されていることを確認してください。タスクヘッダーまたは Context ページに使用量と LCM の動作状況が表示されます。/compact を使うと手動で LCM を1回実行できます。短い新規チャットでは、まだ要約する内容がない場合があります。

### 便利なヒント

要約にはモデル呼び出しを使うため、少し時間と料金が増えることがあります。まずは 60% のまま使い、早めに整理したい場合は下げ、呼び出し回数を減らしたい場合は上げます。LCM の記憶は現在のチャット専用です。コンテキストの書き出しには、機密性の高いプロンプトやツール出力が含まれる場合があります。

#### すぐできる対処

lcm_capacity_unknown が出たら、選択中のカスタムモデルの context と output limit を入力します。再起動後に拡張機能が戻るなら auto-update を切り、VSIX を再インストールします。CLI が違うなら which -a kilo または where.exe kilo を確認します。Alpine は musl、古い x64 は baseline を試します。

#### 更新またはロールバック

更新するときは、新しい VSIX を上書きインストールするか、展開済みの CLI フォルダーを入れ替えます。チャットは Kilo の SQLite に残ります。すぐ元に戻すには experimental.conversation_memory を false にしてください。公式版 Kilo Code や以前のプレリリースを再インストールすることもできます。

> [!NOTE]
> この先は公式版 Kilo Code の説明です。下にある通常のインストールリンクからは、この LCM 版はインストールされません。

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code、JetBrains、CLI で AI を使って開発するためのオープンソースのコーディングエージェント。</p>

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

Kilo Code は、[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native)、[CLI](https://kilo.ai/cli) など、あなたが作業する場所で使える AI コーディングエージェントです。オープンソースで、透明な価格体系を採用しています。500 以上のモデルから選択し、タスクの途中で切り替え、追加料金なしでモデルプロバイダーの料金を支払います。開始に API キーは不要です。

### インストール

Kilo を実行する場所を選んでください。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code 拡張機能](vscode:extension/kilocode.kilo-code)を直接インストールするか、[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) から入手してください。アカウントを作成すると、GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6、Gemini 3.1 Pro Preview を含む 500 以上のモデルを、すべてプロバイダー価格で利用できます。

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

その後、任意のプロジェクトディレクトリで `kilo` を実行して開始します。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace から [Kilo Code プラグイン](https://plugins.jetbrains.com/plugin/28350-kilo-code)をインストールするか、任意の JetBrains IDE の `Settings → Plugins` で "Kilo Code" を検索してください。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

ローカルマシンなしで、Web から [app.kilo.ai/cloud](https://app.kilo.ai/cloud) で Kilo を実行できます。

</details>

<details>
<summary><strong>コードレビュー</strong></summary>

<br>

[app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) で pull request に自動 AI コードレビューを設定できます。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

[app.kilo.ai/claw](https://app.kilo.ai/claw) で常時稼働する AI エージェントを起動できます。

</details>

<details>
<summary>GitHub Releases から CLI をインストールする（バイナリ）</summary>

[Releases ページ](https://github.com/Kilo-Org/kilocode/releases)から最新のバイナリをダウンロードしてください。

| プラットフォーム | アセット |
|---|---|
| Windows（ほとんどの PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

注: `x64-baseline` は AVX のない古い CPU 向けの互換ビルドです。`musl` は Alpine や glibc のない最小 Docker イメージ向けの静的リンクビルドです。`kilo-vscode-*.vsix` は VS Code 拡張機能パッケージであり、CLI ではありません。`Source code` アーカイブはソースからビルドするためのものです。

</details>

### Agents

Kilo には、タスクに応じて切り替えられる特化型 agents が含まれています。独自のカスタム agents も作成できます。

- **Code** - デフォルト。自然言語からコードを実装、編集します。
- **Plan** - コードを書く前にアーキテクチャを設計し、実装計画を作成します。
- **Ask** - ファイルを変更せずにコードベースに関する質問に答えます。
- **Debug** - 問題のトラブルシューティングと追跡を行います。
- **Review** - 変更をレビューし、パフォーマンス、セキュリティ、スタイル、テストカバレッジの問題を検出します。

[agents とカスタム agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) について詳しく学べます。

### 機能

- 自然言語から複数ファイルにわたる **コード生成**。
- ghost-text 提案と Tab での受け入れに対応した **インライン補完**。
- エージェントが自分の作業をレビューして修正する **セルフチェック**。
- コマンド実行と Web 自動化のための **ターミナルとブラウザ制御**。
- エージェントの機能を拡張する MCP サーバーを見つけて接続する **MCP マーケットプレイス**。
- レイテンシ、コスト、推論能力を作業に合わせるため、タスク途中の切り替えに対応した **500 以上のモデル**。

### 自律モード（CI/CD）

CI/CD パイプライン向けに、プロンプトなしで完全自律動作させるには `kilo run` に `--auto` を指定します。

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` はすべての権限プロンプトを無効にし、エージェントが確認なしで任意の操作を実行できるようにします。信頼できる環境でのみ使用してください。

### ドキュメント

設定やその他の内容については、[ドキュメント](https://kilo.ai/docs)をご覧ください。

### コントリビューション

開発者、ライター、その他すべての方からのコントリビューションを歓迎します。環境設定、コーディング標準、pull request の作成方法については [Contributing Guide](/CONTRIBUTING.md) から始めてください。VS Code 拡張機能と CLI のリリース手順は [RELEASING.md](../RELEASING.md)、JetBrains プラグインについては [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) を参照してください。

参加する前に [Code of Conduct](/CODE_OF_CONDUCT.md) を確認してください。

### ライセンス

MIT。帰属表示とライセンス通知を保持する限り、商用利用を含め、このコードを使用、変更、配布できます。[License](/LICENSE) を参照してください。

### FAQ

<details>
<summary>Kilo CLI はどこから来たのですか？</summary>

Kilo CLI は [OpenCode](https://github.com/anomalyco/opencode) の fork であり、Kilo agentic engineering プラットフォーム内で動作するように強化されています。

</details>

---

**コミュニティに参加** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
