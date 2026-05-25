import { useNavigate } from 'react-router-dom'
import { useRef, useEffect } from 'react'
import StatusBadge from '../StatusBadge'


interface CandidateTableProps {
  items: any[]
  isLoading: boolean
  isError: boolean
  selectedIds: Set<number>
  toggleSelectAll: () => void
  toggleSelect: (id: number) => void
  blindMode: boolean
  maskName: (name: string, index: number) => string
  maskEmail: (email: string | null | undefined) => string | null
  isAdmin: boolean
  stageMut: any
  sendEmailMut: any
  emailMsg: { id: number; msg: string } | null
  deleteMutation: any
  groupByExp: boolean
  page: number
  PAGE_SIZE: number
  sortKey: string
  sortDir: 'asc' | 'desc'
  toggleSort: (key: any) => void
  selectedRole: any
}

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

const STAGE_COLORS: Record<string, string> = {
  applied:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
  screening: 'bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] border-[#AFA9EC]',
  coding:    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  interview: 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]',
  offer:     'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700',
  hired:     'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]',
  rejected:  'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]/50',
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', coding: 'Coding Test',
  interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
}

export default function CandidateTable({
  items,
  isLoading,
  isError,
  selectedIds,
  toggleSelectAll,
  toggleSelect,
  blindMode,
  maskName,
  maskEmail,
  isAdmin,
  stageMut,
  sendEmailMut,
  emailMsg,
  deleteMutation,
  groupByExp,
  page,
  PAGE_SIZE,
  sortKey,
  sortDir,
  toggleSort,
  selectedRole,
}: CandidateTableProps) {
  const navigate = useNavigate()
  const tableRef = useRef<HTMLTableElement>(null)
  const theadRef = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    const mainEl = document.querySelector('main')
    const tableEl = tableRef.current
    const theadEl = theadRef.current
    if (!mainEl || !tableEl || !theadEl) return

    let active = true

    const handleScroll = () => {
      if (!active) return
      
      const mainRect = mainEl.getBoundingClientRect()
      const tableRect = tableEl.getBoundingClientRect()
      
      // Calculate top of table relative to main's viewport top
      const offsetTop = tableRect.top - mainRect.top
      
      if (offsetTop < 0) {
        const theadHeight = theadEl.offsetHeight
        // The header shouldn't slide below the bottom of the table
        const maxTranslate = tableRect.height - theadHeight - 40 // some padding for safety
        const translateAmount = Math.max(0, Math.min(-offsetTop, maxTranslate))
        
        theadEl.style.transform = `translateY(${translateAmount}px)`
        theadEl.style.position = 'relative'
        theadEl.style.zIndex = '20'
      } else {
        theadEl.style.transform = 'translateY(0px)'
      }
    }

    mainEl.addEventListener('scroll', handleScroll)
    // Run initial check
    handleScroll()

    // Also handle resizing
    window.addEventListener('resize', handleScroll)

    return () => {
      active = false
      mainEl.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [items])

  function SortIcon({ k }: { k: string }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-[#534AB7] ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  const renderRow = (item: any, idx: number) => (
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
              className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
              title="Stage 0 pre-filter: candidate experience does not meet role requirements — evaluation skipped and candidate auto-rejected"
            >
              Auto-Rejected (Exp)
            </span>
            {item.candidate_years_experience != null && (
              <span className="text-[9px] text-gray-400 dark:text-gray-500 font-medium">
                {item.candidate_years_experience.toFixed(1)} yr(s) exp
              </span>
            )}
          </div>
        ) : item.filter_stage === 'tfidf_filtered' ? (
          <div className="flex flex-col gap-0.5">
            <span
              className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
              title={`Pre-filter: keyword relevance score ${item.tfidf_score != null ? (item.tfidf_score * 100).toFixed(1) + '%' : 'n/a'} was below threshold — LLM evaluation skipped and candidate auto-rejected`}
            >
              Auto-Rejected (Irrelevant)
            </span>
            {item.tfidf_score != null && (
              <span className="text-[9px] text-gray-400 dark:text-gray-500 font-medium">
                relevance: {(item.tfidf_score * 100).toFixed(0)}%
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
          {(item.matched_skill_names ?? []).slice(0, 4).map((s: string) => (
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
            onChange={(e) => stageMut.mutate({ candidateId: item.candidate_id, stage: e.target.value })}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded border cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-[#534AB7]/40 ${STAGE_COLORS[item.candidate_stage] ?? STAGE_COLORS.applied}`}
            disabled={stageMut.isPending}
          >
            {(Object.keys(STAGE_LABELS)).map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        ) : (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STAGE_COLORS[item.candidate_stage] ?? STAGE_COLORS.applied}`}>
            {STAGE_LABELS[item.candidate_stage] ?? 'Applied'}
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
              {emailMsg && emailMsg.id === item.evaluation_id && (
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
              {emailMsg && emailMsg.id === item.evaluation_id && (
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

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="overflow-x-auto overflow-y-clip">
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
        <table ref={tableRef} className="w-full text-sm">
          <thead ref={theadRef} className="sticky top-0 z-10">
            <tr className="bg-gray-50 dark:bg-gray-800">
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 dark:border-gray-600 accent-[#534AB7]"
                  checked={items.length > 0 && selectedIds.size === items.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-12">Rank</th>
              <th
                className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
                onClick={() => toggleSort('candidate_name')}
              >
                Candidate <SortIcon k="candidate_name" />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Current Title</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Phone</th>
              <th
                className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer w-24"
                onClick={() => toggleSort('total_score')}
              >
                Score <SortIcon k="total_score" />
              </th>
              <th
                className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
                onClick={() => toggleSort('skills_matched')}
              >
                Skills <SortIcon k="skills_matched" />
              </th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Applied For</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Evaluated At</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Stage</th>
              {isAdmin && (
                <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Email
                </th>
              )}
              <th className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-12"></th>
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

              if (!groupByExp) {
                return items.map((item, idx) => renderRow(item, (page - 1) * PAGE_SIZE + idx))
              }

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
    </div>
  )
}
