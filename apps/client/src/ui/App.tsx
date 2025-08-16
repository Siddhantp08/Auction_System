import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// Configuration
const API_URL = import.meta.env.VITE_API_BASE || ''
const WS_URL = import.meta.env.VITE_WS_URL || (
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : 'ws://localhost:8080'
)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const initialSupabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

// Types
interface Auction {
  id: string
  title: string
  description?: string
  currentPrice: number
  startingPrice: number
  bidIncrement: number
  status: string
  goLiveAt: string
  endsAt: string
  sellerId: string
}

interface User {
  id: string
  email: string
}

interface NotificationItem {
  id?: string
  userId?: string
  type: string
  payload: any
  read?: boolean
  createdAt?: string
}

interface CounterOffer {
  id: string
  auctionId: string
  sellerId: string
  buyerId: string
  amount: number
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
  updatedAt?: string
}

// Utility functions
const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`
const formatTime = (isoString: string) => {
  const date = new Date(isoString)
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  
  if (diff <= 0) return 'Ended'
  
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)
  
  return `${hours}h ${minutes}m ${seconds}s`
}

// Components
function Header({ user, onSignOut, onShowAuth }: {
  user: User | null
  onSignOut: () => void
  onShowAuth: () => void
}) {
  return (
    <header className="bg-white border-b-2 border-gray-200 px-6 py-4">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Classic Auctions</h1>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-gray-600">Welcome, {user.email}</span>
              <button 
                onClick={onSignOut}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Sign Out
              </button>
            </>
          ) : (
            <button 
              onClick={onShowAuth}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function AuthForm({ onAuth }: { onAuth: (email: string, password: string, isSignUp: boolean) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAuth(email, password, isSignUp)
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center">
          {isSignUp ? 'Create Account' : 'Sign In'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <div className="mt-4 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-blue-600 hover:underline"
          >
            {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AuctionCard({ auction, onBid, user }: {
  auction: Auction
  onBid: (auctionId: string, amount: number) => void
  user: User | null
}) {
  const [bidAmount, setBidAmount] = useState('')
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      if (auction.status === 'live') {
        setTimeLeft(formatTime(auction.endsAt))
      } else {
        setTimeLeft(formatTime(auction.goLiveAt))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [auction.endsAt, auction.goLiveAt, auction.status])

  const handleBid = () => {
    const amount = parseFloat(bidAmount)
  const minBid = auction.currentPrice + auction.bidIncrement
  if (amount >= minBid) {
      onBid(auction.id, amount)
      setBidAmount('')
    }
  }

  const isActive = auction.status === 'live'
  const minBid = auction.currentPrice + auction.bidIncrement

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-6 shadow-sm">
      <h3 className="text-xl font-semibold mb-2">{auction.title}</h3>
      {auction.description && (
        <p className="text-gray-600 mb-4">{auction.description}</p>
      )}
      
      <div className="space-y-2 mb-4">
        <div className="flex justify-between">
          <span className="text-gray-600">Current Bid:</span>
          <span className="font-bold text-lg">{formatCurrency(auction.currentPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">{isActive ? 'Time Left:' : 'Starts In:'}</span>
          <span className={`font-medium ${timeLeft === 'Ended' ? 'text-red-600' : 'text-green-600'}`}>
            {timeLeft}
          </span>
        </div>
        {!isActive && (
          <div className="flex justify-between">
            <span className="text-gray-600">Starts At:</span>
            <span className="font-medium">{new Date(auction.goLiveAt).toLocaleString()}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-600">Status:</span>
          <span className={`px-2 py-1 rounded text-sm ${
            isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {auction.status.toUpperCase()}
          </span>
        </div>
      </div>

  {user && isActive && timeLeft !== 'Ended' && (
        <div className="border-t pt-4">
          <div className="flex gap-2">
            <input
              type="number"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              placeholder={`Min: ${formatCurrency(minBid)}`}
              min={minBid}
              step="0.01"
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleBid}
              disabled={!bidAmount || parseFloat(bidAmount) < minBid}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              Place Bid
            </button>
          </div>
        </div>
      )}

  {/* Seller actions when auction ended */}
  {user && user.id === auction.sellerId && auction.status === 'ended' && (
        <SellerActions auctionId={auction.id} />
      )}
    </div>
  )
}

function SellerActions({ auctionId }: { auctionId: string }) {
  const [amount, setAmount] = useState('')
  const [topBid, setTopBid] = useState<{ amount: number; userId?: string; email?: string } | null>(
    null
  )
  const [loadingTop, setLoadingTop] = useState(false)

  const decision = async (d: 'accept' | 'reject') => {
    try {
      await apiCall(`/api/auctions/${auctionId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: d })
      })
      alert(`Decision: ${d} sent`)
    } catch (e) {
      alert((e as any)?.message || 'Failed')
    }
  }

  const sendCounter = async () => {
    const val = parseFloat(amount)
    if (!isFinite(val) || val <= 0) return
    try {
      await apiCall(`/api/auctions/${auctionId}/counter-offers`, {
        method: 'POST',
        body: JSON.stringify({ amount: val })
      })
      setAmount('')
      alert('Counter offer sent')
    } catch (e) {
      alert((e as any)?.message || 'Failed to send counter offer')
    }
  }

  // Access App's apiCall via a global set by App
  type ApiCall = (
    endpoint: string,
    options?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }
  ) => Promise<any>
  const apiCall: ApiCall = (window as any)._appApiCall

  const loadTopBid = async () => {
    setLoadingTop(true)
    try {
      const data = await apiCall(`/api/auctions/${auctionId}/bids`)
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
      const sorted = [...items].sort((a, b) => Number(b?.amount || 0) - Number(a?.amount || 0))
      const top = sorted[0]
      if (top) {
        setTopBid({
          amount: Number(top.amount),
          userId: top.userId || top.bidderId || top.buyerId,
          email: top.email || top.bidderEmail || top.buyerEmail,
        })
      } else {
        setTopBid(null)
      }
    } catch {
      // ignore
    } finally {
      setLoadingTop(false)
    }
  }

  useEffect(() => {
    loadTopBid()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionId])

  return (
    <div className="border-t pt-4 mt-4 space-y-2">
      <div className="p-3 bg-gray-50 rounded border">
        <div className="flex justify-between items-center mb-2">
          <div className="font-medium">Highest Bid</div>
          <button onClick={loadTopBid} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {loadingTop ? (
          <div className="text-sm text-gray-600">Loading...</div>
        ) : topBid ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Amount</span><span className="font-semibold">{formatCurrency(topBid.amount)}</span></div>
            <div className="flex justify-between"><span>Bidder</span><span className="font-mono">{topBid.email || topBid.userId || 'Unknown'}</span></div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">No bids placed.</div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={() => decision('accept')} className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700">Accept Top Bid</button>
        <button onClick={() => decision('reject')} className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700">Reject Top Bid</button>
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Counter offer amount"
          aria-label="Counter offer amount"
          step="0.01"
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={sendCounter} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Send Counter</button>
      </div>
    </div>
  )
}

function CreateAuctionForm({ onSubmit, onCancel }: {
  onSubmit: (data: any) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startingPrice: '',
    bidIncrement: '1',
  durationMinutes: '60',
  startNow: true,
  goLiveAtLocal: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let goLiveAt: string
    if (formData.startNow) {
      goLiveAt = new Date().toISOString()
    } else if (formData.goLiveAtLocal) {
      const dt = new Date(formData.goLiveAtLocal)
      goLiveAt = isNaN(dt.getTime()) ? new Date(Date.now() + 60000).toISOString() : dt.toISOString()
    } else {
      goLiveAt = new Date(Date.now() + 60000).toISOString()
    }
    onSubmit({
      ...formData,
      startNow: undefined,
      goLiveAtLocal: undefined,
      startingPrice: parseFloat(formData.startingPrice),
      bidIncrement: parseFloat(formData.bidIncrement),
      durationMinutes: parseInt(formData.durationMinutes),
      goLiveAt
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create New Auction</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="startNow"
              type="checkbox"
              checked={formData.startNow}
              onChange={(e) => setFormData({ ...formData, startNow: e.target.checked })}
            />
            <label htmlFor="startNow" className="text-sm text-gray-700">Start auction immediately</label>
          </div>
          {!formData.startNow && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Go live at</label>
              <input
                type="datetime-local"
                value={formData.goLiveAtLocal}
                onChange={(e) => setFormData({ ...formData, goLiveAtLocal: e.target.value })}
                aria-label="Go live at"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Leave empty to default to 1 minute from now.</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              aria-label="Auction title"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              aria-label="Auction description"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Starting Price ($)
            </label>
            <input
              type="number"
              value={formData.startingPrice}
              onChange={(e) => setFormData({...formData, startingPrice: e.target.value})}
              aria-label="Starting price"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="0.01"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bid Increment ($)
            </label>
            <input
              type="number"
              value={formData.bidIncrement}
              onChange={(e) => setFormData({...formData, bidIncrement: e.target.value})}
              aria-label="Bid increment"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0.01"
              step="0.01"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              value={formData.durationMinutes}
              onChange={(e) => setFormData({...formData, durationMinutes: e.target.value})}
              aria-label="Duration in minutes"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="1"
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Auction
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Main App Component
export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [showAuth, setShowAuth] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)
  const [sb, setSb] = useState<typeof initialSupabase>(initialSupabase)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [showNotifications, setShowNotifications] = useState(false)

  // Initialize Supabase from server /config (overrides any build-time VITE values)
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch(`${API_URL}/config`)
        if (!res.ok) return
        const cfg = await res.json()
        if (cfg?.supabaseUrl && cfg?.supabaseAnonKey) {
          setSb(createClient(cfg.supabaseUrl, cfg.supabaseAnonKey))
        } else if (!sb) {
          // keep null; auth disabled
          setSb(null as any)
        }
      } catch {
        // ignore
      }
    }
    loadConfig()
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // API functions
  const _appApiCall = async (
    endpoint: string,
    options?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }

    if (user) {
      const session = await sb?.auth.getSession()
      if (session?.data.session?.access_token) {
        headers['Authorization'] = `Bearer ${session.data.session.access_token}`
      }
    }

  const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    })

    if (!response.ok) {
      let msg = `API Error: ${response.status} ${response.statusText}`
      try {
        const err = await response.json()
        if (err?.error) msg = `${err.error}`
        if (err?.db?.message) msg += ` — ${err.db.message}`
        if (err?.db?.code) msg += ` [${err.db.code}]`
      } catch {
        // ignore
      }
      throw new Error(msg)
    }

    return response.json()
  }
  // expose for nested components
  ;(window as any)._appApiCall = _appApiCall
  const apiCall = _appApiCall

  // Load auctions
  const loadAuctions = async () => {
    try {
      const data = await apiCall('/api/auctions')
      setAuctions(data.items || [])
    } catch (error) {
      console.error('Failed to load auctions:', error)
    }
  }

  const loadNotifications = async () => {
    try {
      const data = await apiCall('/api/notifications')
      setNotifications(data.items || [])
    } catch {
      // ignore if table missing
    }
  }

  // Authentication
  const handleAuth = async (email: string, password: string, isSignUp: boolean) => {
  if (!sb) {
      alert('Authentication not configured')
      return
    }

    try {
      if (isSignUp) {
  const { error } = await sb.auth.signUp({ email, password })
        if (error) throw error
        alert('Check your email for verification link')
      } else {
  const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (error: any) {
      alert(error.message)
    }
  }

  const handleSignOut = async () => {
    if (sb) {
      await sb.auth.signOut()
    }
    setUser(null)
    setShowAuth(false)
  }

  // Auction actions
  const handleCreateAuction = async (auctionData: any) => {
    try {
      await apiCall('/api/auctions', {
        method: 'POST',
        body: JSON.stringify(auctionData)
      })
      setShowCreateForm(false)
      loadAuctions()
    } catch (error) {
      console.error('Failed to create auction:', error)
      alert('Failed to create auction')
    }
  }

  const handlePlaceBid = async (auctionId: string, amount: number) => {
    try {
      await apiCall(`/api/auctions/${auctionId}/bids`, {
        method: 'POST',
        body: JSON.stringify({ amount })
      })
    } catch (error) {
      console.error('Failed to place bid:', error)
      alert('Failed to place bid')
    }
  }

  const respondCounter = async (counterId: string, decision: 'accept' | 'reject') => {
    try {
      await apiCall(`/api/counter-offers/${counterId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision })
      })
      // Refresh notifications
      loadNotifications()
    } catch (e) {
      alert((e as any)?.message || 'Failed to respond')
    }
  }

  const markRead = async (id: string) => {
    try {
      await apiCall(`/api/notifications/${id}/read`, { method: 'POST' })
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
    } catch {}
  }

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      
      if (message.type === 'bid:accepted') {
        setAuctions(prev => prev.map(auction => 
          auction.id === message.auctionId 
            ? { ...auction, currentPrice: message.amount }
            : auction
        ))
      } else if (message.type === 'auction:live') {
        setAuctions(prev => prev.map(a => a.id === message.auctionId ? { ...a, status: 'live' } : a))
      } else if (message.type === 'auction:ended') {
        setAuctions(prev => prev.map(a => a.id === message.auctionId ? { ...a, status: 'ended' } : a))
      } else if (message.type === 'notification' && user && message.userId === user.id) {
        setNotifications(prev => [{ type: message.payload?.type || 'info', payload: message.payload, createdAt: message.ts, read: false }, ...prev])
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  // Supabase auth listener
  useEffect(() => {
    if (!sb) {
      setLoading(false)
      return
    }

    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email || '' })
      }
      setLoading(false)
    })

    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email || '' })
        setShowAuth(false)
  loadNotifications()
      } else {
        setUser(null)
  setNotifications([])
      }
    })

    return () => subscription.unsubscribe()
  }, [sb])

  // Load auctions on mount
  useEffect(() => {
    if (!loading) {
      loadAuctions()
    if (user) loadNotifications()
    }
  }, [loading])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    )
  }

  if (showAuth) {
    return <AuthForm onAuth={handleAuth} />
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        user={user} 
        onSignOut={handleSignOut} 
        onShowAuth={() => setShowAuth(true)} 
      />
      
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">Live Auctions</h2>
          {user && (
            <div className="flex gap-3 items-center">
              <button
                onClick={() => setShowNotifications(v => !v)}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                Notifications ({notifications.filter(n => !n.read).length})
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create Auction
              </button>
            </div>
          )}
        </div>

        {auctions.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-xl text-gray-600 mb-4">No auctions available</h3>
            {user && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create the first auction
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {auctions.map(auction => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                onBid={handlePlaceBid}
                user={user}
              />
            ))}
          </div>
        )}
      </main>

      {showCreateForm && (
        <CreateAuctionForm
          onSubmit={handleCreateAuction}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {showNotifications && user && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifications(false)}
          onMarkRead={markRead}
          onRespondCounter={respondCounter}
        />
      )}
    </div>
  )
}

function NotificationsPanel({ notifications, onClose, onMarkRead, onRespondCounter }: {
  notifications: NotificationItem[]
  onClose: () => void
  onMarkRead: (id: string) => void
  onRespondCounter: (counterId: string, decision: 'accept' | 'reject') => void
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-xl max-h-[80vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Notifications</h3>
          <button onClick={onClose} className="px-3 py-1 bg-gray-200 rounded">Close</button>
        </div>
        {notifications.length === 0 ? (
          <div className="text-gray-600">No notifications</div>
        ) : (
          <ul className="space-y-3">
            {notifications.map((n, idx) => (
              <li key={(n.id as any) || idx} className={`border p-3 rounded ${n.read ? 'bg-white' : 'bg-yellow-50'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{n.type.replace('_', ' ').toUpperCase()}</div>
                    <div className="text-sm text-gray-700 break-words">
                      {renderNotificationText(n)}
                    </div>
                  </div>
                  {n.id && (
                    <button onClick={() => onMarkRead(n.id!)} className="text-sm text-blue-600 hover:underline">Mark read</button>
                  )}
                </div>
                {n.type === 'counter_offer' && n.payload?.counterOfferId && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => onRespondCounter(n.payload.counterOfferId, 'accept')} className="px-3 py-1 bg-green-600 text-white rounded">Accept</button>
                    <button onClick={() => onRespondCounter(n.payload.counterOfferId, 'reject')} className="px-3 py-1 bg-red-600 text-white rounded">Reject</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function renderNotificationText(n: NotificationItem) {
  const p = n.payload || {}
  switch (n.type) {
    case 'new_bid':
      return `New bid: $${Number(p.amount).toFixed(2)} on auction ${p.auctionId}`
    case 'auction_ended':
      return `Auction ended. Highest bid: $${Number(p.amount).toFixed(2)} (auction ${p.auctionId})`
    case 'bid_accepted':
      return `Your bid was accepted on auction ${p.auctionId} for $${Number(p.amount).toFixed(2)}`
    case 'bid_rejected':
      return `Your bid was rejected on auction ${p.auctionId}`
    case 'counter_offer':
      return `Counter offer: $${Number(p.amount).toFixed(2)} on auction ${p.auctionId}`
    case 'counter_accepted':
      return `Counter offer accepted on auction ${p.auctionId}`
    case 'counter_rejected':
      return `Counter offer rejected on auction ${p.auctionId}`
    default:
      try {
        return JSON.stringify(n.payload)
      } catch {
        return String(n.payload)
      }
  }
}