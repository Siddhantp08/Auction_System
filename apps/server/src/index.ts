import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { nanoid } from 'nanoid'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import fs from 'fs'

// Environment configuration
const PORT = Number(process.env.PORT || 8080)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

// Initialize Supabase client
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    })
  : null

// Initialize Fastify
const app = Fastify({ logger: true })

// CORS configuration
await app.register(cors, {
  origin: true,
  credentials: true
})

// Serve static files
try {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const publicDir = join(__dirname, '../../client-dist')
  
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir })
    app.log.info('Static files enabled')
  }
} catch (error) {
  app.log.warn(`Static files setup failed: ${String((error as any)?.message || error)}`)
}

// Types and schemas
const CreateAuctionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  startingPrice: z.number().min(0),
  bidIncrement: z.number().min(0.01),
  goLiveAt: z.string().datetime(),
  durationMinutes: z.number().int().min(1).max(10080) // Max 1 week
})

const PlaceBidSchema = z.object({
  amount: z.number().min(0)
})

// Authentication helper
async function getUserFromRequest(request: any): Promise<string | null> {
  const authHeader = request.headers.authorization
  if (!authHeader || !supabase) return null

  try {
    const token = authHeader.replace('Bearer ', '')
    const { data, error } = await supabase.auth.getUser(token)
    
    if (error || !data.user) return null
    return data.user.id
  } catch {
    return null
  }
}

// WebSocket setup
let wss: WebSocketServer | null = null

function broadcastMessage(message: any) {
  if (!wss) return
  
  const messageStr = JSON.stringify(message)
  wss.clients.forEach((client: any) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr)
    }
  })
}

// Routes
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

app.get('/config', async () => {
  return {
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: SUPABASE_ANON_KEY || null
  }
})

// Get all auctions
app.get('/api/auctions', async (request: any, reply: any) => {
  if (!supabase) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .order('createdAt', { ascending: false })

    if (error) throw error

    return { items: data || [] }
  } catch (error: any) {
    app.log.error(`Failed to fetch auctions: ${String((error as any)?.message || error)}`)
    return reply.code(500).send({ error: 'Failed to fetch auctions' })
  }
})

// Get single auction
app.get('/api/auctions/:id', async (request: any, reply: any) => {
  if (!supabase) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  const { id } = request.params as { id: string }

  try {
    const { data, error } = await supabase
      .from('auctions')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'Auction not found' })
    }

    return data
  } catch (error: any) {
    app.log.error(`Failed to fetch auction: ${String((error as any)?.message || error)}`)
    return reply.code(500).send({ error: 'Failed to fetch auction' })
  }
})

// Create auction
app.post('/api/auctions', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  if (!supabase) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  try {
    const validatedData = CreateAuctionSchema.parse(request.body)
    
    const goLiveAt = new Date(validatedData.goLiveAt)
    const endsAt = new Date(goLiveAt.getTime() + validatedData.durationMinutes * 60 * 1000)
    const now = new Date()

    const auctionData = {
      id: nanoid(),
      sellerId: userId,
      title: validatedData.title,
      description: validatedData.description || null,
      startingPrice: validatedData.startingPrice,
      currentPrice: validatedData.startingPrice,
      bidIncrement: validatedData.bidIncrement,
      goLiveAt: goLiveAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: now >= goLiveAt ? 'live' : 'scheduled',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }

    const { data, error } = await supabase
      .from('auctions')
      .insert(auctionData)
      .select()
      .single()

    if (error) throw error

    // Broadcast new auction
    broadcastMessage({
      type: 'auction:created',
      auction: data
    })

    return reply.code(201).send(data)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
    app.log.error(`Failed to create auction: ${String((error as any)?.message || error)}`)
    return reply.code(500).send({ error: 'Failed to create auction' })
  }
})

// Place bid
app.post('/api/auctions/:id/bids', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  if (!supabase) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  const { id } = request.params as { id: string }

  try {
    const { amount } = PlaceBidSchema.parse(request.body)

    // Get current auction state
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('id', id)
      .single()

    if (auctionError || !auction) {
      return reply.code(404).send({ error: 'Auction not found' })
    }

    // Validate bid
    const now = new Date()
    const endsAt = new Date(auction.endsAt)
    
    if (now > endsAt || auction.status !== 'live') {
      return reply.code(400).send({ error: 'Auction is not active' })
    }

    if (amount <= auction.currentPrice) {
      return reply.code(400).send({ error: 'Bid must be higher than current price' })
    }

    const minBid = auction.currentPrice + auction.bidIncrement
    if (amount < minBid) {
      return reply.code(400).send({ 
        error: `Minimum bid is ${minBid.toFixed(2)}` 
      })
    }

    // Update auction with new bid
    const { error: updateError } = await supabase
      .from('auctions')
      .update({ 
        currentPrice: amount,
        updatedAt: now.toISOString()
      })
      .eq('id', id)

    if (updateError) throw updateError

    // Record the bid
    const { error: bidError } = await supabase
      .from('bids')
      .insert({
        id: nanoid(),
        auctionId: id,
        bidderId: userId,
        amount: amount,
        createdAt: now.toISOString()
      })

    if (bidError) throw bidError

    // Broadcast bid update
    broadcastMessage({
      type: 'bid:accepted',
      auctionId: id,
      amount: amount,
      userId: userId,
      timestamp: now.toISOString()
    })

    return { success: true }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
    app.log.error(`Failed to place bid: ${String((error as any)?.message || error)}`)
    return reply.code(500).send({ error: 'Failed to place bid' })
  }
})

// Get bids for an auction
app.get('/api/auctions/:id/bids', async (request: any, reply: any) => {
  if (!supabase) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  const { id } = request.params as { id: string }

  try {
    const { data, error } = await supabase
      .from('bids')
      .select('*')
      .eq('auctionId', id)
      .order('createdAt', { ascending: false })

    if (error) throw error

    return { items: data || [] }
  } catch (error: any) {
    app.log.error(`Failed to fetch bids: ${String((error as any)?.message || error)}`)
    return reply.code(500).send({ error: 'Failed to fetch bids' })
  }
})

// SPA fallback route
app.get('/*', async (request: any, reply: any) => {
  const url = request.url
  
  // Skip API routes
  if (url.startsWith('/api') || url.startsWith('/health')) {
    return reply.code(404).send({ error: 'Not found' })
  }

  // Serve index.html for SPA routes
  if (typeof reply.sendFile === 'function') {
    return reply.sendFile('index.html')
  }
  
  return reply.code(404).send({ error: 'Not found' })
})

// Start server
await app.listen({ port: PORT, host: '0.0.0.0' })

// Setup WebSocket server
wss = new WebSocketServer({ server: app.server })

wss.on('connection', (ws: any) => {
  app.log.info('WebSocket client connected')
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    timestamp: new Date().toISOString()
  }))

  ws.on('close', () => {
    app.log.info('WebSocket client disconnected')
  })
})

app.log.info(`Server running on http://localhost:${PORT}`)

// Background task to end expired auctions
if (supabase) {
  setInterval(async () => {
    try {
      const now = new Date().toISOString()
      
      const { data: expiredAuctions, error } = await supabase
        .from('auctions')
        .select('id')
        .eq('status', 'live')
        .lt('endsAt', now)

      if (error) throw error

      if (expiredAuctions && expiredAuctions.length > 0) {
        const { error: updateError } = await supabase
          .from('auctions')
          .update({ status: 'ended' })
          .in('id', expiredAuctions.map((a: any) => a.id))

        if (updateError) throw updateError

        // Broadcast auction endings
  expiredAuctions.forEach((auction: any) => {
          broadcastMessage({
            type: 'auction:ended',
            auctionId: auction.id,
            timestamp: now
          })
        })

        app.log.info(`Ended ${expiredAuctions.length} expired auctions`)
      }
    } catch (error) {
      app.log.error(`Failed to end expired auctions: ${String((error as any)?.message || error)}`)
    }
  }, 30000) // Check every 30 seconds
}