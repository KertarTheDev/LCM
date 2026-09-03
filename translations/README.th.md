<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | ไทย | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<!-- LCM_ONBOARDING_START -->
<a id="install-lcm-prerelease"></a>
## ลองใช้ LCM รุ่นก่อนเผยแพร่

Kilo Code รุ่นทดลองนี้ช่วยให้แชตยาวยังใช้งานได้ โดยเปลี่ยนบริบทเก่าที่ใช้แล้วเป็นต้นไม้สรุปที่ค้นหาได้ งานล่าสุดยังคงตรงตามต้นฉบับ และเอเจนต์ดึงรายละเอียดเก่ากลับมาได้เมื่อต้องการ

> [!IMPORTANT]
> รุ่นที่มี LCM เปิดให้ดาวน์โหลดเฉพาะใน GitHub Releases ของคลังนี้เท่านั้น ส่วน Marketplace, Open VSX, npm, Homebrew, AUR, บริการคลาวด์ และ JetBrains จะติดตั้ง Kilo Code รุ่นทางการที่ไม่มี LCM

[อยากรู้แนวคิดเบื้องหลังหรือไม่ อ่านงานวิจัย LCM ต้นฉบับโดย Clint Ehrlich และ Theodore Blackman](https://arxiv.org/abs/2605.04050)

**รุ่นปัจจุบัน:** [`v7.5.9-lcm.1`](https://github.com/KertarTheDev/LCM/releases/tag/v7.5.9-lcm.1)

### เลือกไฟล์ดาวน์โหลด

หากใช้ VS Code หรือ VSCodium ให้เลือกไฟล์ VSIX หากทำงานในเทอร์มินัลให้เลือกไฟล์บีบอัด CLI และสามารถติดตั้งทั้งสองแบบได้

#### ตรวจระบบของคุณ

บน Windows ดู Settings → System → About → System type; บน macOS ดู Apple menu → About This Mac; บน Linux รัน uname -m โดย x86_64 หรือ amd64 คือ x64 ส่วน arm64 หรือ aarch64 คือ ARM64

Linux สำหรับเดสก์ท็อปส่วนใหญ่ใช้ glibc ส่วน Alpine และคอนเทนเนอร์ขนาดเล็กใช้ musl เลือก baseline เฉพาะโปรเซสเซอร์ x64 รุ่นเก่า หรือเมื่อ CLI ปกติหยุดด้วยข้อผิดพลาด illegal instruction เท่านั้น ไม่มีไฟล์ VSIX แบบ baseline แยกต่างหาก

#### VS Code / VSCodium

ต้องใช้ VS Code หรือ VSCodium 1.105.1 ขึ้นไป VSIX ใช้ extension ID เดียวกับ Kilo Code ปกติ จึงแทนที่รุ่น Marketplace ที่ติดตั้งอยู่

|ระบบ|ไฟล์|
|---|---|
|Windows x64|`kilo-vscode-win32-x64.vsix`|
|Windows ARM64|`kilo-vscode-win32-arm64.vsix`|
|macOS x64 (Intel)|`kilo-vscode-darwin-x64.vsix`|
|macOS ARM64 (Apple Silicon)|`kilo-vscode-darwin-arm64.vsix`|
|Linux x64 (glibc)|`kilo-vscode-linux-x64.vsix`|
|Linux ARM64 (glibc)|`kilo-vscode-linux-arm64.vsix`|
|Alpine x64 (musl)|`kilo-vscode-alpine-x64.vsix`|
|Alpine ARM64 (musl)|`kilo-vscode-alpine-arm64.vsix`|

ดาวน์โหลดไฟล์ที่ตรงกับเครื่อง ปิดการอัปเดตอัตโนมัติของ Kilo Code แล้วเลือก Extensions → … → Install from VSIX จากนั้น reload หน้าต่าง หรือใช้คำสั่งด้านล่าง

```bash
code --install-extension ./kilo-vscode-linux-x64.vsix --force
codium --install-extension ./kilo-vscode-linux-x64.vsix --force
```

#### CLI

ดาวน์โหลด archive หนึ่งไฟล์จากตาราง แตกไฟล์ทั้งหมดไว้ใน folder แยก และเก็บไฟล์สนับสนุนทุกไฟล์ไว้ข้าง executable

|ระบบ|ไฟล์|
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

ลองรัน binary ที่แตกไฟล์แล้วหนึ่งครั้งก่อนเพิ่ม folder ลง PATH หากภายหลังเปิด Kilo คนละรุ่น ให้ใช้คำสั่งตรวจ path ด้านล่างและวาง folder LCM ไว้ก่อนใน PATH

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

### ตั้งค่า Kilo และ LCM

เชื่อมต่อผู้ให้บริการที่ใช้เป็นประจำแล้วเลือกโมเดล Conversation Memory เปิดไว้โดยค่าเริ่มต้น ตรวจสอบได้ที่ Settings → Experimental จากนั้นเปิด Settings → Context โดยจุดเริ่มต้นตั้งไว้ที่ 60% โมเดลที่กำหนดเองต้องระบุขีดจำกัดบริบทและโทเค็นขาออกเป็นจำนวนบวก ส่วนขีดจำกัดขาเข้าไม่บังคับ

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

เมื่อเปิด LCM ค่า compaction.auto จะควบคุมเฉพาะระบบย่อบริบทแบบเก่าของ Kilo และไม่ได้ปิด LCM

#### Ollama

สำหรับ Ollama ให้ใช้ที่อยู่ server จริง—มักเป็น localhost:11434 บนเครื่องเดียวกัน หรือ LAN address ของคอมพิวเตอร์เมื่อเชื่อมจากอุปกรณ์อื่น ตรวจว่า Ollama ฟังอยู่ที่ address นั้น firewall อนุญาต และ num_ctx ไม่น้อยกว่า context limit ที่ใส่ใน Kilo

### ตรวจว่าใช้งานได้

เริ่มแชต เลือกผู้ให้บริการและโมเดล แล้วรัน /lcm status สถานะควรเป็น enabled และระบบควรรู้ความจุ ส่วนหัวงานหรือหน้า Context จะแสดงการใช้งานและกิจกรรมของ LCM คำสั่ง /compact จะเริ่มรอบ LCM ด้วยตนเองหนึ่งครั้ง แชตใหม่สั้น ๆ อาจยังไม่มีเนื้อหาให้สรุป

### เคล็ดลับ

การสรุปต้องเรียกใช้โมเดล จึงอาจเพิ่มเวลาและค่าใช้จ่ายเล็กน้อย เริ่มที่ 60% ลดค่าหากต้องการให้จัดการเร็วขึ้น หรือเพิ่มค่าเพื่อลดจำนวนครั้งที่เรียกโมเดล หน่วยความจำ LCM เป็นของแชตปัจจุบัน การส่งออกบริบทอาจมีพรอมต์และผลลัพธ์จากเครื่องมือที่เป็นข้อมูลสำคัญ

#### วิธีแก้ด่วน

หากเห็น lcm_capacity_unknown ให้กรอก context และ output limit ของ custom model หาก extension เปลี่ยนกลับหลัง restart ให้ปิด auto-update และติดตั้ง VSIX ใหม่ หาก CLI ผิดรุ่นให้ดู which -a kilo หรือ where.exe kilo บน Alpine ใช้ musl; CPU x64 เก่าให้ลอง baseline

#### อัปเดตหรือย้อนกลับ

อัปเดตได้โดยติดตั้ง VSIX ใหม่ทับของเดิม หรือเปลี่ยนโฟลเดอร์ CLI ที่แตกไฟล์ไว้ แชตยังคงอยู่ใน SQLite ของ Kilo หากต้องย้อนกลับอย่างรวดเร็ว ให้ตั้ง experimental.conversation_memory เป็น false หรือกลับไปติดตั้ง Kilo Code รุ่นทางการหรือรุ่นก่อนเผยแพร่ที่เก่ากว่า

> [!NOTE]
> เนื้อหาที่เหลือของหน้านี้อธิบาย Kilo Code รุ่นทางการ ลิงก์ติดตั้งทั่วไปด้านล่างจะไม่ติดตั้งรุ่นที่มี LCM นี้

<!-- LCM_ONBOARDING_END -->

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">เอเจนต์เขียนโค้ดโอเพนซอร์สสำหรับสร้างด้วย AI ใน VS Code, JetBrains หรือ CLI</p>

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

Kilo Code คือเอเจนต์เขียนโค้ดด้วย AI ที่ทำงานได้ทุกที่ที่คุณทำงาน: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) และ [CLI](https://kilo.ai/cli) เป็นโอเพนซอร์สและมีราคาที่โปร่งใส คุณเลือกได้จากโมเดลมากกว่า 500 รายการ สลับโมเดลระหว่างทำงาน และจ่ายตามราคาของผู้ให้บริการโมเดลโดยไม่มีส่วนเพิ่ม ไม่ต้องใช้ API key เพื่อเริ่มต้น

### การติดตั้ง

เลือกตำแหน่งที่คุณต้องการใช้งาน Kilo

<details open>
<summary><strong>VS Code</strong></summary>

<br>

ติดตั้ง [ส่วนขยาย Kilo Code](vscode:extension/kilocode.kilo-code) โดยตรง หรือดาวน์โหลดจาก [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) สร้างบัญชีแล้วคุณจะเข้าถึงโมเดลมากกว่า 500 รายการ รวมถึง GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 และ Gemini 3.1 Pro Preview ทั้งหมดในราคาผู้ให้บริการ

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

จากนั้นรัน `kilo` ในไดเรกทอรีโปรเจกต์ใดก็ได้เพื่อเริ่มต้น

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

ติดตั้ง [ปลั๊กอิน Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) จาก JetBrains Marketplace หรือค้นหา "Kilo Code" ใน `Settings → Plugins` ภายใน JetBrains IDE ใดก็ได้

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

รัน Kilo จากเว็บโดยไม่ต้องใช้เครื่องภายในที่ [app.kilo.ai/cloud](https://app.kilo.ai/cloud)

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

ตั้งค่าการรีวิวโค้ดด้วย AI อัตโนมัติบน pull request ของคุณที่ [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

เริ่มเอเจนต์ AI ที่ทำงานตลอดเวลาของคุณที่ [app.kilo.ai/claw](https://app.kilo.ai/claw)

</details>

<details>
<summary>ติดตั้ง CLI จาก GitHub Releases (ไบนารี)</summary>

ดาวน์โหลดไบนารีล่าสุดจาก [หน้า Releases](https://github.com/Kilo-Org/kilocode/releases)

| แพลตฟอร์ม | Asset |
|---|---|
| Windows (พีซีส่วนใหญ่) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

หมายเหตุ: `x64-baseline` คือ build ที่เข้ากันได้สำหรับ CPU รุ่นเก่าที่ไม่มี AVX ส่วน `musl` คือ build แบบ static link สำหรับ Alpine หรือ Docker image ขั้นต่ำที่ไม่มี glibc `kilo-vscode-*.vsix` คือแพ็กเกจส่วนขยาย VS Code ไม่ใช่ CLI ไฟล์ `Source code` ใช้สำหรับ build จากซอร์ส

</details>

### Agents

Kilo มาพร้อม agents เฉพาะทางที่คุณสลับได้ตามงาน คุณยังสร้าง agents แบบกำหนดเองได้ด้วย

- **Code** - ค่าเริ่มต้น ใช้ภาษาธรรมชาติในการเขียนและแก้ไขโค้ด
- **Plan** - ออกแบบสถาปัตยกรรมและเขียนแผนการทำงานก่อนมีการเขียนโค้ด
- **Ask** - ตอบคำถามเกี่ยวกับ codebase โดยไม่แตะไฟล์
- **Debug** - แก้ไขและติดตามปัญหา
- **Review** - รีวิวการเปลี่ยนแปลงและค้นหาปัญหาด้านประสิทธิภาพ ความปลอดภัย สไตล์ และ test coverage

เรียนรู้เพิ่มเติมเกี่ยวกับ [agents และ agents แบบกำหนดเอง](https://kilo.ai/docs/code-with-ai/agents/using-agents)

### ทำอะไรได้บ้าง

- **สร้างโค้ด** จากภาษาธรรมชาติข้ามหลายไฟล์
- **เติมโค้ดอัตโนมัติแบบ inline** พร้อมคำแนะนำ ghost-text และกด Tab เพื่อรับ
- **ตรวจสอบตัวเอง** เพื่อให้เอเจนต์รีวิวและแก้งานของตนเอง
- **ควบคุม terminal และ browser** เพื่อรันคำสั่งและทำงานบนเว็บอัตโนมัติ
- **MCP marketplace** เพื่อค้นหาและเชื่อมต่อ MCP server ที่ขยายความสามารถของเอเจนต์
- **โมเดลมากกว่า 500 รายการ** พร้อมการสลับระหว่างงาน เพื่อให้เหมาะกับ latency, cost และ reasoning ของงาน

### โหมดอัตโนมัติ (CI/CD)

รัน `kilo run` พร้อม `--auto` เพื่อทำงานอัตโนมัติเต็มรูปแบบโดยไม่มี prompts เหมาะสำหรับ CI/CD pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` ปิด prompt สิทธิ์ทั้งหมดและให้เอเจนต์ดำเนินการใดก็ได้โดยไม่ต้องยืนยัน ใช้เฉพาะในสภาพแวดล้อมที่เชื่อถือได้เท่านั้น

### เอกสาร

สำหรับการตั้งค่าและเรื่องอื่น ๆ ดูที่ [เอกสาร](https://kilo.ai/docs)

### การมีส่วนร่วม

ยินดีรับการมีส่วนร่วมจากนักพัฒนา นักเขียน และทุกคน เริ่มจาก [Contributing Guide](/CONTRIBUTING.md) สำหรับการตั้งค่าสภาพแวดล้อม มาตรฐานโค้ด และวิธีเปิด pull request ดู [RELEASING.md](../RELEASING.md) สำหรับกระบวนการ release ของส่วนขยาย VS Code และ CLI และ [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) สำหรับปลั๊กอิน JetBrains

โปรดอ่าน [Code of Conduct](/CODE_OF_CONDUCT.md) ก่อนเข้าร่วม

### License

MIT คุณสามารถใช้ แก้ไข และแจกจ่ายโค้ดนี้ รวมถึงเชิงพาณิชย์ ตราบใดที่ยังเก็บ attribution และประกาศ license ไว้ ดู [License](/LICENSE)

### FAQ

<details>
<summary>Kilo CLI มาจากไหน?</summary>

Kilo CLI เป็น fork ของ [OpenCode](https://github.com/anomalyco/opencode) ที่ได้รับการปรับปรุงให้ทำงานในแพลตฟอร์ม Kilo agentic engineering

</details>

---

**เข้าร่วมชุมชน** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
