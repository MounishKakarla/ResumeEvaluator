import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { getResults, deleteResult, deleteAllResults, getJobRoles, setIntakePause, autoApplyShortlist, bulkShortlist, bulkDelete, sendNextStepsEmail, updateCandidateStage, bulkSendNextSteps, downloadResultsCsv, reclassifyExperienceLevels, getResultsSummary, pauseEvaluation, resumeEvaluation, getEvaluationStatus } from '../api/client'
import type { CandidateResult, CandidateStage, JobRole, ShortlistStatus } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'

type SortKey = 'total_score' | 'candidate_name' | 'skills_matched' | 'years_experience'

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="text-lg" title="1st">🥇</span>
    )
  if (rank === 2)
    return (
      <span className="text-lg" title="2nd">🥈</span>
    )
  if (rank === 3)
    return (
      <span className="text-lg" title="3rd">🥉</span>
    )
  return (
    <span className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold flex items-center justify-center">
      {rank}
    </span>
  )
}

const _SECTION_HEADERS = new Set([
  'career objective', 'professional summary', 'work experience',
  'education background', 'educational background', 'skills summary',
  'technical skills', 'core competencies', 'key skills',
  'areas of expertise', 'summary of qualifications', 'personal information',
  'contact information', 'references available', 'about me',
  'profile summary', 'career summary', 'objective statement', 'professional profile',
])

function displayName(name: string, email: string | null | undefined): string {
  if (_SECTION_HEADERS.has(name.toLowerCase())) {
    if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return 'Unknown'
  }
  return name
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const STAGE_LABEL_MAP: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', coding: 'Coding Test',
  interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
}

function resultsToCSV(items: CandidateResult[]): string {
  const headers = [
    'Rank', 'Name', 'Email', 'Phone', 'Current Title',
    'Experience Level', 'Years Exp', 'Applied For',
    'Evaluated At', 'Score', 'Skills Matched', 'Project Match',
    'Status', 'Stage', 'Email Sent',
  ]
  const rows = items.map((item, i) => [
    i + 1,
    `"${item.candidate_name}"`,
    item.candidate_email ?? '',
    item.candidate_phone ?? '',
    `"${item.candidate_current_title ?? ''}"`,
    item.candidate_experience_level ?? '',
    item.candidate_years_experience ?? '',
    `"${item.job_role_title}"`,
    item.evaluated_at,
    item.total_score,
    `${item.skills_matched}/${item.skills_total}`,
    item.project_match_label,
    item.status,
    STAGE_LABEL_MAP[item.candidate_stage] ?? item.candidate_stage,
    item.email_sent_at ? 'Yes' : 'No',
  ])
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

export default function Leaderboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)
  const userRole = useAppStore((s) => s.role)
  const isAdmin = userRole === 'admin'

  const scoreMinParam = searchParams.get('scoreMin')
  const scoreMaxParam = searchParams.get('scoreMax')
  const scoreRangeFilter = scoreMinParam != null && scoreMaxParam != null
    ? { min: Number(scoreMinParam), max: Number(scoreMaxParam) }
    : null

  function clearScoreFilter() {
    setSearchParams((prev) => {
      prev.delete('scoreMin')
      prev.delete('scoreMax')
      return prev
    })
  }

  const [emailMsg, setEmailMsg] = useState<{ id: number; msg: string } | null>(null)

  const SESSION_KEY = 'lb-filters'
  const _ss = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') } catch { return {} } })()

  const [sortKey, setSortKey] = useState<SortKey>(_ss.sortKey ?? 'total_score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_ss.sortDir ?? 'desc')
  const [groupByExp, setGroupByExp] = useState(_ss.groupByExp ?? true)
  const [page, setPage] = useState<number>(_ss.page ?? 1)
  const [blindMode, setBlindMode] = useState(() => {
    try { return localStorage.getItem('lb-blind-mode') === 'true' } catch { return false }
  })

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sortKey, sortDir, groupByExp, page }))
  }, [sortKey, sortDir, groupByExp, page])

  const toggleBlindMode = () => {
    setBlindMode((v: boolean) => {
      const next = !v
      try { localStorage.setItem('lb-blind-mode', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  function maskName(name: string, index: number): string {
    return blindMode ? `Candidate #${index + 1}` : name
  }
  function maskEmail(email: string | null | undefined): string | null {
    if (!email) return null
    if (!blindMode) return email
    const [local] = email.split('@')
    return `${local.slice(0, 2)}***@***.***`
  }

  const [nameSearch, setNameSearch] = useState('')
  const [gradYearFrom, setGradYearFrom] = useState<number | ''>('')
  const [gradYearTo, setGradYearTo] = useState<number | ''>('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const PAGE_SIZE = 50

  const _isFirstMount = useRef(true)
  useEffect(() => {
    if (_isFirstMount.current) { _isFirstMount.current = false; return }
    setPage(1)
  }, [selectedJobRoleId])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['results', selectedJobRoleId, page],
    queryFn: () =>
      getResults({
        job_role_id: selectedJobRoleId ?? undefined,
        sort: 'total_score',
        order: 'desc',
        limit: PAGE_SIZE,
        page,
      }),
    enabled: true,
    staleTime: 0,
    refetchInterval: 3000,
  })

  // Summary stats — pulled from backend over ALL pages, not just current 50
  const { data: summary, isFetching: summaryFetching } = useQuery({
    queryKey: ['results-summary', selectedJobRoleId],
    queryFn: () => getResultsSummary(selectedJobRoleId ?? undefined),
    staleTime: 0,
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

  // Evaluation progress — for pause/resume controls
  const { data: evalStatus } = useQuery({
    queryKey: ['eval-status', selectedJobRoleId],
    queryFn: () => getEvaluationStatus(selectedJobRoleId!),
    enabled: !!selectedJobRoleId,
    staleTime: 0,
    refetchInterval: 3000,
  })

  const { data: jobRoles } = useQuery({
    queryKey: ['job-roles'],
    queryFn: getJobRoles,
  })
  const selectedRole = jobRoles?.find((r: JobRole) => r.id === selectedJobRoleId) ?? null

  const intakeMut = useMutation({
    mutationFn: (paused: boolean) => setIntakePause(selectedRole!.id, paused),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-roles'] }),
  })

  const autoShortlistMut = useMutation({
    mutationFn: () => autoApplyShortlist(selectedJobRoleId!),
    onSuccess: (res: { applied: number; total_qualifying: number }) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      alert(`Auto-shortlist applied: ${res.applied} new shortlisted (${res.total_qualifying} qualifying total).`)
    },
    onError: () => alert('Auto-shortlist failed. Make sure a min fit score is configured.'),
  })

  const bulkShortlistMut = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: ShortlistStatus }) =>
      bulkShortlist(ids, status),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setSelectedIds(new Set())
      if (res.missing.length > 0) alert(`${res.updated} updated. ${res.missing.length} not found.`)
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setSelectedIds(new Set())
    },
  })

  const sendEmailMut = useMutation({
    mutationFn: ({ evalId, force }: { evalId: number; force: boolean }) =>
      sendNextStepsEmail(evalId, force),
    onSuccess: (data, { evalId }) => {
      setEmailMsg({ id: evalId, msg: data.message })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setTimeout(() => setEmailMsg(null), 4000)
    },
    onError: (_err, { evalId }) => {
      setEmailMsg({ id: evalId, msg: 'Failed to send email' })
      setTimeout(() => setEmailMsg(null), 4000)
    },
  })

  const stageMut = useMutation({
    mutationFn: ({ candidateId, stage }: { candidateId: number; stage: CandidateStage }) =>
      updateCandidateStage(candidateId, stage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['results'] }),
  })

  const [bulkEmailMsg, setBulkEmailMsg] = useState<string | null>(null)
  const bulkEmailMut = useMutation({
    mutationFn: () => bulkSendNextSteps(selectedJobRoleId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setBulkEmailMsg(res.message)
      setTimeout(() => setBulkEmailMsg(null), 5000)
    },
    onError: () => {
      setBulkEmailMsg('Bulk email failed')
      setTimeout(() => setBulkEmailMsg(null), 4000)
    },
  })

  const [reclassifyMsg, setReclassifyMsg] = useState<string | null>(null)
  const reclassifyMut = useMutation({
    mutationFn: reclassifyExperienceLevels,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setReclassifyMsg(`Reclassified ${res.updated} of ${res.total} candidates`)
      setTimeout(() => setReclassifyMsg(null), 5000)
    },
    onError: () => { setReclassifyMsg('Reclassification failed'); setTimeout(() => setReclassifyMsg(null), 4000) },
  })

  const pauseMut = useMutation({
    mutationFn: () => pauseEvaluation(selectedJobRoleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-status', selectedJobRoleId] })
    },
  })

  const resumeMut = useMutation({
    mutationFn: () => resumeEvaluation(selectedJobRoleId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['eval-status', selectedJobRoleId] })
      queryClient.invalidateQueries({ queryKey: ['results-summary', selectedJobRoleId] })
      if (res.queued_count === 0) alert('No queued evaluations to resume.')
    },
  })

  const STAGE_COLORS: Record<CandidateStage, string> = {
    applied:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
    screening: 'bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] border-[#AFA9EC]',
    coding:    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
    interview: 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]',
    offer:     'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700',
    hired:     'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]',
    rejected:  'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]/50',
  }
  const STAGE_LABELS: Record<CandidateStage, string> = {
    applied: 'Applied', screening: 'Screening', coding: 'Coding Test',
    interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((r) => r.evaluation_id)))
    }
  }

  const deleteMutation = useMutation({
    mutationFn: deleteResult,
    onMutate: async (evaluationId: number) => {
      await queryClient.cancelQueries({ queryKey: ['results'] })
      const prev = queryClient.getQueriesData({ queryKey: ['results'] })
      queryClient.setQueriesData({ queryKey: ['results'] }, (old: any) => {
        if (!old?.items) return old
        return { ...old, items: old.items.filter((i: any) => i.evaluation_id !== evaluationId), total: Math.max(0, (old.total ?? old.items.length) - 1) }
      })
      return { prev }
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) {
        context.prev.forEach(([key, val]: any) => queryClient.setQueryData(key, val))
      }
      alert('Failed to delete result.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: deleteAllResults,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['results'] })
      queryClient.setQueriesData({ queryKey: ['results'] }, (old: any) =>
        old ? { ...old, items: [], total: 0 } : old
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
    },
    onError: () => {
      alert('Failed to clear results.')
      queryClient.invalidateQueries({ queryKey: ['results'] })
    },
  })

  const rawItems = data?.items ?? []
  const baseItems = useMemo(() => {
    let arr = rawItems
    if (scoreRangeFilter) {
      arr = arr.filter((r) => r.total_score >= scoreRangeFilter.min && r.total_score < scoreRangeFilter.max + 10)
    }
    if (nameSearch.trim()) {
      const q = nameSearch.toLowerCase().trim()
      arr = arr.filter(
        (r) =>
          r.candidate_name.toLowerCase().includes(q) ||
          (r.candidate_email ?? '').toLowerCase().includes(q)
      )
    }
    if (gradYearFrom !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year >= Number(gradYearFrom))
    }
    if (gradYearTo !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year <= Number(gradYearTo))
    }
    if (filterStatus) {
      arr = arr.filter((r) => r.status === filterStatus)
    }
    if (filterLevel) {
      arr = arr.filter((r) => (r.candidate_experience_level ?? 'entry') === filterLevel)
    }
    return arr
  }, [rawItems, scoreRangeFilter, nameSearch, gradYearFrom, gradYearTo, filterStatus, filterLevel])

  // Client-side sort so all columns work without backend support
  const items = useMemo(() => {
    const arr = [...baseItems]
    arr.sort((a, b) => {
      let av: string | number, bv: string | number
      switch (sortKey) {
        case 'candidate_name':
          av = displayName(a.candidate_name, a.candidate_email).toLowerCase()
          bv = displayName(b.candidate_name, b.candidate_email).toLowerCase()
          break
        case 'skills_matched':
          av = a.skills_matched; bv = b.skills_matched; break
        case 'years_experience':
          av = a.candidate_years_experience ?? 0; bv = b.candidate_years_experience ?? 0; break
        default:
          av = a.total_score; bv = b.total_score
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [baseItems, sortKey, sortDir])

  // Metric cards — use backend summary so values are stable across pages/filters
  const totalEvaluated = summary?.total ?? data?.total ?? items.length
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const avgScore = summary ? Math.round(summary.avg_score) : null
  const shortlisted = summary?.shortlisted ?? 0
  const needsReview = summary?.needs_review ?? 0
  const tfidfFiltered = summary?.tfidf_filtered ?? 0
  const experienceFiltered = summary?.experience_filtered ?? 0
  const queuedCount = summary?.queued ?? 0

  function exportCSV() {
    const csv = resultsToCSV(items)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leaderboard.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-[#534AB7] ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  return (
    <div className="p-6 space-y-5 w-full">
      {/* Auto-pause intake banner */}
      {selectedRole?.intake_paused && (
        <div className="flex items-center justify-between bg-[#FAEEDA] border border-[#EF9F27] rounded-xl px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-[#633806]">Intake paused — shortlist target reached</p>
            <p className="text-xs text-[#633806]/70 mt-0.5">
              New applications are queued. Review your shortlist and resume intake when ready.
            </p>
          </div>
          <button
            onClick={() => intakeMut.mutate(false)}
            disabled={intakeMut.isPending}
            className="ml-4 shrink-0 bg-[#EF9F27] hover:bg-[#c98112] disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-1.5 transition-colors"
          >
            {intakeMut.isPending ? 'Resuming…' : 'Resume intake'}
          </button>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Evaluated', value: totalEvaluated, color: '#534AB7', bg: '#EEEDFE', fromSummary: false },
          { label: 'Avg Score', value: avgScore !== null ? `${avgScore}` : null, color: '#1D9E75', bg: '#E1F5EE', fromSummary: true },
          { label: 'Shortlisted', value: summary ? shortlisted : null, color: '#EF9F27', bg: '#FAEEDA', fromSummary: true },
          { label: 'Needs Review', value: summary ? needsReview : null, color: '#E24B4A', bg: '#FCEBEB', fromSummary: true },
          { label: 'Keyword Filtered', value: summary ? tfidfFiltered : null, color: '#6B7280', bg: '#F3F4F6', fromSummary: true },
          { label: 'Exp. Mismatch', value: summary ? experienceFiltered : null, color: '#EA580C', bg: '#FFF7ED', fromSummary: true },
        ].map(({ label, value, color, bg, fromSummary }) => (
          <div
            key={label}
            className="rounded-xl border p-4"
            style={{ backgroundColor: bg, borderColor: color + '40' }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs font-medium" style={{ color }}>{label}</p>
              {fromSummary && summaryFetching && (
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
              )}
            </div>
            <p className="text-2xl font-bold" style={{ color }}>
              {value === null ? (
                <span className="text-base opacity-40">—</span>
              ) : value}
            </p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => { setNameSearch(e.target.value); setPage(1) }}
            placeholder="Search name or email…"
            className="pl-9 pr-7 py-2 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 w-52 placeholder-gray-400 dark:placeholder-gray-500"
          />
          {nameSearch && (
            <button
              onClick={() => setNameSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-base leading-none"
            >×</button>
          )}
        </div>

        {/* Graduation Year Range Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Grad Year</span>
          <input
            type="number"
            value={gradYearFrom}
            onChange={(e) => { setGradYearFrom(e.target.value ? Number(e.target.value) : ''); setPage(1) }}
            placeholder="From"
            className="w-20 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            value={gradYearTo}
            onChange={(e) => { setGradYearTo(e.target.value ? Number(e.target.value) : ''); setPage(1) }}
            placeholder="To"
            className="w-20 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
          />
          {(gradYearFrom !== '' || gradYearTo !== '') && (
            <button
              onClick={() => { setGradYearFrom(''); setGradYearTo('') }}
              className="text-gray-400 hover:text-red-500 text-base leading-none transition-colors"
              title="Clear year filter"
            >×</button>
          )}
        </div>

        {/* Status filter */}
        <select
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
        >
          <option value="">All Statuses</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </select>

        {/* Experience level filter */}
        <select
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
          value={filterLevel}
          onChange={(e) => { setFilterLevel(e.target.value); setPage(1) }}
        >
          <option value="">All Levels</option>
          <option value="entry">Entry Level</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid-level</option>
          <option value="senior">Senior</option>
          <option value="executive">Executive</option>
        </select>

        <select
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="total_score">Sort: Score</option>
          <option value="candidate_name">Sort: Name</option>
          <option value="skills_matched">Sort: Skills Matched</option>
          <option value="years_experience">Sort: Experience (yrs)</option>
        </select>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Group by level</span>
          <button
            onClick={() => setGroupByExp((v: boolean) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${groupByExp ? 'bg-[#534AB7]' : 'bg-gray-300 dark:bg-gray-600'}`}
            title="Toggle grouping by experience level"
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${groupByExp ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Blind mode</span>
          <button
            onClick={toggleBlindMode}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${blindMode ? 'bg-[#EF9F27]' : 'bg-gray-300 dark:bg-gray-600'}`}
            title="Hide candidate names and emails for unbiased review"
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${blindMode ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </div>

        {selectedJobRoleId && (
          <button
            onClick={() => {
              if (confirm('Auto-shortlist all candidates meeting the minimum fit score?')) {
                autoShortlistMut.mutate()
              }
            }}
            disabled={autoShortlistMut.isPending}
            className="border border-[#AFA9EC] bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] rounded-lg px-3 py-2 text-sm hover:bg-[#dddcfd] dark:hover:bg-[#3a3770] disabled:opacity-50 flex items-center gap-1"
          >
            {autoShortlistMut.isPending ? 'Applying…' : '⚡ Auto-Shortlist'}
          </button>
        )}

        {isAdmin && selectedJobRoleId && (
          <button
            onClick={() => {
              if (confirm('Send next-steps email to all shortlisted candidates who haven\'t received one yet?')) {
                bulkEmailMut.mutate()
              }
            }}
            disabled={bulkEmailMut.isPending}
            className="border border-[#1D9E75] bg-[#E1F5EE] dark:bg-[#0d3328] text-[#085041] dark:text-[#5DCAA5] rounded-lg px-3 py-2 text-sm hover:bg-[#c8ede0] dark:hover:bg-[#0f4035] disabled:opacity-50 flex items-center gap-1"
          >
            {bulkEmailMut.isPending ? 'Sending…' : '📧 Email All Shortlisted'}
          </button>
        )}
        {bulkEmailMsg && (
          <span className="text-xs text-[#1D9E75] font-medium">{bulkEmailMsg}</span>
        )}

        <button
          onClick={() => {
            if (confirm('Clear ALL results for this job role?')) {
              deleteAllMutation.mutate(selectedJobRoleId!)
            }
          }}
          className="ml-auto border border-red-100 bg-red-50 text-red-600 rounded-lg px-3 py-2 text-sm hover:bg-red-100 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Clear All
        </button>

        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['results'] })}
          className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>

        {/* Pause / Resume — media-player style toggle, always Pause or Resume */}
        {selectedJobRoleId != null && (
          <button
            onClick={() => evalStatus?.in_progress ? pauseMut.mutate() : resumeMut.mutate()}
            disabled={pauseMut.isPending || resumeMut.isPending}
            title={
              evalStatus?.in_progress
                ? 'Pause evaluation — queued resumes stay held'
                : `Resume evaluation${queuedCount > 0 ? ` — ${queuedCount} queued` : ''}`
            }
            className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 transition-colors disabled:opacity-50 ${
              evalStatus?.in_progress
                ? 'border border-amber-400 text-amber-600 dark:text-amber-400 dark:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                : 'border border-[#1D9E75] text-[#1D9E75] dark:border-[#1D9E75] hover:bg-[#E1F5EE] dark:hover:bg-[#0a3329]'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${evalStatus?.in_progress ? 'bg-amber-400 animate-pulse' : 'bg-[#1D9E75]'}`} />
            {evalStatus?.in_progress
              ? (pauseMut.isPending ? 'Pausing…' : 'Pause')
              : (resumeMut.isPending ? 'Resuming…' : 'Resume')
            }
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => reclassifyMut.mutate()}
            disabled={reclassifyMut.isPending}
            className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 disabled:opacity-50"
            title="Reclassify all candidates by years of experience"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {reclassifyMut.isPending ? 'Reclassifying…' : 'Reclassify Levels'}
          </button>
        )}
        {reclassifyMsg && <span className="text-xs text-[#534AB7] dark:text-[#AFA9EC]">{reclassifyMsg}</span>}

        <button
          onClick={exportCSV}
          className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
          title="Export current page to CSV"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>

        <button
          onClick={() => downloadResultsCsv(selectedJobRoleId, undefined)}
          className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
          title="Export all candidates with full HRIS fields (all pages)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export All (HRIS)
        </button>

      </div>

      {/* Score range drill-down banner */}
      {scoreRangeFilter && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#EEEDFE] dark:bg-[#2d2a5a] border border-[#534AB7]/30 rounded-xl text-sm">
          <span className="text-[#534AB7] font-medium">
            Showing score range: {scoreRangeFilter.min}–{scoreRangeFilter.max + 9}
          </span>
          <span className="text-[#534AB7]/60 text-xs">(from Analytics drill-down)</span>
          <button
            onClick={clearScoreFilter}
            className="ml-auto text-xs text-[#534AB7] hover:underline font-medium"
          >
            × Clear filter
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-[#EEEDFE] dark:bg-[#2d2a5a] border border-[#AFA9EC] rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-[#3C3489] dark:text-[#AFA9EC]">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2 ml-2">
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'shortlisted' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5] hover:bg-[#c8ede0] disabled:opacity-50 transition-colors"
            >
              Shortlist
            </button>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'review' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#FAEEDA] text-[#633806] border border-[#EF9F27] hover:bg-[#f5e0b8] disabled:opacity-50 transition-colors"
            >
              Needs Review
            </button>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'rejected' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#FCEBEB] text-[#791F1F] border border-[#E24B4A] hover:bg-[#f8d5d5] disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} selected results?`)) {
                  bulkDeleteMut.mutate([...selectedIds])
                }
              }}
              disabled={bulkDeleteMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-[#534AB7] dark:text-[#AFA9EC] hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading && (
          <table className="w-full text-sm animate-pulse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                {[8, 40, 100, 80, 80, 60, 60, 70, 60].map((w, i) => (
                  <th key={i} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: w }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="px-4 py-3"><div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-6" /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 shrink-0" />
                      <div className="space-y-1">
                        <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-28" />
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-36" />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-12" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-10" /></td>
                  <td className="px-4 py-3"><div className="h-5 bg-gray-100 dark:bg-gray-700 rounded-full w-16" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-12" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isError && (
          <div className="p-8 text-center text-sm text-[#791F1F]">Failed to load results.</div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">No results found.</div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600 accent-[#534AB7]"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < items.length }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-12">Rank</th>
                <th
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
                  onClick={() => toggleSort('candidate_name')}
                >
                  Candidate <SortIcon k="candidate_name" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Current Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Phone</th>
                <th
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer w-24"
                  onClick={() => toggleSort('total_score')}
                >
                  Score <SortIcon k="total_score" />
                </th>
                <th
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
                  onClick={() => toggleSort('skills_matched')}
                >
                  Skills <SortIcon k="skills_matched" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Applied For</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Evaluated At</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Stage</th>
                {isAdmin && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Email</th>}
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const EXP_ORDER = ['executive', 'senior', 'mid', 'junior', 'entry']
                const EXP_LABELS: Record<string, string> = {
                  executive: 'Executive / Lead',
                  senior: 'Senior',
                  mid: 'Mid-level',
                  junior: 'Junior',
                  entry: 'Entry Level',
                }
                const EXP_COLORS: Record<string, string> = {
                  executive: 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]',
                  senior: 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]',
                  mid: 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]',
                  junior: 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]',
                  entry: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-500',
                }

                const renderRow = (item: typeof items[0], idx: number) => (
                  <tr
                    key={item.evaluation_id}
                    className={`border-b border-gray-50 dark:border-gray-800 hover:bg-[#EEEDFE]/20 dark:hover:bg-[#2d2a5a]/20 cursor-pointer transition-colors ${selectedIds.has(item.evaluation_id) ? 'bg-[#EEEDFE]/40 dark:bg-[#2d2a5a]/40' : ''}`}
                    onClick={() => navigate(`/results/${item.evaluation_id}`)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 dark:border-gray-600 accent-[#534AB7]"
                        checked={selectedIds.has(item.evaluation_id)}
                        onChange={() => toggleSelect(item.evaluation_id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <RankBadge rank={idx + 1} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0">
                          <span className="text-xs text-white font-bold">
                            {blindMode ? `C${idx + 1}` : getInitials(displayName(item.candidate_name, item.candidate_email))}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-gray-800 dark:text-gray-100">{maskName(displayName(item.candidate_name, item.candidate_email), idx)}</p>
                            {!blindMode && item.needs_manual_review && (
                              <span
                                title="Manual review required — discrepancies detected"
                                className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]"
                              >
                                ⚠ Review
                              </span>
                            )}
                            {!blindMode && item.github_skill_gap_severity && item.github_skill_gap_severity !== 'low' && (
                              <span
                                title={
                                  item.github_skill_gap_severity === 'high'
                                    ? 'GitHub: claimed skills not evidenced in repositories (high concern)'
                                    : 'GitHub: some claimed skills unverified in repositories'
                                }
                                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                  item.github_skill_gap_severity === 'high'
                                    ? 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]'
                                    : 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]'
                                }`}
                              >
                                <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                                </svg>
                                {item.github_skill_gap_severity === 'high' ? 'GH ✗' : 'GH ~'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {maskEmail(item.candidate_email)}
                            {item.candidate_graduation_year != null && (
                              <span
                                className="ml-1.5 text-[10px] font-medium bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#534AB7] dark:text-[#AFA9EC] px-1.5 py-0.5 rounded"
                                title="Graduation year"
                              >
                                {item.candidate_graduation_year}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      {item.candidate_current_title ? (
                        <p className="text-xs text-gray-600 dark:text-gray-300 truncate" title={item.candidate_current_title}>
                          {item.candidate_current_title}
                        </p>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{item.candidate_phone ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 w-24">
                      {item.filter_stage === 'experience_filtered' ? (
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700"
                            title="Stage 0 pre-filter: candidate experience does not meet role requirements — evaluation skipped"
                          >
                            Exp. mismatch
                          </span>
                          {item.candidate_years_experience != null && (
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                              {item.candidate_years_experience.toFixed(1)} yr(s)
                            </span>
                          )}
                        </div>
                      ) : item.filter_stage === 'tfidf_filtered' ? (
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600"
                            title={`Pre-filter: keyword relevance score ${item.tfidf_score != null ? (item.tfidf_score * 100).toFixed(1) + '%' : 'n/a'} was below threshold — LLM evaluation skipped`}
                          >
                            Stage 1 filtered
                          </span>
                          {item.tfidf_score != null && (
                            <span className="text-[9px] text-gray-400 dark:text-gray-500">
                              relevance: {(item.tfidf_score * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <span
                            className="text-sm font-bold"
                            style={{ color: item.total_score >= 75 ? '#1D9E75' : item.total_score >= 50 ? '#EF9F27' : '#E24B4A' }}
                            title={`Raw score: ${item.total_score.toFixed(1)}`}
                          >
                            {Math.round(item.total_score)}
                          </span>
                          {selectedRole?.min_fit_score != null &&
                            Math.round(item.total_score) >= selectedRole.min_fit_score &&
                            item.total_score < selectedRole.min_fit_score && (
                              <span
                                className="ml-1 text-[9px] text-[#EF9F27] font-semibold align-top"
                                title={`Displays as ${Math.round(item.total_score)} but raw score ${item.total_score.toFixed(1)} is below threshold ${selectedRole.min_fit_score}`}
                              >
                                ≈
                              </span>
                            )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <div className="flex flex-wrap gap-1">
                        {(item.matched_skill_names ?? []).slice(0, 4).map((s) => (
                          <span key={s} className="text-[10px] font-medium bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] px-1.5 py-0.5 rounded-full border border-[#AFA9EC]/60">
                            {s}
                          </span>
                        ))}
                        {(item.matched_skill_names ?? []).length > 4 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1 py-0.5">
                            +{item.matched_skill_names.length - 4}
                          </span>
                        )}
                        {(item.matched_skill_names ?? []).length === 0 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.skills_matched}/{item.skills_total}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">{item.job_role_title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{item.evaluated_at ? formatDate(item.evaluated_at) : '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status as Parameters<typeof StatusBadge>[0]['status']} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {isAdmin ? (
                        <select
                          value={item.candidate_stage ?? 'applied'}
                          onChange={(e) => stageMut.mutate({ candidateId: item.candidate_id, stage: e.target.value as CandidateStage })}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded border cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-[#534AB7]/40 ${STAGE_COLORS[item.candidate_stage as CandidateStage] ?? STAGE_COLORS.applied}`}
                          disabled={stageMut.isPending}
                        >
                          {(Object.keys(STAGE_LABELS) as CandidateStage[]).map((s) => (
                            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STAGE_COLORS[item.candidate_stage as CandidateStage] ?? STAGE_COLORS.applied}`}>
                          {STAGE_LABELS[item.candidate_stage as CandidateStage] ?? 'Applied'}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {item.email_sent_at ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-[#1D9E75] font-semibold">✓ Sent</span>
                            {item.email_opened_at
                              ? <span className="text-[10px] text-[#1D9E75]" title={`Opened ${new Date(item.email_opened_at).toLocaleString()}`}>👁 Opened</span>
                              : <span className="text-[10px] text-gray-400">Not opened</span>
                            }
                            <button
                              onClick={() => sendEmailMut.mutate({ evalId: item.evaluation_id, force: true })}
                              disabled={sendEmailMut.isPending}
                              className="text-[10px] text-gray-400 hover:text-[#534AB7] disabled:opacity-50 transition-colors"
                              title="Resend next-steps email"
                            >
                              Resend
                            </button>
                            {emailMsg?.id === item.evaluation_id && (
                              <span className="text-[10px] text-[#534AB7]">{emailMsg.msg}</span>
                            )}
                          </div>
                        ) : item.candidate_email ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => sendEmailMut.mutate({ evalId: item.evaluation_id, force: false })}
                              disabled={sendEmailMut.isPending}
                              className="text-[10px] font-medium px-2 py-1 rounded border border-[#534AB7] text-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50 transition-colors whitespace-nowrap"
                              title="Send next-steps (Coding → Interview → HR) email"
                            >
                              {sendEmailMut.isPending && sendEmailMut.variables?.evalId === item.evaluation_id
                                ? 'Sending…'
                                : 'Send Email'}
                            </button>
                            {emailMsg?.id === item.evaluation_id && (
                              <span className="text-[10px] text-[#534AB7]">{emailMsg.msg}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300 dark:text-gray-600">No email</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('Delete this result?')) {
                            deleteMutation.mutate(item.evaluation_id)
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="Delete result"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )

                if (!groupByExp) {
                  return items.map((item, idx) => renderRow(item, (page - 1) * PAGE_SIZE + idx))
                }

                // Grouped view: organize by experience level in a fixed order
                const groups = EXP_ORDER.map((level) => ({
                  level,
                  rows: items.filter((r) => (r.candidate_experience_level ?? 'entry') === level),
                })).filter((g) => g.rows.length > 0)

                let globalIdx = (page - 1) * PAGE_SIZE
                return groups.flatMap(({ level, rows }) => [
                  <tr key={`group-${level}`} className="bg-gray-50 dark:bg-gray-800/60">
                    <td colSpan={isAdmin ? 13 : 12} className="px-4 py-2">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${EXP_COLORS[level]}`}>
                        {EXP_LABELS[level]}
                      </span>
                      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{rows.length} candidate{rows.length !== 1 ? 's' : ''}</span>
                    </td>
                  </tr>,
                  ...rows.map((item) => renderRow(item, globalIdx++)),
                ])
              })()}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalEvaluated)} of {totalEvaluated}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >‹ Prev</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i + 1
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i
              } else {
                p = page - 3 + i
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 text-xs rounded border transition-colors ${
                    p === page
                      ? 'bg-[#534AB7] text-white border-[#534AB7]'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >{p}</button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >Next ›</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >»</button>
          </div>
        </div>
      )}
    </div>
  )
}
