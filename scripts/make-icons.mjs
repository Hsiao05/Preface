// 生成应用图标（纯代码绘制，不依赖任何图像库）
// 用法：node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // 过滤器类型
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 画布 ----------
const SS = 4 // 超采样倍数，用于抗锯齿

function createCanvas(size) {
  return { size, px: new Float64Array(size * size * 4) }
}

/** 在 (0..1) 归一化坐标下填充圆角矩形 */
function roundRect(canvas, x, y, w, h, r, [cr, cg, cb], alpha = 1) {
  const S = canvas.size
  const px = canvas.px
  const x0 = x * S
  const y0 = y * S
  const x1 = (x + w) * S
  const y1 = (y + h) * S
  const rad = r * S

  for (let py = Math.max(0, Math.floor(y0)); py < Math.min(S, Math.ceil(y1)); py++) {
    for (let pxi = Math.max(0, Math.floor(x0)); pxi < Math.min(S, Math.ceil(x1)); pxi++) {
      const cx = pxi + 0.5
      const cy = py + 0.5
      // 圆角矩形的距离场
      const dx = Math.max(x0 + rad - cx, cx - (x1 - rad), 0)
      const dy = Math.max(y0 + rad - cy, cy - (y1 - rad), 0)
      if (Math.hypot(dx, dy) > rad) continue

      const i = (py * S + pxi) * 4
      px[i] = px[i] * (1 - alpha) + cr * alpha
      px[i + 1] = px[i + 1] * (1 - alpha) + cg * alpha
      px[i + 2] = px[i + 2] * (1 - alpha) + cb * alpha
      px[i + 3] = Math.min(1, px[i + 3] + alpha)
    }
  }
}

/** 超采样降采样成最终 RGBA */
function resolve(canvas) {
  const S = canvas.size
  const outSize = S / SS
  const out = Buffer.alloc(outSize * outSize * 4)
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4
          const alpha = canvas.px[i + 3]
          r += canvas.px[i] * alpha
          g += canvas.px[i + 1] * alpha
          b += canvas.px[i + 2] * alpha
          a += alpha
        }
      }
      const n = SS * SS
      const o = (y * outSize + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round((a / n) * 255)
    }
  }
  return { width: outSize, height: outSize, data: out }
}

// ---------- 图形设计 ----------
// 品牌蓝底 + 白色横线，横线象征"理出条理的文字"
const BRAND = [15, 108, 189]
const WHITE = [255, 255, 255]

function drawIcon(size, { lines }) {
  const canvas = createCanvas(size * SS)
  const u = (v) => v / size // 归一化

  // 底：圆角方块
  roundRect(canvas, 0, 0, 1, 1, u(size * 0.22), BRAND)

  // 横线：第一条短（标题），其余长
  const left = u(size * 0.25)
  const right = u(size * 0.75)
  const lineH = u(size * 0.085)
  const radius = lineH / 2
  const totalH = lines * lineH + (lines - 1) * u(size * 0.075)
  let y = (1 - totalH) / 2

  for (let i = 0; i < lines; i++) {
    const w = i === 0 ? (right - left) * 0.55 : right - left
    roundRect(canvas, left, y, w, lineH, radius, WHITE)
    y += lineH + u(size * 0.075)
  }

  return resolve(canvas)
}

// ---------- 输出 ----------
mkdirSync(join(root, 'resources'), { recursive: true })

const targets = [
  { file: 'icon.png', size: 256, lines: 4 },
  { file: 'tray.png', size: 32, lines: 3 }
]

for (const t of targets) {
  const img = drawIcon(t.size, { lines: t.lines })
  writeFileSync(join(root, 'resources', t.file), encodePng(img.width, img.height, img.data))
  console.log(`已生成 resources/${t.file}  ${img.width}x${img.height}`)
}
