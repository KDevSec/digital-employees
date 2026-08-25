// Package icons 四态托盘图标的运行时生成（TR-02 资产）——16x16 32bpp 单尺寸 ICO。
// 布局移植 M0 spike 的 makeIco：ICONDIR + ICONDIRENTRY + BITMAPINFOHEADER + BGRA 像素 + AND mask。
// 设计 §4.3 的多尺寸 .ico 资产方案留作后续升级；V0.1 用单尺寸纯色圆点（M0 实测可用）。
package icons

// 布局常量（字节）
const (
	iconDirSize      = 6  // ICONDIR：reserved(2) + type(2) + count(2)
	iconDirEntrySize = 16 // ICONDIRENTRY
	bmpHeaderSize    = 40 // BITMAPINFOHEADER
	// Width / Height 图标边长（像素）
	Width  = 16
	Height = 16
	// BPP 位深
	BPP          = 32
	pixelBytes   = Width * Height * 4                         // 1024
	andMaskBytes = Width * Height / 8                         // 32（1 bit/像素；不按 32bit 行对齐——M0 实测 Windows 接受，32bpp 由 alpha 决定）
	imageSize    = bmpHeaderSize + pixelBytes + andMaskBytes  // 1096
	icoSize      = iconDirSize + iconDirEntrySize + imageSize // 1118
)

// IcoBytes 生成纯色 16x16 32bpp ICO 字节流。像素 BGRA 序（B 在前），alpha=255 不透明。
func IcoBytes(r, g, b uint8) []byte {
	ico := make([]byte, icoSize)

	// ICONDIR：reserved=0,0；type=1,0（icon）；count=1,0
	ico[0], ico[1] = 0, 0
	ico[2], ico[3] = 1, 0
	ico[4], ico[5] = 1, 0

	// ICONDIRENTRY：宽/高/调色板/保留/planes/bpp/数据长度/数据偏移
	ico[6] = Width
	ico[7] = Height
	ico[8] = 0 // 调色板数（0 = 无调色板）
	ico[9] = 0 // 保留
	putLE16(ico[10:12], 1)
	putLE16(ico[12:14], BPP)
	putLE32(ico[14:18], imageSize)
	putLE32(ico[18:22], iconDirSize+iconDirEntrySize) // 数据偏移 = 22

	// BITMAPINFOHEADER（偏移 22 起；其余字段零值已就位）
	off := iconDirSize + iconDirEntrySize
	putLE32(ico[off+0:off+4], bmpHeaderSize) // biSize
	putLE32(ico[off+4:off+8], Width)         // biWidth
	putLE32(ico[off+8:off+12], Height*2)     // biHeight 翻倍：XOR 16 行 + AND 16 行
	putLE16(ico[off+12:off+14], 1)           // biPlanes
	putLE16(ico[off+14:off+16], BPP)         // biBitCount

	// 像素段（偏移 62 起）：BGRA 逐像素填色。纯色图标无行序差异（BMP 自下而上仅影响非对称图样）
	px := off + bmpHeaderSize
	for i := 0; i < Width*Height; i++ {
		ico[px+i*4+0] = b
		ico[px+i*4+1] = g
		ico[px+i*4+2] = r
		ico[px+i*4+3] = 0xFF
	}

	// AND mask（偏移 1086 起）：全 0 = 显示完全由 alpha 决定
	return ico
}

// GreenIco 运行中（设计 §3 图标色 #2EC48A）
func GreenIco() []byte { return IcoBytes(0x2E, 0xC4, 0x8A) }

// YellowIco 启动中（#F5C11A）
func YellowIco() []byte { return IcoBytes(0xF5, 0xC1, 0x1A) }

// GrayIco 已停止（#9E9E9E）
func GrayIco() []byte { return IcoBytes(0x9E, 0x9E, 0x9E) }

// RedIco 异常（#E04F3F）
func RedIco() []byte { return IcoBytes(0xE0, 0x4F, 0x3F) }

func putLE16(b []byte, v int) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
}

func putLE32(b []byte, v int) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
	b[2] = byte(v >> 16)
	b[3] = byte(v >> 24)
}
