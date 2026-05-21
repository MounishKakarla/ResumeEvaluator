import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, forgotPassword } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import LogoDark from '../assets/Tektalis_Logo_Dark.svg'
import LogoWhite from '../assets/Tektalis_Logo_White.svg'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)
  const darkMode = useAppStore((s) => s.darkMode)
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
  const logo = darkMode ? LogoWhite : LogoDark

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg] = useState<string | null>(null)
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    setForgotMsg(null)
    try {
      const res = await forgotPassword(forgotEmail)
      setForgotMsg(res.message)
    } catch {
      setForgotMsg('Something went wrong. Please try again.')
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await login(email, password)
      localStorage.setItem('refresh_token', res.refresh_token)
      setAuth(res.access_token, res.role, res.email)
      navigate('/configure')
    } catch (err: unknown) {
      let msg = 'Invalid credentials. Please try again.'
      const rawDetail = (err as any)?.response?.data?.detail
      if (typeof rawDetail === 'string') {
        msg = rawDetail
      } else if (Array.isArray(rawDetail) && rawDetail.length > 0) {
        const first = rawDetail[0]
        const extracted = typeof first === 'string' ? first : first?.msg
        if (typeof extracted === 'string' && extracted) msg = extracted
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EEEDFE] to-white dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4 relative">
      {/* Theme toggle — top right */}
      <button
        onClick={toggleDarkMode}
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-gray-800 transition-colors bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm"
      >
        {darkMode ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.71.71M6.34 17.66l-.71.71M17.66 17.66l-.71-.71M6.34 6.34l-.71-.71M12 7a5 5 0 100 10A5 5 0 0012 7z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
          </svg>
        )}
      </button>
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-lg border border-[#AFA9EC]/40 dark:border-gray-700 p-8">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src={logo} alt="TekTalentScan" className="h-10 w-auto" />
        </div>

        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1 text-center">Welcome back</h1>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center mb-6">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-[#FCEBEB] border border-[#E24B4A]/30 rounded-lg px-3 py-2.5">
              <p className="text-xs text-[#791F1F]">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => { setShowForgot((v) => !v); setForgotMsg(null) }}
            className="text-xs text-[#534AB7] dark:text-[#AFA9EC] hover:underline"
          >
            {showForgot ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </div>

        {showForgot && (
          <form onSubmit={handleForgot} className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Enter your email address
              </label>
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition"
                placeholder="you@company.com"
              />
            </div>
            {forgotMsg && (
              <div className="bg-[#E1F5EE] dark:bg-[#0d3328] border border-[#5DCAA5] rounded-lg px-3 py-2.5">
                <p className="text-xs text-[#085041] dark:text-[#5DCAA5]">{forgotMsg}</p>
              </div>
            )}
            <button
              type="submit"
              disabled={forgotLoading}
              className="w-full border border-[#534AB7] text-[#534AB7] dark:text-[#AFA9EC] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] disabled:opacity-60 font-semibold rounded-lg py-2.5 text-sm transition-colors"
            >
              {forgotLoading ? 'Sending…' : 'Send temporary password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
