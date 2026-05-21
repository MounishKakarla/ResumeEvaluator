import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DetectedSection {
  label: string
  line_start: number
  line_end: number
  color: string
}

export interface QueuedFile {
  file: File
  candidateName: string
  candidateEmail: string
  progress: number
  stage: string
  status: 'parsing' | 'scoring' | 'done' | 'error'
  resumeId?: number
  sections?: DetectedSection[]
}

interface AppState {
  token: string | null
  role: string | null
  user: { email: string } | null
  selectedJobRoleId: number | null
  darkMode: boolean
  uploadQueue: QueuedFile[]
  setAuth: (token: string, role: string, email: string) => void
  clearAuth: () => void
  setJobRole: (id: number) => void
  toggleDarkMode: () => void
  setUploadQueue: (queue: QueuedFile[] | ((prev: QueuedFile[]) => QueuedFile[])) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      user: null,
      selectedJobRoleId: null,
      darkMode: false,
      uploadQueue: [],

      setAuth: (token: string, role: string, email: string) => {
        localStorage.setItem('token', token)
        set({ token, role, user: { email } })
      },

      clearAuth: () => {
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        set({ token: null, role: null, user: null })
      },

      setJobRole: (id: number) => {
        set({ selectedJobRoleId: id })
      },

      toggleDarkMode: () => {
        set((state) => {
          const next = !state.darkMode
          if (next) document.documentElement.classList.add('dark')
          else document.documentElement.classList.remove('dark')
          return { darkMode: next }
        })
      },
      setUploadQueue: (queueOrFn: any[] | ((prev: any[]) => any[])) => {
        set((state) => ({
          uploadQueue: typeof queueOrFn === 'function' ? queueOrFn(state.uploadQueue) : queueOrFn,
        }))
      },
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        token: state.token,
        role: state.role,
        user: state.user,
        selectedJobRoleId: state.selectedJobRoleId,
        darkMode: state.darkMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.darkMode) document.documentElement.classList.add('dark')
        else document.documentElement.classList.remove('dark')
        // Keep localStorage in sync so the axios request interceptor always
        // reads the correct token — critical after a background token refresh
        if (state?.token) {
          localStorage.setItem('token', state.token)
        } else {
          localStorage.removeItem('token')
        }
      },
    }
  )
)
