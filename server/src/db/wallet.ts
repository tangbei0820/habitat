/** 钱包：余额缓存与不可变流水必须在同一个 SQLite 事务里更新。 */
import { randomUUID } from 'node:crypto'
import { ErrorCodes } from '@shared/errors.js'
import type { WalletSummary, WalletTransactionRecord } from '@shared/types.js'
import { desc, eq } from 'drizzle-orm'
import { db } from './index.js'
import { wallet, walletTransaction } from './schema.js'
import { RequestError } from '../lib/errors.js'

const PRIMARY_ID = 'primary'

function ensureWallet(at = Date.now()): void {
  db.insert(wallet).values({ id: PRIMARY_ID, balance: 0, updatedAt: at }).onConflictDoNothing().run()
}

export function getWallet(): WalletSummary {
  ensureWallet()
  const row = db.select().from(wallet).where(eq(wallet.id, PRIMARY_ID)).get()
  if (row === undefined) throw new Error('wallet 初始化失败')
  return { balance: row.balance, updatedAt: row.updatedAt }
}

export function transactWallet(
  delta: number,
  reason: string,
  refType: string | null = null,
  refId: string | null = null,
  createdAt = Date.now(),
): WalletTransactionRecord {
  return db.transaction((tx) => {
    tx.insert(wallet).values({ id: PRIMARY_ID, balance: 0, updatedAt: createdAt }).onConflictDoNothing().run()
    const current = tx.select().from(wallet).where(eq(wallet.id, PRIMARY_ID)).get()
    if (current === undefined) throw new Error('wallet 初始化失败')
    const balanceAfter = current.balance + delta
    if (balanceAfter < 0) throw new RequestError(ErrorCodes.BadRequest, '钱包余额不足')
    const record: WalletTransactionRecord = {
      id: randomUUID(), delta, balanceAfter, reason, refType, refId, createdAt,
    }
    tx.update(wallet)
      .set({ balance: balanceAfter, updatedAt: createdAt })
      .where(eq(wallet.id, PRIMARY_ID))
      .run()
    tx.insert(walletTransaction).values(record).run()
    return record
  })
}

export function listWalletTransactions(limit = 100): WalletTransactionRecord[] {
  return db.select().from(walletTransaction).orderBy(desc(walletTransaction.createdAt)).limit(limit).all().map((row) => ({
    id: row.id,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    reason: row.reason,
    refType: row.refType,
    refId: row.refId,
    createdAt: row.createdAt,
  }))
}
