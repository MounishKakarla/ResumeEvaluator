import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listUsers, createAdminUser, resetAdminUserPassword, revokeUser, deleteUser, changePassword } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import { useNavigate } from 'react-router-dom'

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

export default function Users() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const role = useAppStore((s) => s.role)
  const currentEmail = useAppStore((s) => s.user?.email)
  const darkMode = useAppStore((s) => s.darkMode)
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
  const clearAuth = useAppStore((s) => s.clearAuth)

  // ── Change Password ──────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwFeedback, setPwFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  const changePwMut = useMutation({
    mutationFn: () => changePassword(currentPw, newPw),
    onSuccess: () => {
      setPwFeedback({ type: 'success', text: 'Password updated. Logging you out…' })
      setTimeout(() => { clearAuth(); navigate('/login') }, 1800)
    },
    onError: (err: any) => {
      setPwFeedback({ type: 'error', text: err?.response?.data?.detail ?? 'Failed to change password.' })
    },
  })

  function handleChangePw() {
    if (newPw !== confirmPw) { setPwFeedback({ type: 'error', text: 'New passwords do not match.' }); return }
    setPwFeedback(null)
    changePwMut.mutate()
  }

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition placeholder-gray-400 dark:placeholder-gray-500'

  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<'recruiter' | 'admin'>('recruiter')
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [rowMsg, setRowMsg] = useState<{ userId: number; type: 'success' | 'error'; text: string } | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: listUsers,
    staleTime: 0,
  })

  const resetPwMut = useMutation({
    mutationFn: (userId: number) => resetAdminUserPassword(userId),
    onSuccess: (_data, userId) => {
      setRowMsg({ userId, type: 'success', text: 'Password reset — email sent.' })
      setTimeout(() => setRowMsg(null), 3000)
    },
    onError: (_err, userId) => {
      setRowMsg({ userId, type: 'error', text: 'Failed to reset password.' })
      setTimeout(() => setRowMsg(null), 3000)
    },
  })

  const revokeMut = useMutation({
    mutationFn: (userId: number) => revokeUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
    onError: (err: any, userId) => {
      setRowMsg({ userId, type: 'error', text: err?.response?.data?.detail ?? 'Failed to update.' })
      setTimeout(() => setRowMsg(null), 3000)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (userId: number) => deleteUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
    onError: (err: any, userId) => {
      setRowMsg({ userId, type: 'error', text: err?.response?.data?.detail ?? 'Failed to delete user.' })
      setTimeout(() => setRowMsg(null), 3000)
    },
  })

  const createMut = useMutation({
    mutationFn: () => createAdminUser(email.trim(), newRole),
    onSuccess: (u) => {
      setMsg({ type: 'success', text: `Account created — welcome email sent to ${u.email}` })
      setEmail('')
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
    onError: (err: any) => {
      setMsg({ type: 'error', text: err?.response?.data?.detail ?? 'Failed to create user.' })
    },
  })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* ── My Settings (visible to all users) ──────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-0.5">My Settings</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">Appearance and account preferences</p>
        </div>

        {/* Theme toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Dark Mode</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Switch between light and dark interface</p>
          </div>
          <button
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${darkMode ? 'bg-[#534AB7]' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Change password */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">Change Password</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">You'll be logged out after a successful change.</p>
          <div className="space-y-3 max-w-sm">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Current Password</label>
              <div className="relative">
                <input type={showCurrentPw ? 'text' : 'password'} className={inputCls} value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
                <button type="button" tabIndex={-1} onClick={() => setShowCurrentPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  {showCurrentPw ? <EyeOff /> : <EyeOn />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">New Password</label>
              <div className="relative">
                <input type={showNewPw ? 'text' : 'password'} className={inputCls} value={newPw}
                  onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" />
                <button type="button" tabIndex={-1} onClick={() => setShowNewPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  {showNewPw ? <EyeOff /> : <EyeOn />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Confirm New Password</label>
              <div className="relative">
                <input type={showConfirmPw ? 'text' : 'password'} className={inputCls} value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleChangePw() }} />
                <button type="button" tabIndex={-1} onClick={() => setShowConfirmPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                  {showConfirmPw ? <EyeOff /> : <EyeOn />}
                </button>
              </div>
            </div>

            {pwFeedback && (
              <p className={`text-xs font-medium ${pwFeedback.type === 'success' ? 'text-[#1D9E75]' : 'text-[#E24B4A]'}`}>
                {pwFeedback.text}
              </p>
            )}

            <button
              onClick={handleChangePw}
              disabled={changePwMut.isPending || !currentPw || !newPw || !confirmPw || pwFeedback?.type === 'success'}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors"
            >
              {changePwMut.isPending ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      {role !== 'admin' ? null : <>
      {/* Create User Card */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Create User Account</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
          A welcome email with auto-generated login credentials is sent to the new user immediately.
        </p>

        <div className="flex gap-3">
          <input
            type="email"
            placeholder="Email address…"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setMsg(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && email.trim()) createMut.mutate() }}
            className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7]"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as 'recruiter' | 'admin')}
            className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 w-36"
          >
            <option value="recruiter">Recruiter</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !email.trim()}
            className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition-colors shrink-0"
          >
            {createMut.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
            msg.type === 'success'
              ? 'bg-[#E1F5EE] border border-[#5DCAA5]/40 text-[#085041]'
              : 'bg-[#FCEBEB] border border-[#E24B4A]/30 text-[#791F1F]'
          }`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* User List */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">All Users</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{users.length} total</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No users found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Created</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-56 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.email === currentEmail
                const busy = (revokeMut.isPending && revokeMut.variables === u.id) ||
                             (deleteMut.isPending && deleteMut.variables === u.id) ||
                             (resetPwMut.isPending && resetPwMut.variables === u.id)
                return (
                  <tr key={u.id} className={`border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3 text-gray-800 dark:text-gray-100">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        u.role === 'admin'
                          ? 'bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] border-[#AFA9EC]'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        u.is_active
                          ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]/40'
                          : 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]/30'
                      }`}>
                        {u.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
                      {new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {rowMsg?.userId === u.id ? (
                        <span className={`text-xs font-medium ${rowMsg.type === 'success' ? 'text-[#085041]' : 'text-[#791F1F]'}`}>
                          {rowMsg.text}
                        </span>
                      ) : isSelf ? (
                        <span className="text-xs text-gray-300 dark:text-gray-600 italic">you</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              if (confirm(`Reset password for ${u.email}?`)) resetPwMut.mutate(u.id)
                            }}
                            disabled={busy}
                            className="text-xs font-medium text-[#534AB7] hover:text-[#3C3489] border border-[#AFA9EC]/60 hover:border-[#534AB7] rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          >
                            Reset PW
                          </button>
                          <button
                            onClick={() => revokeMut.mutate(u.id)}
                            disabled={busy}
                            className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors disabled:opacity-40 ${
                              u.is_active
                                ? 'text-[#EF9F27] border-[#EF9F27]/50 hover:bg-[#FEF3E2]'
                                : 'text-[#1D9E75] border-[#1D9E75]/50 hover:bg-[#E1F5EE]'
                            }`}
                          >
                            {revokeMut.isPending && revokeMut.variables === u.id
                              ? '…'
                              : u.is_active ? 'Revoke' : 'Restore'}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Permanently delete ${u.email}? This cannot be undone.`)) deleteMut.mutate(u.id)
                            }}
                            disabled={busy}
                            className="text-xs font-medium text-[#E24B4A] hover:text-white hover:bg-[#E24B4A] border border-[#E24B4A]/50 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          >
                            {deleteMut.isPending && deleteMut.variables === u.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      </>}
    </div>
  )
}
