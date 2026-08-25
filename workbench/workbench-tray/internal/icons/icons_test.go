package icons

import "testing"

func le16(b []byte) int { return int(b[0]) | int(b[1])<<8 }
func le32(b []byte) int { return int(b[0]) | int(b[1])<<8 | int(b[2])<<16 | int(b[3])<<24 }

// 常用偏移
const (
	pixelOff = 22 + 40         // 62
	maskOff  = pixelOff + 1024 // 1086
)

// TestIcoBytesLayout 按任务规格逐偏移断言 ICO 布局
func TestIcoBytesLayout(t *testing.T) {
	data := IcoBytes(0x2E, 0xC4, 0x8A)

	if len(data) != 1118 {
		t.Fatalf("总长 = %d, want 1118（22+40+1024+32）", len(data))
	}

	// ICONDIR：reserved=0,0；type=1,0（icon）；count=1,0
	wantDir := []byte{0, 0, 1, 0, 1, 0}
	for i, v := range wantDir {
		if data[i] != v {
			t.Fatalf("ICONDIR 偏移 %d = %d, want %d", i, data[i], v)
		}
	}

	// ICONDIRENTRY
	if data[6] != 16 {
		t.Fatalf("宽（偏移 6）= %d, want 16", data[6])
	}
	if data[7] != 16 {
		t.Fatalf("高（偏移 7）= %d, want 16", data[7])
	}
	if got := le16(data[10:12]); got != 1 {
		t.Fatalf("planes（偏移 10-11）= %d, want 1", got)
	}
	if got := le16(data[12:14]); got != 32 {
		t.Fatalf("bpp（偏移 12-13）= %d, want 32", got)
	}
	if got := le32(data[14:18]); got != 1096 {
		t.Fatalf("bytesInRes（偏移 14-17）= %d, want 1096", got)
	}
	if got := le32(data[18:22]); got != 22 {
		t.Fatalf("imageOffset（偏移 18-21）= %d, want 22", got)
	}

	// BITMAPINFOHEADER（偏移 22 起）
	if got := le32(data[22:26]); got != 40 {
		t.Fatalf("biSize = %d, want 40", got)
	}
	if got := le32(data[26:30]); got != 16 {
		t.Fatalf("biWidth = %d, want 16", got)
	}
	if got := le32(data[30:34]); got != 32 {
		t.Fatalf("biHeight = %d, want 32（XOR+AND 翻倍）", got)
	}
	if got := le16(data[34:36]); got != 1 {
		t.Fatalf("biPlanes = %d, want 1", got)
	}
	if got := le16(data[36:38]); got != 32 {
		t.Fatalf("biBitCount = %d, want 32", got)
	}

	// AND mask 全零（偏移 1086-1117）
	for i, v := range data[maskOff:] {
		if v != 0 {
			t.Fatalf("AND mask 偏移 %d = %d, want 0（32bpp 由 alpha 决定）", maskOff+i, v)
		}
	}
}

// TestIcoBytesPixels 像素 BGRA 序（B 在前）+ 全像素同色 + alpha=255
func TestIcoBytesPixels(t *testing.T) {
	const r, g, b = 0x2E, 0xC4, 0x8A
	data := IcoBytes(r, g, b)

	if len(data) != 1118 {
		t.Fatalf("总长 = %d, want 1118", len(data))
	}
	if data[pixelOff+0] != b {
		t.Fatalf("首像素 B 分量 = %#x, want %#x（BGRA：B 在前）", data[pixelOff+0], b)
	}
	if data[pixelOff+1] != g {
		t.Fatalf("首像素 G 分量 = %#x, want %#x", data[pixelOff+1], g)
	}
	if data[pixelOff+2] != r {
		t.Fatalf("首像素 R 分量 = %#x, want %#x", data[pixelOff+2], r)
	}
	if data[pixelOff+3] != 0xFF {
		t.Fatalf("首像素 A 分量 = %#x, want 0xFF（不透明）", data[pixelOff+3])
	}

	for i := 0; i < 16*16; i++ {
		o := pixelOff + i*4
		if data[o] != b || data[o+1] != g || data[o+2] != r || data[o+3] != 0xFF {
			t.Fatalf("像素 %d = [%#x %#x %#x %#x], want BGRA [%#x %#x %#x 0xFF]", i, data[o], data[o+1], data[o+2], data[o+3], b, g, r)
		}
	}
}

// TestFourStateIcons 四态便捷函数：色值与设计 §3 图标色一致
func TestFourStateIcons(t *testing.T) {
	cases := []struct {
		name    string
		got     []byte
		r, g, b uint8
	}{
		{"Green_#2EC48A", GreenIco(), 0x2E, 0xC4, 0x8A},
		{"Yellow_#F5C11A", YellowIco(), 0xF5, 0xC1, 0x1A},
		{"Gray_#9E9E9E", GrayIco(), 0x9E, 0x9E, 0x9E},
		{"Red_#E04F3F", RedIco(), 0xE0, 0x4F, 0x3F},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if len(c.got) != 1118 {
				t.Fatalf("长度 = %d, want 1118", len(c.got))
			}
			if c.got[pixelOff+0] != c.b || c.got[pixelOff+1] != c.g || c.got[pixelOff+2] != c.r {
				t.Fatalf("首像素 BGRA = [%#x %#x %#x], want [%#x %#x %#x]", c.got[pixelOff+0], c.got[pixelOff+1], c.got[pixelOff+2], c.b, c.g, c.r)
			}
		})
	}
}
