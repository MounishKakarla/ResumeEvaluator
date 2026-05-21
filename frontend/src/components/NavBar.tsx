import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { changePassword } from '../api/client'
import LogoDark from '../assets/Tektalis_Logo_Dark.svg'
import LogoWhite from '../assets/Tektalis_Logo_White.svg'

const navItems = [
  { label: 'Job Roles', path: '/configure' },
  { label: 'Ingestion', path: '/upload' },
  { label: 'Leaderboard', path: '/leaderboard' },
  { label: 'Search', path: '/search' },
]
const adminNavItems = [
  { label: 'Email Log', path: '/email-ingestion' },
  { label: 'Users', path: '/users' },
]

function EyeOn() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

export default function NavBar() {
  const navigate = useNavigate()
  const { role, user, clearAuth, darkMode, toggleDarkMode } = useAppStore()
  const logo = darkMode ? LogoWhite : LogoDark

  // ── User menu dropdown ──────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // ── Change password modal ───────────────────────────────────
  const [showChangePw, setShowChangePw] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwFeedback, setPwFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  function openChangePw() {
    setMenuOpen(false)
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setPwFeedback(null)
    setShowCurrentPw(false)
    setShowNewPw(false)
    setShowConfirmPw(false)
    setShowChangePw(true)
  }

  const changePwMut = useMutation({
    mutationFn: () => changePassword(currentPw, newPw),
    onSuccess: () => {
      setPwFeedback({ type: 'success', text: 'Password updated. Logging you out…' })
      setTimeout(() => {
        clearAuth()
        navigate('/login')
      }, 1800)
    },
    onError: (err: any) => {
      setPwFeedback({
        type: 'error',
        text: err?.response?.data?.detail ?? 'Failed to change password.',
      })
    },
  })

  function handleChangePw() {
    if (newPw !== confirmPw) {
      setPwFeedback({ type: 'error', text: 'New passwords do not match.' })
      return
    }
    setPwFeedback(null)
    changePwMut.mutate()
  }

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  const inputCls =
    'w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition placeholder-gray-400 dark:placeholder-gray-500'

  return (
    <>
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 h-14 flex items-center px-6 gap-6 shadow-sm">
        {/* Logo */}
        <div className="flex items-center mr-4 select-none">
          <img src={logo} alt="TekTalentScan" className="h-7 w-auto" />
        </div>

        {/* Nav tabs */}
        <div className="flex items-center gap-1 flex-1">
          {[...navItems, ...(role === 'admin' ? adminNavItems : [])].map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `px-4 py-1 text-sm font-medium rounded-t transition-colors
                ${
                  isActive
                    ? 'text-[#534AB7] border-b-2 border-[#534AB7] pb-[2px]'
                    : 'text-gray-500 dark:text-gray-400 hover:text-[#534AB7]'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {role && (
            <span className="text-xs font-semibold bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] px-2.5 py-1 rounded-full border border-[#AFA9EC] dark:border-[#534AB7]">
              {role}
            </span>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-[#534AB7] transition-colors px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <span className="max-w-[150px] truncate">{user?.email ?? 'Account'}</span>
              <svg className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg py-1 z-50">
                <button
                  onClick={openChangePw}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Change Password
                </button>
                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-red-950 transition-colors"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Change Password Modal ─────────────────────────────── */}
      {showChangePw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">Change Password</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">You'll be logged out after a successful change.</p>

            <div className="space-y-3">
              {/* Current Password */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    className={inputCls}
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    autoFocus
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowCurrentPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {showCurrentPw ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
              </div>
              {/* New Password */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    className={inputCls}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowNewPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {showNewPw ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
              </div>
              {/* Confirm New Password */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    className={inputCls}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleChangePw() }}
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowConfirmPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  >
                    {showConfirmPw ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
              </div>
            </div>

            {pwFeedback && (
              <p className={`text-xs mt-3 font-medium ${
                pwFeedback.type === 'success' ? 'text-[#1D9E75]' : 'text-[#E24B4A]'
              }`}>
                {pwFeedback.text}
              </p>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleChangePw}
                disabled={changePwMut.isPending || !currentPw || !newPw || !confirmPw || !!pwFeedback?.type && pwFeedback.type === 'success'}
                className="flex-1 bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg py-2 text-sm transition-colors"
              >
                {changePwMut.isPending ? 'Updating…' : 'Update Password'}
              </button>
              <button
                onClick={() => setShowChangePw(false)}
                disabled={changePwMut.isPending}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
