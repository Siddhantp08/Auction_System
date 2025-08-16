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
import { initModels, AuctionModel, BidModel, CounterOfferModel } from './sequelize.js'
import { sendSms } from './sms.js'

// Environment configuration
const PORT = Number(process.env.PORT || 8080)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

// Initialize Supabase client
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false }
    })
  : null

function getSupabaseForRequest(request: any) {
  if (!SUPABASE_URL) return null
  const authHeader = request?.headers?.authorization as string | undefined
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
  if (token && (SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY)) {
    // Use user's token so RLS policies (auth.uid()) work with anon key
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
  }
  // Fallback to service client (bypasses RLS) if available
  return supabase
}

// Initialize Fastify
const app = Fastify({ logger: true })

// CORS configuration
await app.register(cors, {
  origin: true,
  credentials: true
})

// Serve static files
let staticEnabled = false
try {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const publicDir = join(__dirname, '../../client-dist')
  
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir })
  app.log.info('Static files enabled')
  staticEnabled = true
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

const CounterOfferSchema = z.object({ amount: z.number().min(0.01) })
const DecisionSchema = z.object({ decision: z.enum(['accept', 'reject']) })

function devMode() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_HEADER === 'true'
}
function formatDbError(err: any) {
  const e = err || {}
  return {
    message: e.message || String(e),
    code: e.code,
    details: e.details || e.hint || undefined
  }
}

// Authentication helper
async function getUserFromRequest(request: any): Promise<string | null> {
  const authHeader = request.headers.authorization as string | undefined
  if (!authHeader || !SUPABASE_URL || (!SUPABASE_ANON_KEY && !SUPABASE_SERVICE_KEY)) return null
  try {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
    const s = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data, error } = await s.auth.getUser()
    if (error || !data?.user) return null
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

// Persist + broadcast a notification
async function notify(userId: string, type: string, payload: any) {
  // Broadcast to clients
  broadcastMessage({
    type: 'notification',
    userId,
    payload: { type, ...payload },
    ts: new Date().toISOString()
  })

  // Best-effort persist if service client configured and table exists
  if (supabase) {
    try {
      await supabase
        .from('notifications')
        .insert({ id: nanoid(), userId, type, payload, createdAt: new Date().toISOString() })
    } catch (_err) {
      // ignore if table not found or RLS blocks
    }
  }
}

// Optional: Upstash Redis client (lazy)
type RedisLike = {
  hgetall<T = Record<string, string>>(key: string): Promise<T | null>
  hset(key: string, value: Record<string, any>): Promise<any>
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<any>
  del?(key: string): Promise<any>
}
let redis: RedisLike | null = null
async function getRedis(): Promise<RedisLike | null> {
  if (redis !== null) return redis
  if (!UPSTASH_URL || !UPSTASH_TOKEN) { redis = null; return null }
  try {
    const mod: any = await import('@upstash/redis')
    redis = new mod.Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN })
    return redis
  } catch {
    redis = null
    return null
  }
}

function isAdmin(userId: string | null) {
  return !!(userId && ADMIN_USER_IDS.includes(userId))
}

// Initialize ORM models if configured
await initModels()

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
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  try {
    const { data, error } = await sb
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
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  const { id } = request.params as { id: string }

  try {
  const { data, error } = await sb
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

  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  try {
    const validatedData = CreateAuctionSchema.parse(request.body)
    const goLiveAt = new Date(validatedData.goLiveAt)
    const endsAt = new Date(goLiveAt.getTime() + validatedData.durationMinutes * 60 * 1000)
    const now = new Date()

    if (AuctionModel) {
      const row = await AuctionModel.create({
        id: nanoid(),
        sellerId: userId,
        title: validatedData.title,
        description: validatedData.description || null,
        startingPrice: validatedData.startingPrice,
        currentPrice: validatedData.startingPrice,
        bidIncrement: validatedData.bidIncrement,
        goLiveAt,
        endsAt,
        status: now >= goLiveAt ? 'live' : 'scheduled',
      })
      const data = row.toJSON()
      broadcastMessage({ type: 'auction:created', auction: data })
      return reply.code(201).send(data)
    } else {
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
      const { data, error } = await sb
        .from('auctions')
        .insert(auctionData)
        .select()
        .single()
      if (error) throw error
      broadcastMessage({ type: 'auction:created', auction: data })
      return reply.code(201).send(data)
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
  app.log.error(`Failed to create auction: ${String((error as any)?.message || error)}`)
  return reply.code(500).send({ error: 'Failed to create auction', ...(devMode() ? { db: formatDbError(error) } : {}) })
  }
})

// Place bid
app.post('/api/auctions/:id/bids', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }

  const { id } = request.params as { id: string }

  try {
    const { amount } = PlaceBidSchema.parse(request.body)
    const now = new Date()

    // Load auction and previous top bid
    let auction: any
    let prevTopBidder: string | null = null
    if (AuctionModel && BidModel) {
      const row = await AuctionModel.findOne({ where: { id } })
      if (!row) return reply.code(404).send({ error: 'Auction not found' })
      auction = row.toJSON()
      if (auction.sellerId === userId) return reply.code(403).send({ error: 'Sellers cannot bid on their own auction' })
  const top = await BidModel.findOne({ where: { auctionId: id }, order: [['amount','DESC']] })
      prevTopBidder = top ? (top.get('bidderId') as string) : null
      const endsAt = new Date(auction.endsAt)
      if (now > endsAt || auction.status !== 'live') return reply.code(400).send({ error: 'Auction is not active' })
      const minBid = Number(auction.currentPrice) + Number(auction.bidIncrement)
      if (amount < minBid) return reply.code(400).send({ error: `Minimum bid is ${minBid.toFixed(2)}` })

      // Optional Redis lock + check
      const r = await getRedis()
      const lockKey = `lock:auction:${id}`
      let locked = false
      if (r) {
        try { locked = !!(await r.set(lockKey, userId, { nx: true, ex: 5 })) } catch {}
      }
      try {
        await AuctionModel.update({ currentPrice: amount }, { where: { id } })
        await BidModel.create({ id: nanoid(), auctionId: id, bidderId: userId, amount, createdAt: now })
        if (r) {
          try { await r.hset(`auction:${id}`, { currentPrice: amount, bidderId: userId }) } catch {}
        }
      } finally {
        if (locked && r && r.del) { try { await r.del(lockKey) } catch {} }
      }
    } else {
      const res = await sb.from('auctions').select('*').eq('id', id).single()
      if (res.error || !res.data) return reply.code(404).send({ error: 'Auction not found' })
      auction = res.data
      if ((auction as any).sellerId === userId) return reply.code(403).send({ error: 'Sellers cannot bid on their own auction' })
      const endsAt = new Date(auction.endsAt)
      if (now > endsAt || auction.status !== 'live') return reply.code(400).send({ error: 'Auction is not active' })
      const minBid = Number(auction.currentPrice) + Number(auction.bidIncrement)
      if (amount < minBid) return reply.code(400).send({ error: `Minimum bid is ${minBid.toFixed(2)}` })

      // Previous top bidder
      const topRes = await sb
        .from('bids').select('*')
        .eq('auctionId', id)
        .order('amount', { ascending: false })
        .limit(1).maybeSingle()
      prevTopBidder = topRes.data ? topRes.data.bidderId : null

      const { error: updateError } = await sb
        .from('auctions')
        .update({ currentPrice: amount, updatedAt: now.toISOString() })
        .eq('id', id)
      if (updateError) throw updateError
      const { error: bidError } = await sb
        .from('bids')
        .insert({ id: nanoid(), auctionId: id, bidderId: userId, amount, createdAt: now.toISOString() })
      if (bidError) throw bidError

      const r = await getRedis()
      if (r) { try { await r.hset(`auction:${id}`, { currentPrice: amount, bidderId: userId }) } catch {} }
    }

    // Broadcast bid update
    broadcastMessage({
      type: 'bid:accepted',
      auctionId: id,
      amount: amount,
      userId: userId,
      timestamp: now.toISOString()
    })

    // Notify seller about new bid
    try {
      if ((auction as any)?.sellerId) {
        await notify((auction as any).sellerId, 'new_bid', { auctionId: id, amount, bidderId: userId })
      }
    } catch {}

    // Notify previous highest bidder they were outbid
    if (prevTopBidder && prevTopBidder !== userId) {
      try { await notify(prevTopBidder, 'outbid', { auctionId: id, amount, by: userId }) } catch {}
    }

    return { success: true }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
  app.log.error(`Failed to place bid: ${String((error as any)?.message || error)}`)
  return reply.code(500).send({ error: 'Failed to place bid', ...(devMode() ? { db: formatDbError(error) } : {}) })
  }
})

// Seller decision (accept/reject highest bid) after auction ends
app.post('/api/auctions/:id/decision', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  const { id } = request.params as { id: string }

  try {
    const { decision } = DecisionSchema.parse(request.body)
  const { data: auction } = await sb.from('auctions').select('*').eq('id', id).single()
    if (!auction) return reply.code(404).send({ error: 'Auction not found' })
    if (auction.sellerId !== userId) return reply.code(403).send({ error: 'Forbidden' })
  if (auction.status !== 'ended') return reply.code(400).send({ error: 'Auction must be ended to make a decision' })

    const { data: topBid } = await sb
      .from('bids')
      .select('*')
      .eq('auctionId', id)
      .order('amount', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!topBid) return reply.code(400).send({ error: 'No bids' })

    if (decision === 'accept') {
  await notify(topBid.bidderId, 'bid_accepted', { auctionId: id, amount: topBid.amount })
      await notify(auction.sellerId, 'auction_closed', { auctionId: id, reason: 'accepted', amount: topBid.amount, winnerId: topBid.bidderId })
      // Optional SMS
      const sadmin = SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }) : null
      if (sadmin) {
        try {
          const b = await sadmin.auth.admin.getUserById(topBid.bidderId)
          const phone = (b.data.user?.phone as string) || ''
          if (phone) await sendSms(phone, `Your bid on ${auction.title} was accepted. Amount: $${Number(topBid.amount).toFixed(2)}`)
        } catch {}
      }
      // Mark auction closed
      if (AuctionModel) {
        await AuctionModel.update({ status: 'closed' }, { where: { id } })
      } else if (supabase) {
        const { error: upd } = await supabase.from('auctions').update({ status: 'closed' }).eq('id', id)
        if (upd) throw upd
      } else {
        const { error: upd } = await sb.from('auctions').update({ status: 'closed' }).eq('id', id)
        if (upd) throw upd
      }
  broadcastMessage({ type: 'auction:closed', auctionId: id, reason: 'accepted' })
    } else {
      await notify(topBid.bidderId, 'bid_rejected', { auctionId: id, amount: topBid.amount })
  await notify(auction.sellerId, 'auction_closed', { auctionId: id, reason: 'rejected' })
      // Mark auction closed with no winner
      if (AuctionModel) {
        await AuctionModel.update({ status: 'closed' }, { where: { id } })
      } else if (supabase) {
        const { error: upd } = await supabase.from('auctions').update({ status: 'closed' }).eq('id', id)
        if (upd) throw upd
      } else {
        const { error: upd } = await sb.from('auctions').update({ status: 'closed' }).eq('id', id)
        if (upd) throw upd
      }
  broadcastMessage({ type: 'auction:closed', auctionId: id, reason: 'rejected' })
    }

    return { ok: true }
  } catch (error: any) {
    app.log.error(`Decision failed: ${String((error as any)?.message || error)}`)
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
    return reply
      .code(500)
      .send({ error: 'Failed to process decision', ...(devMode() ? { db: formatDbError(error) } : {}) })
  }
})

// Seller creates a counter-offer to highest bidder
app.post('/api/auctions/:id/counter-offers', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  const { id } = request.params as { id: string }
  try {
    const { amount } = CounterOfferSchema.parse(request.body)
    const { data: auction } = await sb.from('auctions').select('*').eq('id', id).single()
    if (!auction) return reply.code(404).send({ error: 'Auction not found' })
    if (auction.sellerId !== userId) return reply.code(403).send({ error: 'Forbidden' })

    const { data: topBid } = await sb
      .from('bids')
      .select('*')
      .eq('auctionId', id)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!topBid) return reply.code(400).send({ error: 'No bids to counter' })

    const row = { id: nanoid(), auctionId: id, sellerId: userId, buyerId: topBid.bidderId, amount, status: 'pending', createdAt: new Date().toISOString() }
    const { error } = await sb.from('counter_offers').insert(row)
    if (error) throw error
    await notify(topBid.bidderId, 'counter_offer', { auctionId: id, amount, counterOfferId: row.id })
    return { ok: true, id: row.id }
  } catch (error: any) {
    app.log.error(`Counter-offer creation failed: ${String((error as any)?.message || error)}`)
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
    return reply.code(500).send({ error: 'Failed to create counter-offer', ...(devMode() ? { db: formatDbError(error) } : {}) })
  }
})

// Buyer responds to counter-offer
app.post('/api/counter-offers/:counterId/respond', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  const { counterId } = request.params as { counterId: string }
  try {
    const { decision } = DecisionSchema.parse(request.body)
    const { data: co } = await sb.from('counter_offers').select('*').eq('id', counterId).single()
    if (!co) return reply.code(404).send({ error: 'Not found' })
    if (co.buyerId !== userId && co.sellerId !== userId) return reply.code(403).send({ error: 'Forbidden' })
    const status = decision === 'accept' ? 'accepted' : 'rejected'
    const { error } = await sb.from('counter_offers').update({ status }).eq('id', counterId)
    if (error) throw error
    await notify(co.sellerId, `counter_${status}`, { counterOfferId: counterId, auctionId: co.auctionId, amount: co.amount })
    await notify(co.buyerId, `counter_${status}`, { counterOfferId: counterId, auctionId: co.auctionId, amount: co.amount })
    if (status === 'accepted') {
      // On accepted counter, send emails and invoice
      const { data: auction } = await sb.from('auctions').select('*').eq('id', co.auctionId).single()
      if (auction) {
  // Emails disabled
        // Optional SMS
        const sadmin = SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }) : null
        if (sadmin) {
          try {
            const b = await sadmin.auth.admin.getUserById(co.buyerId)
            const s = await sadmin.auth.admin.getUserById(co.sellerId)
            const phoneB = (b.data.user?.phone as string) || ''
            const phoneS = (s.data.user?.phone as string) || ''
            if (phoneB) await sendSms(phoneB, `Counter-offer accepted for ${auction.title}. Amount: $${Number(co.amount).toFixed(2)}`)
            if (phoneS) await sendSms(phoneS, `Counter-offer accepted for ${auction.title}. Amount: $${Number(co.amount).toFixed(2)}`)
          } catch {}
        }
        // Close auction
        if (AuctionModel) {
          await AuctionModel.update({ status: 'closed' }, { where: { id: co.auctionId } })
        } else if (supabase) {
          const { error: upd } = await supabase.from('auctions').update({ status: 'closed' }).eq('id', co.auctionId)
          if (upd) throw upd
        } else {
          const { error: upd } = await sb.from('auctions').update({ status: 'closed' }).eq('id', co.auctionId)
          if (upd) throw upd
        }
        broadcastMessage({ type: 'auction:closed', auctionId: co.auctionId, reason: 'counter_accepted' })
      }
    } else {
      // Rejected by buyer: close with no winner
      if (AuctionModel) {
        await AuctionModel.update({ status: 'closed' }, { where: { id: co.auctionId } })
      } else if (supabase) {
        const { error: upd } = await supabase.from('auctions').update({ status: 'closed' }).eq('id', co.auctionId)
        if (upd) throw upd
      } else {
        const { error: upd } = await sb.from('auctions').update({ status: 'closed' }).eq('id', co.auctionId)
        if (upd) throw upd
      }
      broadcastMessage({ type: 'auction:closed', auctionId: co.auctionId, reason: 'counter_rejected' })
    }
    return { ok: true }
  } catch (error: any) {
    app.log.error(`Counter-offer response failed: ${String((error as any)?.message || error)}`)
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid input', details: (error as z.ZodError).errors })
    }
    return reply.code(500).send({ error: 'Failed to respond to counter-offer', ...(devMode() ? { db: formatDbError(error) } : {}) })
  }
})

// Notifications API
app.get('/api/notifications', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  try {
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .eq('userId', userId)
      .order('createdAt', { ascending: false })
      .limit(50)
    if (error) throw error
    return { items: data || [] }
  } catch (_err) {
    // Table may not exist yet; return empty
    return { items: [] }
  }
})

app.post('/api/notifications/:id/read', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  const { id } = request.params as { id: string }
  try {
    await sb.from('notifications').update({ read: true }).eq('id', id).eq('userId', userId)
    return { ok: true }
  } catch (_err) {
    return { ok: false }
  }
})

// List counter offers for current user (as buyer or seller)
app.get('/api/counter-offers', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' })
  }
  const sb = getSupabaseForRequest(request)
  if (!sb) {
    return reply.code(500).send({ error: 'Database not configured' })
  }
  const role = (request.query?.role as string | undefined) || 'all'
  try {
    let query = sb.from('counter_offers').select('*').order('createdAt', { ascending: false })
    if (role === 'buyer') {
      query = query.eq('buyerId', userId)
    } else if (role === 'seller') {
      query = query.eq('sellerId', userId)
    } else {
      // both
      // Supabase doesn't support OR easily in this SDK chain; do two queries and merge
      const [buyerRes, sellerRes] = await Promise.all([
        sb.from('counter_offers').select('*').eq('buyerId', userId).order('createdAt', { ascending: false }),
        sb.from('counter_offers').select('*').eq('sellerId', userId).order('createdAt', { ascending: false })
      ])
      const items = [...(buyerRes.data || []), ...(sellerRes.data || [])]
      return { items }
    }
    const { data, error } = await query
    if (error) throw error
    return { items: data || [] }
  } catch (_err) {
    return { items: [] }
  }
})

// Get bids for an auction
app.get('/api/auctions/:id/bids', async (request: any, reply: any) => {
  const userId = await getUserFromRequest(request)
  if (!userId) return reply.code(401).send({ error: 'Authentication required' })
  const sb = getSupabaseForRequest(request)
  if (!sb) return reply.code(500).send({ error: 'Database not configured' })

  const { id } = request.params as { id: string }

  try {
    // Only the seller can view full bid list (including highest bidder)
    const { data: auction } = await sb.from('auctions').select('sellerId').eq('id', id).single()
    if (!auction) return reply.code(404).send({ error: 'Auction not found' })
    if (auction.sellerId !== userId) return reply.code(403).send({ error: 'Forbidden' })

    const { data, error } = await sb
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

// SPA fallback: use notFound handler to avoid conflicting wildcard route
app.setNotFoundHandler(async (request: any, reply: any) => {
  const url = request.url || ''
  if (url.startsWith('/api') || url.startsWith('/health')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  if (staticEnabled && typeof reply.sendFile === 'function') {
    return reply.type('text/html').sendFile('index.html')
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
      
      // Promote scheduled auctions that reached goLiveAt
      try {
        const { data: toLive, error: toLiveErr } = await supabase
          .from('auctions')
          .select('id')
          .eq('status', 'scheduled')
          .lte('goLiveAt', now)
        if (toLiveErr) throw toLiveErr
        if (toLive && toLive.length > 0) {
          const { error: updErr } = await supabase
            .from('auctions')
            .update({ status: 'live' })
            .in('id', toLive.map((a: any) => a.id))
          if (updErr) throw updErr
          for (const a of toLive as any[]) {
            broadcastMessage({ type: 'auction:live', auctionId: a.id, timestamp: now })
          }
          app.log.info(`Activated ${toLive.length} scheduled auctions`)
        }
      } catch (e) {
        app.log.warn(`Failed to activate scheduled auctions: ${String((e as any)?.message || e)}`)
      }

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

        // Broadcast auction endings and notify highest bidder
        for (const auction of expiredAuctions as any[]) {
          broadcastMessage({
            type: 'auction:ended',
            auctionId: auction.id,
            timestamp: now
          })
          try {
            const { data: topBid } = await supabase
              .from('bids')
              .select('*')
              .eq('auctionId', auction.id)
              .order('createdAt', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (topBid) {
              await notify(topBid.bidderId, 'auction_ended', { auctionId: auction.id, amount: topBid.amount })
            }
          } catch {}
        }

        app.log.info(`Ended ${expiredAuctions.length} expired auctions`)
      }
    } catch (error) {
      app.log.error(`Failed to end expired auctions: ${String((error as any)?.message || error)}`)
    }
  }, 30000) // Check every 30 seconds
}

// Helpers (emails removed)