/**
 * 进程入口：唯一职责是**在加载任何含原生模块的依赖之前**校验 Node 版本。
 *
 * `better-sqlite3` 的预编译二进制与**安装时**的 Node 版本绑定（ABI），
 * 用别的 major 版本启动会得到一句毫无头绪的 `ERR_DLOPEN_FAILED`。
 * 这里按 server/package.json 的 `engines.node` 提前检查，版本不符给一句人话再退出，
 * 而不是让原生模块在 import 阶段炸出栈。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** src/index.ts → server/ */
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 从 `engines.node` 里取出**允许的 major 列表**。
 *
 * 只认 engines 里实际会写的几种写法（`^20` / `20` / `>=20 <21`）。
 * 关键是**不把 `<` 后面的数字当允许值** —— 那是排他的上界：
 * 早先的实现用 `matchAll(/\d+/g)` 把范围里所有数字都收进来，`>=20 <21` 解析成 `[20, 21]`，
 * 于是 Node 21 被放行，而它的 ABI 和 22 一样是错的（正是这个检查要拦的东西）。
 */
function allowedMajors(range: string | undefined): number[] {
  if (range === undefined) return []
  const lowerPart = range.split('<')[0] ?? ''
  return [...lowerPart.matchAll(/\d+/g)].map((match) => Number(match[0]))
}

function checkNodeVersion(): void {
  let range: string | undefined
  try {
    const pkg = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    range = pkg.engines?.node
  } catch {
    return // 读不到 package.json 就不拦（开发态极少见，不该因此起不来）
  }
  const majors = allowedMajors(range)
  const major = Number(process.versions.node.split('.')[0])
  if (majors.length > 0 && !majors.includes(major)) {
    console.error(
      `[habitat-server] 当前 Node 是 v${process.versions.node}，但服务端依赖的原生模块按 Node ${range} 编译。` +
        `请切换 Node 版本后重试（仓库根有 .nvmrc）。`,
    )
    process.exit(1)
  }
}

checkNodeVersion()

// 版本过关后才加载应用本体（动态 import 保证上面的检查先于一切原生模块）
await import('./main.js')
