import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useInfiniteQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import {
  getResults,
  deleteResult,
  deleteAllResults,
  getJobRoles,
  setIntakePause,
  autoApplyShortlist,
  bulkShortlist,
  bulkDelete,
  sendNextStepsEmail,
  updateCandidateStage,
  bulkSendNextSteps,
  downloadResultsCsv,
  reclassifyExperienceLevels,
  getResultsSummary,
  pauseEvaluation,
  resumeEvaluation,
  getEvaluationStatus
} from '../api/client'
import type { CandidateResult, CandidateStage, JobRole, ShortlistStatus } from '../api/client'
import { useAppStore } from '../store/useAppStore'

import SummaryCards from '../components/Leaderboard/SummaryCards'
import FilterControls from '../components/Leaderboard/FilterControls'
import CandidateTable from '../components/Leaderboard/CandidateTable'

type SortKey = 'total_score' | 'candidate_name' | 'skills_matched' | 'years_experience'

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
  const [blindMode, setBlindMode] = useState(() => {
    try { return localStorage.getItem('lb-blind-mode') === 'true' } catch { return false }
  })

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sortKey, sortDir }))
  }, [sortKey, sortDir])



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
  const [scoreFrom, setScoreFrom] = useState<number | ''>('')
  const [scoreTo, setScoreTo] = useState<number | ''>('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const PAGE_SIZE = 50

  useEffect(() => {
    const mainEl = document.querySelector('main')
    if (mainEl) {
      mainEl.scrollTop = 0
    }
  }, [selectedJobRoleId, nameSearch])
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['results', selectedJobRoleId, nameSearch],
    queryFn: ({ pageParam = 1 }) =>
      getResults({
        job_role_id: selectedJobRoleId ?? undefined,
        sort: 'total_score',
        order: 'desc',
        limit: PAGE_SIZE,
        page: pageParam as number,
        search: nameSearch.trim() || undefined,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const currentCount = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (currentCount >= lastPage.total) return undefined
      return allPages.length + 1
    },
    initialPageParam: 1,
    staleTime: 0,
    refetchInterval: 3000,
  })

  // Trigger next page loading on scroll near bottom of main container
  useEffect(() => {
    const mainEl = document.querySelector('main')
    if (!mainEl) return

    const handleScroll = () => {
      const threshold = 200 // pixels from bottom
      const isNearBottom = mainEl.scrollHeight - mainEl.scrollTop - mainEl.clientHeight < threshold
      
      if (isNearBottom && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }

    mainEl.addEventListener('scroll', handleScroll)
    return () => mainEl.removeEventListener('scroll', handleScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const { data: summary, isFetching: summaryFetching } = useQuery({
    queryKey: ['results-summary', selectedJobRoleId],
    queryFn: () => getResultsSummary(selectedJobRoleId ?? undefined),
    staleTime: 0,
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

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

  const _autoShortlistMut = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
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

  const [_reclassifyMsg, _setReclassifyMsg] = useState<string | null>(null)
  const _reclassifyMut = useMutation({
    mutationFn: reclassifyExperienceLevels,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      _setReclassifyMsg(`Reclassified ${res.updated} of ${res.total} candidates`)
      setTimeout(() => _setReclassifyMsg(null), 5000)
    },
    onError: () => { _setReclassifyMsg('Reclassification failed'); setTimeout(() => _setReclassifyMsg(null), 4000) },
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
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
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
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
    onError: () => {
      alert('Failed to clear results.')
      queryClient.invalidateQueries({ queryKey: ['results'] })
    },
  })

  const rawItems = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data?.pages])
  const baseItems = useMemo(() => {
    let arr = rawItems
    if (scoreRangeFilter) {
      arr = arr.filter((r) => r.total_score >= scoreRangeFilter.min && r.total_score < scoreRangeFilter.max + 10)
    }
    if (scoreFrom !== '') {
      arr = arr.filter((r) => r.total_score >= Number(scoreFrom))
    }
    if (scoreTo !== '') {
      arr = arr.filter((r) => r.total_score <= Number(scoreTo))
    }
    if (gradYearFrom !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year >= Number(gradYearFrom))
    }
    if (gradYearTo !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year <= Number(gradYearTo))
    }
    if (filterStatus) {
      if (filterStatus === 'review') {
        arr = arr.filter((r) => r.status === 'review' || (r.status === 'pending' && r.filter_stage === 'llm_scored'))
      } else {
        arr = arr.filter((r) => r.status === filterStatus)
      }
    }
    if (filterLevel) {
      arr = arr.filter((r) => (r.candidate_experience_level ?? 'entry') === filterLevel)
    }
    return arr
  }, [rawItems, scoreRangeFilter, scoreFrom, scoreTo, gradYearFrom, gradYearTo, filterStatus, filterLevel])

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

  const totalEvaluated = summary?.total ?? data?.pages[0]?.total ?? items.length
  const avgScore = summary ? Math.round(summary.avg_score) : null
  const shortlisted = summary?.shortlisted ?? 0
  const needsReview = summary?.needs_review ?? 0
  const pendingCount = summary?.pending ?? 0
  const tfidfFiltered = summary?.tfidf_filtered ?? 0
  const experienceFiltered = summary?.experience_filtered ?? 0
  const autoRejected = tfidfFiltered + experienceFiltered
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
  }

  // Satisfy noUnusedLocals for temporarily disabled UI controls/mutations
  if (false as boolean) {
    console.log(toggleBlindMode, _autoShortlistMut, _reclassifyMut)
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

      {/* Summary KPI Cards */}
      <SummaryCards
        totalEvaluated={totalEvaluated}
        avgScore={avgScore}
        shortlisted={shortlisted}
        needsReview={needsReview}
        pendingCount={pendingCount}
        autoRejected={autoRejected}
        tfidfFiltered={tfidfFiltered}
        experienceFiltered={experienceFiltered}
        queuedCount={queuedCount}
        summaryFetching={summaryFetching}
        summary={summary}
        scoreRangeFilter={scoreRangeFilter}
        clearScoreFilter={clearScoreFilter}
      />

      {/* Bulk Action Bar */}
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

      {/* Filter and Action Controls */}
      <FilterControls
        nameSearch={nameSearch}
        setNameSearch={setNameSearch}
        gradYearFrom={gradYearFrom}
        setGradYearFrom={setGradYearFrom}
        gradYearTo={gradYearTo}
        setGradYearTo={setGradYearTo}
        scoreFrom={scoreFrom}
        setScoreFrom={setScoreFrom}
        scoreTo={scoreTo}
        setScoreTo={setScoreTo}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterLevel={filterLevel}
        setFilterLevel={setFilterLevel}
        sortKey={sortKey}
        setSortKey={setSortKey}
        selectedJobRoleId={selectedJobRoleId}
        evalStatus={evalStatus}
        queuedCount={queuedCount}
        isAdmin={isAdmin}
        bulkEmailMut={bulkEmailMut}
        bulkEmailMsg={bulkEmailMsg}
        deleteAllMutation={deleteAllMutation}
        pauseMut={pauseMut}
        resumeMut={resumeMut}
        exportCSV={exportCSV}
        downloadResultsCsv={downloadResultsCsv}
        refreshResults={() => {
          queryClient.resetQueries({ queryKey: ['results', selectedJobRoleId] })
          queryClient.invalidateQueries({ queryKey: ['results-summary', selectedJobRoleId] })
        }}
      />

      {/* Candidate Grid Table */}
      <CandidateTable
        items={items}
        isLoading={isLoading}
        isError={isError}
        selectedIds={selectedIds}
        toggleSelectAll={toggleSelectAll}
        toggleSelect={toggleSelect}
        blindMode={blindMode}
        maskName={maskName}
        maskEmail={maskEmail}
        isAdmin={isAdmin}
        stageMut={stageMut}
        sendEmailMut={sendEmailMut}
        emailMsg={emailMsg}
        deleteMutation={deleteMutation}
        groupByExp={false}
        page={1}
        PAGE_SIZE={PAGE_SIZE}
        sortKey={sortKey}
        sortDir={sortDir}
        toggleSort={toggleSort}
        selectedRole={selectedRole}
      />

      {/* Pagination Status / Infinite Scroll Indicator */}
      <div className="flex flex-col items-center justify-center py-4 px-1">
        {isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-sm text-[#534AB7] dark:text-[#AFA9EC] font-semibold animate-pulse">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading more candidates...
          </div>
        ) : !hasNextPage && items.length > 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            Showing all {totalEvaluated} evaluated candidates
          </p>
        ) : items.length > 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Scroll down to load more candidates (Showing {items.length} of {totalEvaluated})
          </p>
        ) : null}
      </div>
    </div>
  )
}
