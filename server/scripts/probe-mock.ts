import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const t = new StreamableHTTPClientTransport(new URL('http://localhost:3333/mcp'))
const c = new Client({ name: 'probe', version: '0' }, { capabilities: {} })
console.log('connecting...')
await c.connect(t)
console.log('connected, session:', t.sessionId)
const tools = await c.listTools()
console.log('tools:', JSON.stringify(tools.tools))
process.exit(0)
