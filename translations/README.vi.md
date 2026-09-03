<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | Tiếng Việt
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## Dùng thử bản phát hành trước LCM

Bản Kilo Code thử nghiệm này giúp bạn không mất mạch trong những cuộc trò chuyện dài: ngữ cảnh cũ đã dùng được gom thành cây tóm tắt có thể tìm kiếm. Nội dung gần đây vẫn được giữ nguyên, còn trợ lý có thể lấy lại các chi tiết trước đó khi cần.

> [!IMPORTANT]
> Bản có LCM chỉ được phát hành trong mục GitHub Releases của kho mã này. Marketplace, Open VSX, npm, Homebrew, AUR, dịch vụ đám mây và JetBrains sẽ cài bản Kilo Code chính thức, không có LCM.

[Muốn hiểu ý tưởng? Hãy đọc bài báo LCM gốc của Clint Ehrlich và Theodore Blackman.](https://arxiv.org/abs/2605.04050)

**Bản hiện tại:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### Chọn file tải

Chọn VSIX nếu dùng VS Code hoặc VSCodium. Chọn gói CLI nếu làm việc trong terminal. Bạn có thể cài cả hai.

#### Xác định hệ thống

Trên Windows xem Settings → System → About → System type; trên macOS xem Apple menu → About This Mac; trên Linux chạy uname -m. x86_64 hoặc amd64 là x64, còn arm64 hoặc aarch64 là ARM64.

Phần lớn bản phân phối Linux cho máy tính để bàn dùng glibc; Alpine và các container nhỏ dùng musl. Chỉ chọn baseline cho bộ xử lý x64 cũ hoặc khi CLI thông thường dừng với lỗi illegal instruction. Không có VSIX baseline riêng.

#### VS Code / VSCodium

Cần VS Code hoặc VSCodium 1.105.1 trở lên. VSIX dùng cùng extension ID với Kilo Code thường nên sẽ thay thế bản Marketplace đã cài.

|Hệ thống|File|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

Tải đúng file, tắt tự động cập nhật Kilo Code rồi chọn Extensions → … → Install from VSIX. Reload cửa sổ sau khi cài. Bạn cũng có thể dùng lệnh bên dưới.

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

Tải một gói trong bảng. Giải nén toàn bộ vào folder riêng và giữ mọi file hỗ trợ bên cạnh file chạy.

|Hệ thống|File|
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

Chạy binary đã giải nén một lần trước khi thêm folder vào PATH. Nếu sau đó một Kilo khác chạy, dùng lệnh kiểm tra đường dẫn bên dưới và đặt folder LCM sớm hơn trong PATH.

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

### Thiết lập Kilo và LCM

Trước tiên, hãy kết nối nhà cung cấp bạn thường dùng và chọn một mô hình. Conversation Memory được bật mặc định. Kiểm tra trong Settings → Experimental, rồi mở Settings → Context; ngưỡng khởi động ban đầu là 60%. Mô hình tùy chỉnh cần giới hạn ngữ cảnh và đầu ra lớn hơn 0; giới hạn đầu vào là tùy chọn.

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

Khi LCM bật, compaction.auto chỉ điều khiển hệ thống nén cũ của Kilo; nó không tắt LCM.

#### Ollama

Với Ollama, dùng địa chỉ server thật—thường là localhost:11434 trên cùng máy hoặc địa chỉ LAN của máy tính từ thiết bị khác. Đảm bảo Ollama lắng nghe ở đó, firewall cho phép và num_ctx ít nhất bằng giới hạn context đã nhập trong Kilo.

### Kiểm tra hoạt động

Bắt đầu một cuộc trò chuyện, chọn nhà cung cấp và mô hình rồi chạy /lcm status. Trạng thái phải là enabled và dung lượng phải được nhận diện. Phần đầu tác vụ hoặc trang Context hiển thị mức sử dụng và hoạt động của LCM. /compact chạy một vòng LCM thủ công; cuộc trò chuyện mới và ngắn có thể chưa có gì để tóm tắt.

### Mẹo hữu ích

Việc tóm tắt cần gọi mô hình nên có thể tốn thêm một chút thời gian và chi phí. Hãy bắt đầu với 60%; giảm xuống để xử lý sớm hơn hoặc tăng lên để giảm số lần gọi. Bộ nhớ LCM chỉ thuộc cuộc trò chuyện hiện tại. Bản xuất ngữ cảnh có thể chứa câu lệnh và kết quả công cụ nhạy cảm.

#### Cách sửa nhanh

Nếu thấy lcm_capacity_unknown, điền giới hạn context và output của custom model đã chọn. Nếu extension đổi lại sau khi restart, tắt auto-update và cài lại VSIX. Nếu sai CLI, kiểm tra which -a kilo hoặc where.exe kilo. Trên Alpine dùng musl; CPU x64 cũ thử baseline.

#### Cập nhật hoặc quay lại

Để cập nhật, cài VSIX mới đè lên bản cũ hoặc thay thư mục CLI đã giải nén. Cuộc trò chuyện vẫn nằm trong SQLite của Kilo. Để quay lại nhanh, đặt experimental.conversation_memory thành false; bạn cũng có thể cài lại bản Kilo Code chính thức hoặc một bản phát hành trước cũ hơn.

> [!NOTE]
> Phần còn lại của trang mô tả bản Kilo Code chính thức. Các liên kết cài đặt thông thường bên dưới không cài bản có LCM này.

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Tác nhân lập trình mã nguồn mở để xây dựng với AI trong VS Code, JetBrains hoặc CLI.</p>

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

Kilo Code là một tác nhân lập trình AI đồng hành với bạn ở mọi nơi bạn làm việc: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) và [CLI](https://kilo.ai/cli). Dự án là mã nguồn mở với giá minh bạch. Bạn chọn trong hơn 500 mô hình, chuyển đổi giữa chúng giữa chừng một tác vụ và trả theo giá của nhà cung cấp mô hình, không có phụ phí. Không cần API key để bắt đầu.

### Cài đặt

Chọn nơi bạn muốn chạy Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Cài trực tiếp [tiện ích Kilo Code](vscode:extension/kilocode.kilo-code), hoặc tải từ [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Tạo tài khoản và bạn sẽ có quyền truy cập hơn 500 mô hình, bao gồm GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 và Gemini 3.1 Pro Preview, tất cả theo giá của nhà cung cấp.

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

Sau đó chạy `kilo` trong bất kỳ thư mục dự án nào để bắt đầu.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Cài [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) từ JetBrains Marketplace, hoặc tìm "Kilo Code" trong `Settings → Plugins` bên trong bất kỳ JetBrains IDE nào.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Chạy Kilo từ web, không cần máy cục bộ, tại [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Thiết lập review code tự động bằng AI cho pull request của bạn tại [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Khởi chạy AI agent luôn hoạt động của bạn tại [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Cài CLI từ GitHub Releases (binary)</summary>

Tải binary mới nhất từ [trang Releases](https://github.com/Kilo-Org/kilocode/releases).

| Nền tảng | Asset |
|---|---|
| Windows (hầu hết PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Ghi chú: `x64-baseline` là build tương thích cho CPU cũ không có AVX. `musl` là build liên kết tĩnh cho Alpine hoặc image Docker tối giản không có glibc. `kilo-vscode-*.vsix` là gói tiện ích VS Code, không phải CLI. Các archive `Source code` dùng để build từ mã nguồn.

</details>

### Agents

Kilo đi kèm các agents chuyên biệt để bạn chuyển đổi tùy theo tác vụ. Bạn cũng có thể tạo agents tùy chỉnh của riêng mình.

- **Code** - Mặc định. Triển khai và chỉnh sửa code từ ngôn ngữ tự nhiên.
- **Plan** - Thiết kế kiến trúc và viết kế hoạch triển khai trước khi viết code.
- **Ask** - Trả lời câu hỏi về codebase mà không chạm vào file.
- **Debug** - Khắc phục và truy vết sự cố.
- **Review** - Review thay đổi của bạn và phát hiện vấn đề về hiệu năng, bảo mật, phong cách và độ phủ test.

Tìm hiểu thêm về [agents và agents tùy chỉnh](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Nó làm gì

- **Sinh code** từ ngôn ngữ tự nhiên, trên nhiều file.
- **Tự động hoàn thành inline** với gợi ý ghost-text và Tab để chấp nhận.
- **Tự kiểm tra** để agent review và sửa công việc của chính nó.
- **Điều khiển terminal và trình duyệt** để chạy lệnh và tự động hóa web.
- **MCP marketplace** để tìm và kết nối MCP server mở rộng khả năng của agent.
- **Hơn 500 mô hình** với chuyển đổi giữa chừng tác vụ, để bạn khớp độ trễ, chi phí và reasoning với công việc.

### Chế độ tự động (CI/CD)

Chạy `kilo run` với `--auto` để hoạt động hoàn toàn tự động không có prompts, dành cho pipeline CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` tắt mọi prompt xin quyền và cho phép agent thực hiện bất kỳ hành động nào mà không cần xác nhận. Chỉ dùng trong môi trường đáng tin cậy.

### Tài liệu

Về cấu hình và mọi thứ khác, hãy xem [tài liệu](https://kilo.ai/docs).

### Đóng góp

Chúng tôi chào đón đóng góp từ developer, writer và tất cả mọi người. Bắt đầu với [Contributing Guide](/CONTRIBUTING.md) để thiết lập môi trường, tiêu chuẩn code và cách mở pull request. Xem [RELEASING.md](../RELEASING.md) cho quy trình release tiện ích VS Code và CLI, và [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) cho plugin JetBrains.

Vui lòng đọc [Code of Conduct](/CODE_OF_CONDUCT.md) trước khi tham gia.

### License

MIT. Bạn có thể sử dụng, chỉnh sửa và phân phối code này, kể cả cho mục đích thương mại, miễn là giữ lại thông tin ghi nhận và thông báo license. Xem [License](/LICENSE).

### FAQ

<details>
<summary>Kilo CLI đến từ đâu?</summary>

Kilo CLI là một fork của [OpenCode](https://github.com/anomalyco/opencode), được cải tiến để hoạt động trong nền tảng Kilo agentic engineering.

</details>

---

**Tham gia cộng đồng** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
