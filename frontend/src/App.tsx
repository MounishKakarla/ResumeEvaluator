import { Navigate, Route, Routes } from 'react-router-dom'
import { useAppStore } from './store/useAppStore'
import Login from './pages/Login'
import Configure from './pages/Configure'
import Upload from './pages/Upload'
import Leaderboard from './pages/Leaderboard'
import CandidateDetail from './pages/CandidateDetail'
import Analytics from './pages/Analytics'
import EmailIngestion from './pages/EmailIngestion'
import Users from './pages/Users'
import Landing from './pages/Landing'
import Search from './pages/Search'
import AuditLogs from './pages/AuditLogs'
import Layout from './components/Layout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAppStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const token = useAppStore((s) => s.token)

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/configure"
        element={
          <ProtectedRoute>
            <Layout>
              <Configure />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <Layout>
              <Upload />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/leaderboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Leaderboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/results/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <CandidateDetail />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <Layout>
              <Analytics />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/email-ingestion"
        element={
          <ProtectedRoute>
            <Layout>
              <EmailIngestion />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <Layout>
              <Users />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/audit"
        element={
          <ProtectedRoute>
            <Layout>
              <AuditLogs />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/search"
        element={
          <ProtectedRoute>
            <Layout>
              <Search />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/"
        element={token ? <Navigate to="/leaderboard" replace /> : <Landing />}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
