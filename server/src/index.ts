import cors from '@fastify/cors'
import Fastify from 'fastify'

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
    },
  },
})

await app.register(cors, { origin: true })

app.get('/api/health', async () => ({
  ok: true,
  service: 'habitat-server',
  time: new Date().toISOString(),
}))

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })
