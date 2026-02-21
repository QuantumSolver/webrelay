import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [], // Disable all Prisma logs (SQL queries, etc.)
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db