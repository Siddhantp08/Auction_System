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
  endsAt: string
  sellerId: string
}

interface User {
  id: string
  email: string
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
      setTimeLeft(formatTime(auction.endsAt))
    }, 1000)
    return () => clearInterval(timer)
  }, [auction.endsAt])

  const handleBid = () => {
    const amount = parseFloat(bidAmount)
    if (amount > auction.currentPrice) {
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
          <span className="text-gray-600">Time Left:</span>
          <span className={`font-medium ${timeLeft === 'Ended' ? 'text-red-600' : 'text-green-600'}`}>
            {timeLeft}
          </span>
        </div>
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
    durationMinutes: '60'
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const goLiveAt = new Date(Date.now() + 60000).toISOString() // Start in 1 minute
    onSubmit({
      ...formData,
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
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

  // Initialize Supabase from server config if not provided at build-time
  useEffect(() => {
    if (sb) return
    const loadConfig = async () => {
      try {
        const res = await fetch(`${API_URL}/config`)
        if (!res.ok) return
        const cfg = await res.json()
        if (cfg?.supabaseUrl && cfg?.supabaseAnonKey) {
          setSb(createClient(cfg.supabaseUrl, cfg.supabaseAnonKey))
        }
      } catch {
        // ignore
      }
    }
    loadConfig()
  }, [sb])

  // API functions
  const apiCall = async (
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

  // Load auctions
  const loadAuctions = async () => {
    try {
      const data = await apiCall('/api/auctions')
      setAuctions(data.items || [])
    } catch (error) {
      console.error('Failed to load auctions:', error)
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
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [sb])

  // Load auctions on mount
  useEffect(() => {
    if (!loading) {
      loadAuctions()
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
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Auction
            </button>
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
    </div>
  )
}