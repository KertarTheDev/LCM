<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | Português (Brasil) | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Experimente a prévia do LCM

Esta versão experimental do Kilo Code mantém conversas longas úteis ao transformar contexto antigo já usado em uma árvore de resumos pesquisável. O trabalho recente continua exato, e o agente pode recuperar detalhes antigos quando precisar.

> [!IMPORTANT]
> As versões com LCM estão disponíveis somente nos GitHub Releases deste repositório. Marketplace, Open VSX, npm, Homebrew, AUR, serviços em nuvem e JetBrains instalam a versão oficial do Kilo Code, sem LCM.

[Quer entender a ideia? Leia o artigo original do LCM, de Clint Ehrlich e Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Prévia atual:** [`v7.4.23-lcm.13`](https://github.com/KertarTheDev/LCM/releases/tag/v7.4.23-lcm.13)

### Escolha o download

Use um VSIX no VS Code ou VSCodium. Use um arquivo CLI se trabalha no terminal. Você pode instalar os dois.

#### Descubra seu sistema

No Windows, veja Settings → System → About → System type; no macOS, Apple menu → About This Mac; no Linux, rode uname -m. x86_64 ou amd64 significa x64; arm64 ou aarch64 significa ARM64.

A maioria das distribuições Linux para desktop usa glibc; o Alpine e alguns contêineres mínimos usam musl. Escolha baseline somente para processadores x64 antigos ou se a CLI normal encerrar com o erro illegal instruction. Não existe um VSIX baseline separado.

#### VS Code / VSCodium

É preciso VS Code ou VSCodium 1.105.1 ou mais novo. O VSIX usa o ID normal da extensão Kilo Code, então substitui uma instalação do Marketplace.

|Sistema|Arquivo|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Baixe o arquivo certo, desative a atualização automática do Kilo Code e use Extensions → … → Install from VSIX. Recarregue a janela depois. Você também pode usar um dos comandos abaixo.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Baixe um arquivo da tabela. Extraia tudo em uma pasta própria e mantenha todos os arquivos de suporte junto do executável.

|Sistema|Arquivo|
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

Rode o binário extraído antes de adicionar a pasta ao PATH. Se outra versão do Kilo abrir depois, use as verificações abaixo e coloque a pasta do LCM antes no PATH.

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

### Configure Kilo e LCM

Conecte o provedor que você já usa e escolha um modelo. Conversation Memory vem ativada por padrão. Na extensão, confirme em Settings → Experimental e abra Settings → Context para ajustar o ponto de início, que começa em 40%. Modelos personalizados precisam de limites positivos de contexto e de saída; o limite de entrada é opcional.

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

Com LCM ativo, compaction.auto controla apenas o sistema antigo de compactação do Kilo; ele não desliga o LCM.

#### Ollama

No Ollama, use o endereço real do servidor: geralmente localhost:11434 na mesma máquina ou o endereço LAN do computador em outro dispositivo. Confirme que o Ollama escuta nesse endereço, que o firewall permite e que num_ctx é pelo menos o limite de contexto informado no Kilo.

### Confira se funciona

Abra uma conversa, escolha o provedor e o modelo e rode /lcm status. O status deve aparecer como enabled e a capacidade precisa estar disponível. O cabeçalho da tarefa ou a tela Context mostra o uso e a atividade do LCM. /compact solicita um ciclo manual; em uma conversa nova e curta talvez ainda não haja nada para resumir.

### Algumas dicas

Os resumos usam chamadas de modelo, então podem acrescentar um pouco de tempo e custo. Comece com 40%; diminua para manutenção mais cedo ou aumente para menos chamadas. A memória do LCM pertence à conversa atual. A exportação de contexto pode conter prompts e saídas sensíveis.

#### Correções rápidas

Se aparecer lcm_capacity_unknown, preencha os limites de contexto e saída do modelo personalizado. Se a extensão voltar após reiniciar, desative auto-update e reinstale o VSIX. Se a CLI estiver errada, use which -a kilo ou where.exe kilo. No Alpine use musl; em CPU x64 antiga tente baseline.

#### Atualize ou volte

Para atualizar, instale o VSIX novo sobre o antigo ou troque a pasta extraída da CLI. Suas conversas ficam no SQLite do Kilo. Para voltar rápido, defina experimental.conversation_memory como false; também dá para reinstalar a versão oficial do Kilo Code ou uma prévia anterior.

> [!NOTE]
> O restante desta página descreve a versão oficial do Kilo Code. Os links comuns de instalação abaixo não instalam esta versão com LCM.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">O agente de programação open source para criar com IA no VS Code, JetBrains ou CLI.</p>

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

Kilo Code é um agente de programação com IA que acompanha você em todos os lugares onde trabalha: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) e [CLI](https://kilo.ai/cli). É open source e tem preços abertos. Você escolhe entre mais de 500 modelos, alterna entre eles no meio da tarefa e paga a tarifa do provedor do modelo sem acréscimo. Não são necessárias chaves de API para começar.

### Instalação

Escolha onde você quer executar o Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Instale a [extensão Kilo Code](vscode:extension/kilocode.kilo-code) diretamente ou baixe pelo [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Crie uma conta e você terá acesso a mais de 500 modelos, incluindo GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 e Gemini 3.1 Pro Preview, todos com preço do provedor.

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

Depois execute `kilo` em qualquer diretório de projeto para começar.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Instale o [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) pelo JetBrains Marketplace ou procure por "Kilo Code" em `Settings → Plugins` dentro de qualquer IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Execute o Kilo pela web, sem máquina local, em [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Revisões de código</strong></summary>

<br>

Configure revisões automáticas de código com IA nos seus pull requests em [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Inicie seu agente de IA sempre ativo em [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Instalar a CLI pelo GitHub Releases (binários)</summary>

Baixe o binário mais recente na [página de Releases](https://github.com/Kilo-Org/kilocode/releases).

| Plataforma | Asset |
|---|---|
| Windows (a maioria dos PCs) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notas: `x64-baseline` é uma build de compatibilidade para CPUs antigas sem AVX. `musl` é a build com link estático para Alpine ou imagens Docker mínimas sem glibc. `kilo-vscode-*.vsix` é o pacote da extensão VS Code, não a CLI. Arquivos `Source code` são para compilar a partir do código-fonte.

</details>

### Agents

Kilo vem com agents especializados para você alternar dependendo da tarefa. Você também pode criar seus próprios agents personalizados.

- **Code** - O padrão. Implementa e edita código a partir de linguagem natural.
- **Plan** - Desenha a arquitetura e escreve planos de implementação antes de qualquer código ser escrito.
- **Ask** - Responde perguntas sobre sua base de código sem tocar nos arquivos.
- **Debug** - Soluciona e rastreia problemas.
- **Review** - Revisa suas mudanças e aponta problemas de performance, segurança, estilo e cobertura de testes.

Saiba mais sobre [agents e agents personalizados](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### O que ele faz

- **Geração de código** a partir de linguagem natural, em vários arquivos.
- **Autocomplete inline** com sugestões ghost-text e Tab para aceitar.
- **Autoverificação** para que o agente revise e corrija o próprio trabalho.
- **Controle de terminal e navegador** para executar comandos e automatizar a web.
- **Marketplace MCP** para encontrar e conectar servidores MCP que ampliam o que o agente pode fazer.
- **Mais de 500 modelos** com alternância no meio da tarefa, para combinar latência, custo e raciocínio com o trabalho.

### Modo autônomo (CI/CD)

Execute `kilo run` com `--auto` para operação totalmente autônoma e sem prompts, criada para pipelines CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` desativa todos os prompts de permissão e permite que o agente execute qualquer ação sem confirmação. Use apenas em ambientes confiáveis.

### Documentação

Para configuração e todo o resto, consulte a [documentação](https://kilo.ai/docs).

### Contribuindo

Contribuições são bem-vindas de desenvolvedores, escritores e qualquer pessoa. Comece pelo [Contributing Guide](/CONTRIBUTING.md) para configurar o ambiente, conhecer os padrões de código e abrir um pull request. Consulte [RELEASING.md](../RELEASING.md) para o processo de release da extensão VS Code e da CLI, e [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) para o plugin JetBrains.

Leia nosso [Code of Conduct](/CODE_OF_CONDUCT.md) antes de participar.

### Licença

MIT. Você pode usar, modificar e distribuir este código, inclusive comercialmente, desde que mantenha os avisos de atribuição e licença. Consulte [License](/LICENSE).

### FAQ

<details>
<summary>De onde veio o Kilo CLI?</summary>

Kilo CLI é um fork do [OpenCode](https://github.com/anomalyco/opencode), aprimorado para funcionar dentro da plataforma de engenharia agêntica da Kilo.

</details>

---

**Participe da comunidade** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
