/**
 * 最早执行的一步：把 `server/.env` 读进 `process.env`。
 *
 * 为什么单独成一个模块：ESM 的 import 先于本模块任何语句求值，而
 * `src/db/index.ts` 在**模块加载期**就要读 `HABITAT_DB_PATH`。
 * 所以本模块必须是 `src/index.ts` 的第一个 import，晚了就读不到。
 *
 * 两个刻意的设计：
 * - **不引 dotenv**：Node 20+ 自带 `process.loadEnvFile`，但那会覆盖既有
 *   环境变量。这里手写极简解析，保证优先级为「**真实环境变量 > .env**」，
 *   免得 `.env` 悄悄盖掉命令行里显式传的值。
 * - 路径按**模块位置**解析而非 cwd，从仓库根或 server/ 下启动都能找到。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** src/lib/env.ts → server/ */
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function parseEnv(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    let value = body.slice(eq + 1).trim()
    // 成对引号去掉；未加引号的值保留原样（含内部空格）
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0]
      if (value.endsWith(quote)) value = value.slice(1, -1)
    }
    pairs.push([key, value])
  }
  return pairs
}

/** 返回是否真的读到了 .env（供启动日志用） */
export function loadEnvFile(): boolean {
  let text: string
  try {
    text = readFileSync(resolve(serverRoot, '.env'), 'utf8')
  } catch {
    return false // 没有 .env 文件属正常（生产直接用真实环境变量）
  }
  for (const [key, value] of parseEnv(text)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return true
}

export const envFileLoaded = loadEnvFile()
