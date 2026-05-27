import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import type { QueuedFile, DetectedSection } from '../store/useAppStore'
import { uploadResume, getResumes, deleteResume, deleteAllResumes, archiveResume, runEvaluation, getJobRoles, getEvaluationStatus, reparseAllCandidates } from '../api/client'
import type { UploadResponse, JobRole, ParseSettings, EvaluationStatus } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'



const SECTION_COLORS: Record<string, string> = {
  summary: '#534AB7',
  skills: '#1D9E75',
  projects: '#EF9F27',
  education: '#E24B4A',
  experience: '#3B82F6',
  certifications: '#8B5CF6',
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export default function Upload() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { uploadQueue: queue, setUploadQueue: setQueue, setJobRole } = useAppStore()
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── Run Evaluation ─────────────────────────────────────────────────────────
  const [evalRoleId, setEvalRoleId] = useState<number | ''>('')
  const [evalMsg, setEvalMsg] = useState<string | null>(null)
  const [evalJobRoleId, setEvalJobRoleId] = useState<number | null>(null)
  const { data: jobRoles = [] } = useQuery<JobRole[]>({
    queryKey: ['jobRoles'],
    queryFn: getJobRoles,
  })

  const { data: evalStatus } = useQuery<EvaluationStatus>({
    queryKey: ['evalStatus', evalJobRoleId],
    queryFn: () => getEvaluationStatus(evalJobRoleId!),
    enabled: evalJobRoleId != null,
    refetchInterval: (query) => query.state.data?.in_progress ? 3000 : false,
  })

  const runEvalMut = useMutation({
    mutationFn: () => runEvaluation(Number(evalRoleId)),
    onSuccess: (data) => {
      if (data.queued_count === 0) {
        setEvalMsg('No resumes matched the job role filters. Check experience level / min years settings.')
        return
      }
      setEvalJobRoleId(Number(evalRoleId))
      setJobRole(Number(evalRoleId))
      queryClient.invalidateQueries({ queryKey: ['results'] })
    },
    onError: () => {
      setEvalMsg('Failed to start evaluation. Check backend logs.')
    },
  })

  // ── Inbound Email History ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<ParseSettings>({
    ocrFallback: true,
    stripHeaders: true,
    detectTables: false,
    multilingualNlp: false,
  })

  // ── Persistence: Fetch stored resumes ──────────────────────────────────────
  const { data: storedResumes, isLoading: isLoadingStored } = useQuery({
    queryKey: ['resumes'],
    queryFn: getResumes,
  })

  const [reparseMsg, setReparseMsg] = useState<string | null>(null)
  const [resumeSearch, setResumeSearch] = useState('')
  const reparseAllMut = useMutation({
    mutationFn: reparseAllCandidates,
    onSuccess: (data) => {
      setReparseMsg(`Re-parsed ${data.total} candidates — ${data.updated} name(s) updated.`)
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      setTimeout(() => setReparseMsg(null), 5000)
    },
    onError: () => setReparseMsg('Re-parse failed.'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteResume,
    onMutate: async (resumeId: number) => {
      await queryClient.cancelQueries({ queryKey: ['resumes'] })
      const prev = queryClient.getQueryData(['resumes'])
      queryClient.setQueryData(['resumes'], (old: any) =>
        Array.isArray(old) ? old.filter((r: any) => r.resume_id !== resumeId) : old
      )
      return { prev }
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) queryClient.setQueryData(['resumes'], context.prev)
      alert('Failed to delete resume. It might be linked to other records.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
  })

  const deleteAllResumesMutation = useMutation({
    mutationFn: deleteAllResumes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
    onError: () => {
      alert('Failed to delete all resumes.')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: archiveResume,
    onMutate: async (resumeId: number) => {
      await queryClient.cancelQueries({ queryKey: ['resumes'] })
      const prev = queryClient.getQueryData(['resumes'])
      queryClient.setQueryData(['resumes'], (old: any) =>
        Array.isArray(old) ? old.filter((r: any) => r.resume_id !== resumeId) : old
      )
      return { prev }
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) queryClient.setQueryData(['resumes'], context.prev)
      alert('Failed to archive resume.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
    },
  })

  // Refs for folder / multi-file bulk pickers
  const folderInputRef = useRef<HTMLInputElement>(null)


  // Removed nameInputs and emailInputs since auto-upload uses file data directly
  const sseRefs = useRef<Record<number, EventSource>>({})

  const uploadMut = useMutation({
    mutationFn: ({ file, name, email }: { file: File; name: string; email: string }) =>
      uploadResume(file, name, email, settings),
    onSuccess: (res: UploadResponse, variables) => {
      const latestQueue = useAppStore.getState().uploadQueue
      const idx = latestQueue.findIndex((q) => q.file === variables.file)
      if (idx === -1) return
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      updateQueue(idx, {
        resumeId: res.resume_id,
        candidateEmail: res.candidate_email ?? '',
        candidateName: res.candidate_name,
        stage: 'Upload complete',
        progress: 30,
      })
      subscribeSse(res.resume_id, idx)
    },
    onError: (err: any, variables) => {
      const latestQueue = useAppStore.getState().uploadQueue
      const idx = latestQueue.findIndex((q) => q.file === variables.file)
      // Extract readable message from the server response
      const serverMsg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        'Upload failed'
      const displayMsg = typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg)
      setUploadError(displayMsg)
      if (idx !== -1) updateQueue(idx, { status: 'error', stage: displayMsg.slice(0, 60), progress: 0 })
    },
  })

  function updateQueue(idx: number, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  function removeFromQueue(idx: number) {
    setQueue((prev) => {
      const item = prev[idx]
      if (item?.resumeId && sseRefs.current[item.resumeId]) {
        sseRefs.current[item.resumeId].close()
        delete sseRefs.current[item.resumeId]
      }
      return prev.filter((_, i) => i !== idx)
    })
    setActiveIdx((prev) => {
      if (prev === null) return null
      if (prev === idx) return null
      if (prev > idx) return prev - 1
      return prev
    })
  }

  function subscribeSse(resumeId: number, idx: number) {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const token = localStorage.getItem('token')
    const es = new EventSource(
      `${baseUrl}/upload/${resumeId}/progress?token=${encodeURIComponent(token ?? '')}`
    )
    sseRefs.current[resumeId] = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          pct: number
          stage: string
          sections?: DetectedSection[]
        }
        // "waiting" means the progress store is empty (different worker process)
        // — ignore it so we don't regress progress back to 0
        if (data.stage === 'waiting') return
        const isDone = data.stage === 'done' || data.pct >= 100
        updateQueue(idx, {
          progress: data.pct,
          stage: data.stage,
          status: isDone ? 'done' : 'parsing',
          sections: data.sections,
        })
        if (isDone) {
          es.close()
        }
      } catch (_) {
        // ignore parse errors
      }
    }
    es.onerror = () => {
      // subscribeSse is only called after a successful 201 upload response.
      // SSE failure means progress tracking was lost (e.g. different worker),
      // but the file was already parsed — mark as done, not error.
      setQueue((prev) => {
        const item = prev[idx]
        if (!item || item.status === 'done') return prev
        return prev.map((it, i) =>
          i === idx ? { ...it, status: 'done', stage: 'Processed', progress: 100 } : it
        )
      })
      es.close()
    }
  }

  useEffect(() => {
    return () => {
      Object.values(sseRefs.current).forEach((es) => es.close())
    }
  }, [])

  function handleFiles(files: File[]) {
    const startIdx = queue.length
    const newItems: QueuedFile[] = files.map((f) => ({
      file: f,
      candidateName: f.name.replace(/\.[^.]+$/, ''),
      candidateEmail: '',
      progress: 5,
      stage: 'Uploading…',
      status: 'parsing',
    }))
    setQueue((prev) => [...prev, ...newItems])
    setActiveIdx(startIdx)

    // Automatically trigger uploads
    files.forEach((f) => {
      uploadMut.mutate({
        file: f,
        name: f.name.replace(/\.[^.]+$/, ''),
        email: ''
      })
    })
  }

  const activeSections = activeIdx !== null ? queue[activeIdx]?.sections ?? [] : []

  function toggleSetting(key: keyof ParseSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function isDocx(filename: string) {
    return filename.endsWith('.docx') || filename.endsWith('.doc')
  }

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">

        {/* Manual Resume Upload */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Manual Resume Upload</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Upload files or folders from your local machine to parse and extract resume details.
          </p>
          <UploadZone
            onFiles={handleFiles}
            onFolderClick={() => folderInputRef.current?.click()}
          />
        </div>

        {/* Error banner */}
        {uploadError && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-500 text-lg shrink-0">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-0.5">Upload Error</p>
              <p className="text-xs text-red-600 dark:text-red-400 break-all">{uploadError}</p>
            </div>
            <button
              onClick={() => setUploadError(null)}
              className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0"
            >×</button>
          </div>
        )}

        {/* Upload queue */}
        {queue.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Upload Queue</h2>
            <ul className="space-y-3">
              {queue.map((item, idx) => (
                <li
                  key={idx}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    activeIdx === idx
                      ? 'border-[#534AB7] bg-[#EEEDFE]/30 dark:bg-[#2d2a5a]/30'
                      : 'border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                  onClick={() => setActiveIdx(idx)}
                >
                  <div className="flex items-start gap-3">
                    {/* File icon */}
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#EEEDFE] dark:bg-[#2d2a5a] shrink-0">
                      <span className="text-[9px] font-bold text-[#534AB7]">
                        {isDocx(item.file.name) ? 'DOC' : 'PDF'}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.file.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusBadge status={item.status} />
                          {/* Remove button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeFromQueue(idx)
                            }}
                            title="Remove from queue"
                            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-sm leading-none"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {item.progress > 0 && (
                        <>
                          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
                            <span>{item.stage}</span>
                            <span>{item.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-1.5 rounded-full transition-all duration-500"
                              style={{
                                width: `${item.progress}%`,
                                backgroundColor:
                                  item.status === 'error'
                                    ? '#E24B4A'
                                    : item.status === 'done'
                                    ? '#1D9E75'
                                    : '#534AB7',
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Hidden folder input (triggered from UploadZone) */}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          accept=".pdf,.docx,.doc"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter((f) =>
              /\.(pdf|docx|doc)$/i.test(f.name)
            )
            if (files.length) handleFiles(files)
            if (folderInputRef.current) folderInputRef.current.value = ''
          }}
        />

        {/* ── Run Evaluation ────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Run Evaluation</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Score all uploaded resumes against a job role. Results appear in the Leaderboard.
          </p>
          <div className="flex gap-2">
            <select
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
              value={evalRoleId}
              onChange={(e) => { setEvalRoleId(e.target.value ? Number(e.target.value) : ''); setEvalMsg(null) }}
            >
              <option value="">Select a job role…</option>
              {(jobRoles as JobRole[]).map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <button
              onClick={() => { setEvalMsg(null); runEvalMut.mutate() }}
              disabled={runEvalMut.isPending || !evalRoleId}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors shrink-0"
            >
              {runEvalMut.isPending ? 'Queuing…' : 'Run'}
            </button>
          </div>
          {evalMsg && (
            <p className="text-xs text-[#791F1F] mt-2">{evalMsg}</p>
          )}
          {evalStatus && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {evalStatus.in_progress
                    ? <span className="text-[#534AB7] font-medium animate-pulse">Evaluating…</span>
                    : <span className="text-[#1D9E75] font-medium">Evaluation complete</span>}
                </span>
                <span>{evalStatus.scored}/{evalStatus.total} scored</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{
                    width: evalStatus.total > 0 ? `${Math.round((evalStatus.scored / evalStatus.total) * 100)}%` : '0%',
                    backgroundColor: evalStatus.in_progress ? '#534AB7' : '#1D9E75',
                  }}
                />
              </div>
              <div className="flex gap-3 text-[10px] text-gray-400">
                {evalStatus.queued > 0 && <span>{evalStatus.queued} queued</span>}
                {evalStatus.filtered > 0 && <span>{evalStatus.filtered} filtered</span>}
                {evalStatus.error > 0 && <span className="text-red-400">{evalStatus.error} error{evalStatus.error !== 1 ? 's' : ''}</span>}
                {!evalStatus.in_progress && (
                  <button
                    onClick={() => navigate('/leaderboard')}
                    className="ml-auto text-[#534AB7] hover:underline font-medium"
                  >
                    View results →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Bulk CSV / Excel Import (disabled) ─────────────────────────── */}
        {/* <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Bulk Candidate Import</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Import candidate metadata from a CSV or Excel file. Columns: name, email, phone, linkedin_url, github_url, portfolio_url, current_title, experience_level
          </p>
          ... (CSV/Excel import UI hidden)
        </div> */}

        {/* ── Inbound Email History (hidden — available in Email Config page) */}
        {/* <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Email Ingestion History</h2>
          ...
        </div> */}

        {/* ── Stored Resumes: Database Persistence ────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-[#534AB7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9l-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Evaluated Resumes
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={resumeSearch}
                  onChange={(e) => setResumeSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="pl-8 pr-7 py-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 w-44 placeholder-gray-400"
                />
                {resumeSearch && (
                  <button onClick={() => setResumeSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>
                )}
              </div>
              <span className="text-xs text-gray-400">{storedResumes?.length || 0} Total</span>
              <button
                onClick={() => reparseAllMut.mutate()}
                disabled={reparseAllMut.isPending}
                title="Re-extract names and graduation years from all stored resumes using the latest parser"
                className="text-xs px-2 py-1 rounded border border-[#534AB7]/30 text-[#534AB7] hover:bg-[#F4F3FF] disabled:opacity-50 transition-colors"
              >
                {reparseAllMut.isPending ? 'Parsing…' : '↺ Re-parse Names'}
              </button>
              {storedResumes && storedResumes.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to permanently delete ALL resumes and all evaluation data? This cannot be undone.')) {
                      deleteAllResumesMutation.mutate()
                    }
                  }}
                  disabled={deleteAllResumesMutation.isPending}
                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  title="Permanently delete all resumes and their evaluation data"
                >
                  {deleteAllResumesMutation.isPending ? 'Deleting all...' : '🗑 Delete All'}
                </button>
              )}
              {reparseMsg && <span className="text-xs text-green-600">{reparseMsg}</span>}
            </div>
          </div>

          {isLoadingStored ? (
            <div className="py-12 text-center text-gray-400 text-sm">Loading stored resumes...</div>
          ) : !storedResumes || storedResumes.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm border-2 border-dashed border-gray-50 dark:border-gray-800 rounded-lg">
              No resumes found in the database.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {storedResumes.filter((r) => {
                if (!resumeSearch) return true
                const q = resumeSearch.toLowerCase()
                return (r.candidate_name?.toLowerCase().includes(q) || r.candidate_email?.toLowerCase().includes(q))
              }).map((resume) => (
                <div
                  key={resume.resume_id}
                  className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-[#534AB7]/30 transition-all flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded bg-[#F4F3FF] dark:bg-[#2A265F] flex items-center justify-center shrink-0">
                      <span className="text-[#534AB7] font-bold text-xs">{getInitials(resume.candidate_name)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {resume.candidate_name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {resume.candidate_email || 'No email'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {/* Soft delete / Archive */}
                    <button
                      onClick={() => archiveMutation.mutate(resume.resume_id)}
                      disabled={archiveMutation.isPending}
                      className="p-2 text-gray-300 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
                      title="Archive (soft delete) — hides from pool, data preserved"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </button>
                    {/* Hard delete */}
                    <button
                      onClick={() => {
                        if (confirm('Permanently delete this resume and all its evaluation data? This cannot be undone.')) {
                          deleteMutation.mutate(resume.resume_id)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Hard delete — permanently removes all data"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel ────────────────────────────────────────── */}
      <aside className="w-72 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-y-auto p-4 gap-4">
        {/* Section Detector */}
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Section Detector</h3>
          {activeSections.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {activeIdx === null
                ? 'Select a file to see detected sections.'
                : 'Sections will appear after parsing completes.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {activeSections.map((sec, i) => {
                const color = SECTION_COLORS[sec.label.toLowerCase()] ?? '#6B7280'
                return (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize flex-1">
                      {sec.label}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      L{sec.line_start}–{sec.line_end}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <hr className="border-gray-100 dark:border-gray-700" />

        {/* Parse Settings */}
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Parse Settings</h3>
          <ul className="space-y-2.5">
            {(
              [
                { key: 'ocrFallback', label: 'OCR fallback', desc: 'Use OCR for scanned PDFs' },
                { key: 'stripHeaders', label: 'Strip headers/footers', desc: 'Remove page margins text' },
                { key: 'detectTables', label: 'Detect tables', desc: 'Extract structured tables' },
                { key: 'multilingualNlp', label: 'Multilingual NLP', desc: 'Support non-English resumes' },
              ] as const
            ).map(({ key, label, desc }) => (
              <li key={key} className="flex items-start gap-2.5">
                <button
                  role="switch"
                  aria-checked={settings[key]}
                  onClick={() => toggleSetting(key)}
                  className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${
                    settings[key] ? 'bg-[#534AB7]' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      settings[key] ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Active file info */}
        {activeIdx !== null && queue[activeIdx] && (
          <>
            <hr className="border-gray-100 dark:border-gray-700" />
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2 text-sm">Selected File</h3>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0">
                  <span className="text-xs text-white font-bold">
                    {getInitials(queue[activeIdx].candidateName || queue[activeIdx].file.name)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                    {queue[activeIdx].candidateName || queue[activeIdx].file.name}
                  </p>
                  {queue[activeIdx].candidateEmail && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{queue[activeIdx].candidateEmail}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Size: {(queue[activeIdx].file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
