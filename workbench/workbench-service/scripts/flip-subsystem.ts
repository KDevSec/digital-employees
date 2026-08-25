// flip-subsystem.ts —— 把 Bun 编译产物的 PE Subsystem 从 CUI(3) 翻成 GUI(2)。
// 用途：devzero-daemon.exe（计划任务守护专用变体）——GUI 子系统零控制台闪现。
// 背景：Bun 1.3.9 的 --windows-hide-console 实测不翻转 PE 头（产物仍 CUI=运行时隐藏=仍闪现）；
// GUI 子系统是唯一根治（托盘 exe 即此路线）。版本信息走 Bun 原生 --windows-title/publisher/version 旗标。
// CLI 版（devzero.exe）保持 console 不动——status/stop 需要控制台输出。
// PE 布局：e_lfanew(0x3C) -> "PE\0\0" + IMAGE_FILE_HEADER(20) + IMAGE_OPTIONAL_HEADER，
// Subsystem 位于 optional header +68（PE32/PE32+ 同偏移）：2=GUI 3=CUI。
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dst] = process.argv.slice(2)
if (!src || !dst) {
  console.error('用法: bun run scripts/flip-subsystem.ts <src.exe> <dst.exe>')
  process.exit(1)
}

const buf = readFileSync(src)
const peOff = buf.readUInt32LE(0x3c)
if (buf[peOff] !== 0x50 || buf[peOff + 1] !== 0x45) throw new Error(`${src}: 不是 PE 文件`)
const magic = buf.readUInt16LE(peOff + 24)
if (magic !== 0x20b && magic !== 0x10b) throw new Error(`${src}: 非 PE32/PE32+ (magic=0x${magic.toString(16)})`)
const subOff = peOff + 24 + 68
const cur = buf.readUInt16LE(subOff)
if (cur !== 3) throw new Error(`${src}: Subsystem=${cur}（期望 3=CUI，只翻 console 产物）`)
buf.writeUInt16LE(2, subOff)
writeFileSync(dst, buf)
console.log(`subsystem CUI(3) -> GUI(2): ${dst} (${buf.length} bytes)`)
