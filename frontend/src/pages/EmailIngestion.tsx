import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getImapConfig, getInboundEmails, getImapSettings, saveImapSettings, testImapConnection, getGraphSettings, saveGraphSettings, testGraphConnection, getIngestionMethod, setIngestionMethod, triggerGraphFetch, stopGraphFetch, triggerImapFetch, stopImapFetch, deleteInboundEmail, clearInboundEmails, retryInboundEmail } from '../api/client'
import type { InboundEmailItem, IngestionMethod } from '../api/client'
import { useAppStore } from '../store/useAppStore'

const STATUS_STYLES: Record<string, string> = {
  processed:        'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]',
  failed:           'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]',
  no_attachment:    'bg-[#FFF8E7] text-[#633806] border-[#EF9F27]',
  new:              'bg-[#F3F4F6] text-[#374151] border-[#D1D5DB]',
  keyword_filtered: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
}

const STATUS_LABELS: Record<string, string> = {
  processed:        'Processed',
  failed:           'Failed',
  no_attachment:    'No Attachment',
  new:              'Pending',
  keyword_filtered: 'Keyword Filtered',
}

type FilterStatus = '' | 'processed' | 'failed' | 'no_attachment' | 'new' | 'keyword_filtered'

export default function EmailIngestion() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('')
  const [page, setPage] = useState(1)
  const role = useAppStore((s) => s.role)
  const isAdmin = role === 'admin'
  const queryClient = useQueryClient()

  // IMAP settings form state
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [imapUser, setImapUser] = useState('')
  const [imapPass, setImapPass] = useState('')
  const [imapSsl, setImapSsl] = useState(true)
  const [imapFolder, setImapFolder] = useState('INBOX')
  const [imapKeywords, setImapKeywords] = useState('')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [imapFetching, setImapFetching] = useState(false)
  const [imapFetchMsg, setImapFetchMsg] = useState<string | null>(null)
  const [imapStopMsg, setImapStopMsg] = useState<string | null>(null)
  const [imapActive, setImapActive] = useState(() => {
    try {
      return localStorage.getItem('imapFetchActive') === 'true'
    } catch {
      return false
    }
  })

  const { data: imapSettings } = useQuery({
    queryKey: ['imapSettings'],
    queryFn: getImapSettings,
    enabled: isAdmin,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (imapSettings && !settingsLoaded) {
      setImapHost(imapSettings.imap_host)
      setImapPort(imapSettings.imap_port)
      setImapUser(imapSettings.imap_username)
      setImapSsl(imapSettings.imap_ssl)
      setImapFolder(imapSettings.imap_folder)
      setImapKeywords(imapSettings.imap_subject_keywords)
      setSettingsLoaded(true)
    }
  }, [imapSettings, settingsLoaded])

  const saveMut = useMutation({
    mutationFn: () => saveImapSettings({
      imap_host: imapHost.trim(),
      imap_port: imapPort,
      imap_username: imapUser.trim(),
      imap_password: imapPass,
      imap_ssl: imapSsl,
      imap_folder: imapFolder.trim() || 'INBOX',
      imap_subject_keywords: imapKeywords,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['imapSettings'] })
      queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
      setImapPass('')
      setSaveMsg(res.message)
      setTimeout(() => setSaveMsg(null), 4000)
    },
    onError: () => {
      setSaveMsg('Failed to save settings.')
      setTimeout(() => setSaveMsg(null), 3000)
    },
  })

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testImapConnection()
      setTestResult(res)
    } catch {
      setTestResult({ ok: false, error: 'Request failed. Check server logs.' })
    } finally {
      setTesting(false)
    }
  }

  async function handleImapFetchNow() {
    setImapFetching(true)
    setImapFetchMsg(null)
    setImapStopMsg(null)
    try {
      const res = await triggerImapFetch()
      setImapFetchMsg(res.message)
      setImapActive(true)
      try {
        localStorage.setItem('imapFetchActive', 'true')
      } catch (err) {
        console.error(err)
      }
      setTimeout(() => {
        setImapFetchMsg(null)
        queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
        queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
      }, 5000)
    } catch {
      setImapFetchMsg('Fetch trigger failed. Check server logs.')
      setTimeout(() => setImapFetchMsg(null), 3000)
    } finally {
      setImapFetching(false)
    }
  }

  async function handleImapStopFetch() {
    try {
      const res = await stopImapFetch()
      setImapStopMsg(res.message)
      setImapFetchMsg(null)
      setImapActive(false)
      try {
        localStorage.setItem('imapFetchActive', 'false')
      } catch (err) {
        console.error(err)
      }
      setTimeout(() => setImapStopMsg(null), 5000)
    } catch {
      setImapStopMsg('Stop signal failed. Check server logs.')
      setTimeout(() => setImapStopMsg(null), 3000)
    }
  }

  // Graph API settings state
  const [graphClientId, setGraphClientId] = useState('')
  const [graphTenantId, setGraphTenantId] = useState('')
  const [graphSecret, setGraphSecret] = useState('')
  const [graphMailbox, setGraphMailbox] = useState('')
  const [graphFolder, setGraphFolder] = useState('Inbox')
  const [graphKeywords, setGraphKeywords] = useState('')
  const [graphFromDate, setGraphFromDate] = useState('')
  const [graphToDate, setGraphToDate] = useState('')
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [graphSaveMsg, setGraphSaveMsg] = useState<string | null>(null)
  const [graphTestResult, setGraphTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)
  const [graphTesting, setGraphTesting] = useState(false)
  const [graphFetchMsg, setGraphFetchMsg] = useState<string | null>(null)
  const [graphFetching, setGraphFetching] = useState(false)
  const [stopMsg, setStopMsg] = useState<string | null>(null)
  const [graphActive, setGraphActive] = useState(() => {
    try {
      return localStorage.getItem('graphFetchActive') === 'true'
    } catch {
      return false
    }
  })

  const { data: graphSettings } = useQuery({
    queryKey: ['graphSettings'],
    queryFn: getGraphSettings,
    enabled: isAdmin,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (graphSettings && !graphLoaded) {
      setGraphClientId(graphSettings.graph_client_id)
      setGraphTenantId(graphSettings.graph_tenant_id)
      setGraphMailbox(graphSettings.graph_mailbox)
      setGraphFolder(graphSettings.graph_folder || 'Inbox')
      setGraphKeywords(graphSettings.graph_subject_keywords)
      setGraphFromDate(graphSettings.graph_fetch_from_date || '')
      setGraphToDate(graphSettings.graph_fetch_to_date || '')
      setGraphLoaded(true)
    }
  }, [graphSettings, graphLoaded])

  const saveGraphMut = useMutation({
    mutationFn: () => saveGraphSettings({
      graph_client_id: graphClientId.trim(),
      graph_tenant_id: graphTenantId.trim(),
      graph_client_secret: graphSecret,
      graph_mailbox: graphMailbox.trim(),
      graph_folder: graphFolder.trim() || 'Inbox',
      graph_subject_keywords: graphKeywords,
      graph_fetch_from_date: graphFromDate,
      graph_fetch_to_date: graphToDate,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['graphSettings'] })
      setGraphSecret('')
      setGraphSaveMsg(res.message)
      setTimeout(() => setGraphSaveMsg(null), 4000)
    },
    onError: () => {
      setGraphSaveMsg('Failed to save settings.')
      setTimeout(() => setGraphSaveMsg(null), 3000)
    },
  })

  async function handleTestGraph() {
    setGraphTesting(true)
    setGraphTestResult(null)
    try {
      const res = await testGraphConnection()
      setGraphTestResult(res)
    } catch {
      setGraphTestResult({ ok: false, error: 'Request failed. Check server logs.' })
    } finally {
      setGraphTesting(false)
    }
  }

  function applyDatePreset(days: number | null) {
    if (days === null) {
      setGraphFromDate('')
      setGraphToDate('')
      return
    }
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - days)
    setGraphFromDate(from.toISOString().slice(0, 10))
    setGraphToDate(today.toISOString().slice(0, 10))
  }

  async function handleFetchNow() {
    setGraphFetching(true)
    setGraphFetchMsg(null)
    setStopMsg(null)
    try {
      const res = await triggerGraphFetch(graphFromDate || undefined, graphToDate || undefined)
      setGraphFetchMsg(res.message)
      setGraphActive(true)
      try {
        localStorage.setItem('graphFetchActive', 'true')
      } catch (err) {
        console.error(err)
      }
      setTimeout(() => {
        setGraphFetchMsg(null)
        queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
        queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
      }, 5000)
    } catch {
      setGraphFetchMsg('Fetch trigger failed. Check server logs.')
      setTimeout(() => setGraphFetchMsg(null), 3000)
    } finally {
      setGraphFetching(false)
    }
  }

  async function handleStopFetch() {
    try {
      const res = await stopGraphFetch()
      setStopMsg(res.message)
      setGraphFetchMsg(null)
      setGraphActive(false)
      try {
        localStorage.setItem('graphFetchActive', 'false')
      } catch (err) {
        console.error(err)
      }
      setTimeout(() => setStopMsg(null), 5000)
    } catch {
      setStopMsg('Stop signal failed. Check server logs.')
      setTimeout(() => setStopMsg(null), 3000)
    }
  }

  // Ingestion method selector
  const [selectedMethod, setSelectedMethod] = useState<IngestionMethod>('auto')
  const [methodSaveMsg, setMethodSaveMsg] = useState<string | null>(null)

  const { data: ingestionMethodData } = useQuery({
    queryKey: ['ingestionMethod'],
    queryFn: getIngestionMethod,
    enabled: isAdmin,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (ingestionMethodData) setSelectedMethod(ingestionMethodData.method)
  }, [ingestionMethodData])

  const saveMethodMut = useMutation({
    mutationFn: (method: IngestionMethod) => setIngestionMethod(method),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ingestionMethod'] })
      queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
      setMethodSaveMsg(res.message)
      setTimeout(() => setMethodSaveMsg(null), 3000)
    },
  })

  // Delete / clear log state (admin only)
  const [confirmClear, setConfirmClear] = useState<'all' | string | null>(null)
  const [clearMsg, setClearMsg] = useState<string | null>(null)

  const retrySingleMut = useMutation({
    mutationFn: (id: number) => retryInboundEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
    onError: () => alert('Failed to reset email for retry.'),
  })

  const deleteSingleMut = useMutation({
    mutationFn: (id: number) => deleteInboundEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
      queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
    },
  })

  const clearMut = useMutation({
    mutationFn: (filterStatus?: string) => clearInboundEmails(filterStatus),
    onSuccess: (res) => {
      setConfirmClear(null)
      setClearMsg(res.message)
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
      queryClient.invalidateQueries({ queryKey: ['imapConfig'] })
      setTimeout(() => setClearMsg(null), 4000)
    },
  })

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['imapConfig'],
    queryFn: getImapConfig,
    refetchInterval: 30_000,
  })

  const { data: log, isLoading: logLoading } = useQuery({
    queryKey: ['inboundEmails', statusFilter, page],
    queryFn: () => getInboundEmails({ status: statusFilter || undefined, page, limit: 30 }),
    refetchInterval: 30_000,
  })

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* ── IMAP Settings Card (admin only) ───────────────────── */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">IMAP Inbox Settings</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Configure the inbox that receives candidate resumes. Changes take effect on the next poll cycle.
              </p>
            </div>
            {imapSettings && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                imapSettings.configured
                  ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
              }`}>
                {imapSettings.configured ? 'Configured' : 'Not configured'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">IMAP Host</label>
              <input
                className={inputCls}
                placeholder="e.g. outlook.office365.com or imap.gmail.com"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Port</label>
              <input
                type="number"
                className={inputCls}
                value={imapPort}
                onChange={(e) => setImapPort(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Email / Username</label>
              <input
                className={inputCls}
                placeholder="career@yourdomain.com"
                value={imapUser}
                onChange={(e) => setImapUser(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Password
                {imapSettings?.imap_password_set && (
                  <span className="ml-1 text-[#1D9E75] font-normal">(already set — leave blank to keep)</span>
                )}
              </label>
              <input
                type="password"
                className={inputCls}
                placeholder={imapSettings?.imap_password_set ? '••••••••' : 'Enter password'}
                value={imapPass}
                onChange={(e) => setImapPass(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Folder</label>
              <input
                className={inputCls}
                placeholder="INBOX"
                value={imapFolder}
                onChange={(e) => setImapFolder(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Use SSL/TLS</span>
              <button
                type="button"
                onClick={() => setImapSsl((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${imapSsl ? 'bg-[#1D9E75]' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${imapSsl ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
              <span className={`text-xs font-semibold ${imapSsl ? 'text-[#1D9E75]' : 'text-gray-400'}`}>
                {imapSsl ? 'On (port 993)' : 'Off (port 143)'}
              </span>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              Subject Keywords
              <span className="ml-1 font-normal text-gray-400">(comma-separated; only matching emails processed — leave empty for all)</span>
            </label>
            <input
              className={inputCls}
              placeholder="resume,cv,application,applying"
              value={imapKeywords}
              onChange={(e) => setImapKeywords(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !imapHost.trim() || !imapUser.trim()}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {saveMut.isPending ? 'Saving…' : 'Save Settings'}
            </button>
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="border border-[#534AB7] text-[#534AB7] dark:text-[#AFA9EC] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              onClick={handleImapFetchNow}
              disabled={imapFetching || imapActive || !imapSettings?.configured}
              className="border border-[#1D9E75] text-[#1D9E75] hover:bg-[#E1F5EE] dark:hover:bg-[#0a2e22] disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {imapFetching ? 'Triggering…' : 'Fetch Now'}
            </button>
            {imapSettings?.configured && (
              <button
                onClick={handleImapStopFetch}
                disabled={!imapActive}
                className="border border-[#E24B4A] text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-red-950/30 disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors flex items-center gap-1.5"
                title="Stop the current IMAP fetch cycle"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop Fetch
              </button>
            )}
            {saveMsg && (
              <span className="text-xs text-[#1D9E75] font-medium">{saveMsg}</span>
            )}
            {imapFetchMsg && <span className="text-xs text-[#1D9E75] font-medium">{imapFetchMsg}</span>}
            {imapStopMsg && <span className="text-xs text-[#E24B4A] font-medium">{imapStopMsg}</span>}
            {testResult && (
              <span className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${
                testResult.ok
                  ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
                  : 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]'
              }`}>
                {testResult.ok ? `✓ ${testResult.message}` : `✗ ${testResult.error}`}
              </span>
            )}
          </div>

          <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p className="font-medium text-gray-600 dark:text-gray-300">Common settings:</p>
            <p>Office 365 / Outlook: host <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">outlook.office365.com</code> · port <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">993</code> · SSL on</p>
            <p>Gmail (App Password): host <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">imap.gmail.com</code> · port <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">993</code> · SSL on</p>
            <p>For Gmail, enable 2FA and use an <strong>App Password</strong> (not your regular password). For Office 365, enable IMAP in Outlook settings.</p>
          </div>
        </div>
      )}

      {/* ── Microsoft Graph API Settings Card (admin only) ───── */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Microsoft Graph API Inbox</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Recommended for Office 365 — uses OAuth2 app auth, no password required.
              </p>
            </div>
            {graphSettings && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                graphSettings.configured
                  ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
              }`}>
                {graphSettings.configured ? 'Configured' : 'Not configured'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Client ID</label>
              <input className={inputCls} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={graphClientId} onChange={(e) => setGraphClientId(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Tenant ID</label>
              <input className={inputCls} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={graphTenantId} onChange={(e) => setGraphTenantId(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Client Secret
                {graphSettings?.graph_client_secret_set && (
                  <span className="ml-1 text-[#1D9E75] font-normal">(already set — leave blank to keep)</span>
                )}
              </label>
              <input type="password" className={inputCls}
                placeholder={graphSettings?.graph_client_secret_set ? '••••••••' : 'Enter client secret'}
                value={graphSecret} onChange={(e) => setGraphSecret(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Mailbox Email</label>
              <input className={inputCls} placeholder="careers@yourdomain.com"
                value={graphMailbox} onChange={(e) => setGraphMailbox(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Folder</label>
              <input className={inputCls} placeholder="Inbox"
                value={graphFolder} onChange={(e) => setGraphFolder(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Subject Keywords
                <span className="ml-1 font-normal text-gray-400">(comma-separated; leave blank for all)</span>
              </label>
              <input className={inputCls} placeholder="resume,cv,application"
                value={graphKeywords} onChange={(e) => setGraphKeywords(e.target.value)} />
            </div>
          </div>

          {/* Date range filter */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Fetch Date Range</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">(leave blank to fetch all)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {[
                { label: 'Last 7 days', days: 7 },
                { label: 'Last 14 days', days: 14 },
                { label: 'Last 30 days', days: 30 },
                { label: 'All', days: null },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => applyDatePreset(days)}
                  className="text-xs px-3 py-1 rounded-full border border-[#534AB7]/40 text-[#534AB7] dark:text-[#AFA9EC] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">From date</label>
                <input type="date" className={inputCls}
                  value={graphFromDate} onChange={(e) => setGraphFromDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">To date</label>
                <input type="date" className={inputCls}
                  value={graphToDate} onChange={(e) => setGraphToDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => saveGraphMut.mutate()}
              disabled={saveGraphMut.isPending || !graphClientId.trim() || !graphTenantId.trim() || !graphMailbox.trim()}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {saveGraphMut.isPending ? 'Saving…' : 'Save Settings'}
            </button>
            <button
              onClick={handleTestGraph}
              disabled={graphTesting}
              className="border border-[#534AB7] text-[#534AB7] dark:text-[#AFA9EC] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {graphTesting ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              onClick={handleFetchNow}
              disabled={graphFetching || graphActive || !graphSettings?.configured}
              className="border border-[#1D9E75] text-[#1D9E75] hover:bg-[#E1F5EE] dark:hover:bg-[#0a2e22] disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {graphFetching ? 'Triggering…' : 'Fetch Now'}
            </button>
            {graphSettings?.configured && (
              <button
                onClick={handleStopFetch}
                disabled={!graphActive}
                className="border border-[#E24B4A] text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-red-950/30 disabled:opacity-50 font-semibold rounded-lg px-4 py-2 text-sm transition-colors flex items-center gap-1.5"
                title="Stop the current email fetch cycle (manual or automatic)"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop Fetch
              </button>
            )}
            {graphSaveMsg && <span className="text-xs text-[#1D9E75] font-medium">{graphSaveMsg}</span>}
            {graphFetchMsg && <span className="text-xs text-[#1D9E75] font-medium">{graphFetchMsg}</span>}
            {stopMsg && <span className="text-xs text-[#E24B4A] font-medium">{stopMsg}</span>}
            {graphTestResult && (
              <span className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${
                graphTestResult.ok
                  ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
                  : 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]'
              }`}>
                {graphTestResult.ok ? `✓ ${graphTestResult.message}` : `✗ ${graphTestResult.error}`}
              </span>
            )}
          </div>

          <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p className="font-medium text-gray-600 dark:text-gray-300">Azure App Registration (one-time setup):</p>
            <p>1. <strong>portal.azure.com → App registrations → New registration</strong></p>
            <p>2. API permissions → Microsoft Graph → Application → <strong>Mail.Read</strong> → Grant admin consent</p>
            <p>3. Certificates &amp; Secrets → New client secret → copy the <strong>Value</strong></p>
            <p>4. Copy <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> from app overview</p>
          </div>
        </div>
      )}

      {/* ── Ingestion Method Selector (admin only) ──────────────── */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="mb-3">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Ingestion Method</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Choose which method the system uses to poll for incoming resume emails.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { value: 'disabled', label: 'Disabled', desc: 'No polling', icon: '⏹', color: 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400' },
              { value: 'auto',     label: 'Auto',     desc: 'Graph if set, else IMAP', icon: '⚡', color: 'border-[#534AB7] text-[#534AB7] dark:text-[#AFA9EC]' },
              { value: 'imap',    label: 'IMAP',      desc: 'Force IMAP only', icon: '📧', color: 'border-[#1D9E75] text-[#1D9E75]' },
              { value: 'graph',   label: 'Microsoft Graph', desc: 'Force Graph API only', icon: '☁', color: 'border-[#0078D4] text-[#0078D4]' },
            ] as { value: IngestionMethod; label: string; desc: string; icon: string; color: string }[]).map(({ value, label, desc, icon, color }) => {
              const active = selectedMethod === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedMethod(value)}
                  className={`flex flex-col items-start gap-1 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                    active
                      ? `${color} bg-gray-50 dark:bg-gray-800 shadow-sm`
                      : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <span className="text-lg leading-none">{icon}</span>
                  <span className="text-sm font-semibold leading-tight">{label}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{desc}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => saveMethodMut.mutate(selectedMethod)}
              disabled={saveMethodMut.isPending || selectedMethod === ingestionMethodData?.method}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {saveMethodMut.isPending ? 'Saving…' : 'Apply'}
            </button>
            {methodSaveMsg && <span className="text-xs text-[#1D9E75] font-medium">{methodSaveMsg}</span>}
            {selectedMethod === 'disabled' && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Ingestion will stop on the next poll cycle.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Pipeline Status Card ────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Email Ingestion Pipeline</h2>
            {config?.method === 'graph' && (
              <p className="text-xs text-[#534AB7] dark:text-[#AFA9EC] mt-0.5 font-medium">via Microsoft Graph API</p>
            )}
            {config?.method === 'imap' && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">via IMAP</p>
            )}
          </div>
          {!configLoading && config && (
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              config.enabled
                ? 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
                : 'bg-[#F3F4F6] text-[#374151] border-[#D1D5DB]'
            }`}>
              {config.enabled ? 'Active' : 'Inactive — configure above'}
            </span>
          )}
        </div>

        {configLoading && <p className="text-sm text-gray-400">Loading…</p>}

        {config && (
          <>
            {/* Connection info */}
            {config.enabled && config.method === 'graph' && (
              <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400 mb-5">
                <span>
                  <span className="text-gray-400 dark:text-gray-500 mr-1">Mailbox</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{config.host}</span>
                </span>
                <span>
                  <span className="text-gray-400 dark:text-gray-500 mr-1">Poll interval</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{config.poll_interval}s</span>
                </span>
              </div>
            )}
            {config.enabled && config.method === 'imap' && (
              <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400 mb-5">
                <span>
                  <span className="text-gray-400 dark:text-gray-500 mr-1">Host</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{config.host}</span>
                </span>
                <span>
                  <span className="text-gray-400 dark:text-gray-500 mr-1">Poll interval</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{config.poll_interval}s</span>
                </span>
              </div>
            )}

            {!config.enabled && (
              <div className="bg-[#FFF8E7] border border-[#EF9F27] rounded-lg px-4 py-3 text-sm text-[#633806] mb-5">
                {isAdmin
                  ? 'Configure Microsoft Graph API (recommended) or IMAP settings above to enable automatic resume ingestion.'
                  : 'Email ingestion is not configured. Ask an admin to set up the connection.'}
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total Received', value: config.stats.total, color: 'text-gray-700 dark:text-gray-200' },
                { label: 'Processed', value: config.stats.processed, color: 'text-[#085041]' },
                { label: 'Failed', value: config.stats.failed, color: 'text-[#791F1F]' },
                { label: 'No Attachment', value: config.stats.no_attachment, color: 'text-[#633806]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── How It Works ──────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">How It Works</h3>
        <ol className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          {[
            'Candidates email their resume PDF/DOCX to your configured inbox.',
            'The system polls the inbox every poll interval and picks up unseen emails.',
            'PDF/DOCX attachments are extracted, parsed, and segmented automatically.',
            'To route an application to a specific job role, candidates include [JOB-42] in the subject line.',
            'Duplicate resumes are detected via SimHash and skipped.',
            'After parsing, LinkedIn/GitHub links in the email body are extracted and stored on the candidate.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-[#EEEDFE] text-[#534AB7] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* ── Email Log ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
            Email Log
            {log && <span className="ml-2 text-xs text-gray-400 font-normal">({log.total} total)</span>}
          </h3>
          <div className="flex items-center gap-2">
            <select
              className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as FilterStatus); setPage(1) }}
            >
              <option value="">All statuses</option>
              <option value="processed">Processed</option>
              <option value="failed">Failed</option>
              <option value="no_attachment">No Attachment</option>
              <option value="new">Pending</option>
              <option value="keyword_filtered">Keyword Filtered</option>
            </select>
            {isAdmin && (
              <button
                onClick={() => setConfirmClear(statusFilter || 'all')}
                disabled={clearMut.isPending || !log?.total}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E24B4A]/50 text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors font-medium"
              >
                Clear {statusFilter ? STATUS_LABELS[statusFilter] : 'All'}
              </button>
            )}
          </div>
        </div>

        {/* Clear confirmation */}
        {confirmClear !== null && (
          <div className="mb-4 bg-[#FCEBEB] dark:bg-red-950/30 border border-[#E24B4A]/40 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-[#791F1F] dark:text-red-300">
              Delete {confirmClear === 'all' ? 'all' : STATUS_LABELS[confirmClear]?.toLowerCase() ?? confirmClear} email log entries? This cannot be undone.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => clearMut.mutate(confirmClear === 'all' ? undefined : confirmClear)}
                disabled={clearMut.isPending}
                className="text-xs px-3 py-1.5 bg-[#E24B4A] text-white rounded-lg font-semibold hover:bg-[#c73c3b] disabled:opacity-50"
              >
                {clearMut.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmClear(null)}
                className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {clearMsg && (
          <p className="mb-3 text-xs text-[#1D9E75] font-medium">{clearMsg}</p>
        )}

        {logLoading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}

        {log && log.items.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">No emails received yet.</p>
        )}

        {log && log.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2 pr-4">From</th>
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2 pr-4">Subject</th>
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2 pr-4">Job Role</th>
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2 pr-4">Attachments</th>
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2 pr-4">Status</th>
                    <th className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 pb-2">Received</th>
                    {isAdmin && <th className="pb-2 w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {log.items.map((email: InboundEmailItem) => (
                    <tr key={email.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 max-w-[180px] truncate">
                        {email.sender_email ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400 max-w-[220px]">
                        <span className="truncate block" title={email.subject ?? ''}>
                          {email.subject ?? <span className="text-gray-400">(no subject)</span>}
                        </span>
                        {email.status === 'failed' && email.error_message && (
                          <span className="text-[11px] text-[#E24B4A] truncate block" title={email.error_message}>
                            {email.error_message}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {email.job_title ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-[#EEEDFE] text-[#3C3489] border border-[#AFA9EC]">
                            {email.job_title}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-center">
                        <span className={`text-sm font-semibold ${
                          email.attachment_count > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'
                        }`}>
                          {email.attachment_count}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          STATUS_STYLES[email.status] ?? STATUS_STYLES.new
                        }`}>
                          {STATUS_LABELS[email.status] ?? email.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(email.received_at.endsWith('Z') ? email.received_at : email.received_at + 'Z').toLocaleString()}
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 pl-1">
                          <div className="flex gap-1">
                            {/* Retry / re-ingest */}
                            <button
                              onClick={() => retrySingleMut.mutate(email.id)}
                              disabled={retrySingleMut.isPending}
                              title="Retry — reset this email so it gets re-ingested on next fetch"
                              className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-[#534AB7] hover:bg-[#F4F3FF] dark:hover:bg-[#2A265F] transition-colors disabled:opacity-40"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            {/* Hard delete */}
                            <button
                              onClick={() => deleteSingleMut.mutate(email.id)}
                              disabled={deleteSingleMut.isPending}
                              title="Hard delete — permanently removes this log entry"
                              className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {log.pages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                <span className="text-xs text-gray-400">
                  Page {log.page} of {log.pages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(log.pages, p + 1))}
                    disabled={page === log.pages}
                    className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
