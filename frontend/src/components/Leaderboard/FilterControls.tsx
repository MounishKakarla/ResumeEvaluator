import { useState, useRef, useEffect } from 'react'

interface FilterControlsProps {
  nameSearch: string
  setNameSearch: (v: string) => void
  gradYearFrom: number | ''
  setGradYearFrom: (v: number | '') => void
  gradYearTo: number | ''
  setGradYearTo: (v: number | '') => void
  scoreFrom: number | ''
  setScoreFrom: (v: number | '') => void
  scoreTo: number | ''
  setScoreTo: (v: number | '') => void
  filterStatus: string
  setFilterStatus: (v: string) => void
  filterLevel: string
  setFilterLevel: (v: string) => void
  sortKey: string
  setSortKey: (v: any) => void
  selectedJobRoleId: number | null
  evalStatus: any
  queuedCount: number
  isAdmin: boolean
  bulkEmailMut: any
  bulkEmailMsg: string | null
  deleteAllMutation: any
  pauseMut: any
  resumeMut: any
  exportCSV: () => void
  downloadResultsCsv: (id: any, val: any) => void
  refreshResults: () => void
  items?: any[]
}

// --- Icon helpers ---
function IconFilter() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function IconEmail() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function IconPdf() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9.5 17.5c-.3 0-.5-.1-.7-.3-.2-.2-.3-.5-.3-.8 0-.5.2-1.1.6-1.9-.4.1-.7.2-1 .2-.6 0-1.1-.2-1.4-.5-.3-.3-.4-.7-.4-1.2 0-.5.2-.9.5-1.2.3-.3.7-.5 1.2-.5.3 0 .6.1.9.3V11c0-.3.1-.5.3-.7.2-.2.5-.3.7-.3.3 0 .5.1.7.3.2.2.3.5.3.7v.8c.2-.1.5-.2.8-.2.5 0 .9.2 1.2.5.3.3.5.7.5 1.2 0 .5-.1.9-.4 1.2-.3.3-.7.5-1.3.5-.3 0-.6-.1-.9-.2.4.7.6 1.3.6 1.8 0 .4-.1.7-.3.9-.2.2-.5.3-.8.3z" />
    </svg>
  )
}

function IconGrid() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

// PDF export: print page as PDF using window.print with a simplified layout
function exportPDF(callback?: () => void) {
  if (callback) callback()
  setTimeout(() => {
    window.print()
  }, 150)
}

// Full report: export as HTML blob
function exportFullReport(items?: any[]) {
  const rows = items && items.length > 0 ? items : []
  const content = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Candidates Report</title>
<style>
  body { font-family: -apple-system,sans-serif; font-size:12px; color:#111; padding:24px; }
  h1 { font-size:18px; margin-bottom:4px; }
  .meta { font-size:11px; color:#666; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#534AB7; color:#fff; padding:7px 10px; text-align:left; font-size:11px; white-space:nowrap; }
  td { padding:6px 10px; border-bottom:1px solid #eee; vertical-align:top; }
  tr:nth-child(even) td { background:#f9f9ff; }
  .score-high { color:#1D9E75; font-weight:700; }
  .score-mid  { color:#EF9F27; font-weight:700; }
  .score-low  { color:#E24B4A; font-weight:700; }
  .tag { display:inline-block; font-size:10px; padding:1px 6px; border-radius:20px; background:#EEEDFE; color:#3C3489; margin:1px; }
  .flag { color:#E24B4A; font-size:10px; }
</style>
</head>
<body>
<h1>Candidate Evaluation Report</h1>
<p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Total candidates: ${rows.length}</p>
${rows.length > 0 ? `
<table>
<thead><tr>
  <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Score</th>
  <th>Skills Matched</th><th>Matched Skill Names</th><th>Role</th>
  <th>Level</th><th>Stage</th><th>Status</th><th>GitHub</th><th>Evaluated At</th>
</tr></thead>
<tbody>
${rows.map((it: any, i: number) => {
  const score = Math.round(it.total_score ?? 0)
  const scoreClass = score >= 75 ? 'score-high' : score >= 50 ? 'score-mid' : 'score-low'
  const skillTags = (it.matched_skill_names ?? []).map((s: string) => `<span class="tag">${s}</span>`).join('')
  const flags = it.needs_manual_review ? '<span class="flag">⚠ Review</span>' : ''
  const ghUrl = it.github_url ? `<a href="${it.github_url}">${it.github_url}</a>` : '—'
  const evalDate = it.evaluated_at ? new Date(it.evaluated_at).toLocaleDateString() : '—'
  return `<tr>
  <td>${i + 1}</td>
  <td>${it.candidate_name ?? ''} ${flags}</td>
  <td>${it.candidate_email ?? ''}</td>
  <td>${it.candidate_phone ?? '—'}</td>
  <td class="${scoreClass}">${score}</td>
  <td>${it.skills_matched ?? 0}/${it.skills_total ?? 0}</td>
  <td>${skillTags || '—'}</td>
  <td>${it.job_role_title ?? '—'}</td>
  <td>${it.candidate_experience_level ?? '—'}</td>
  <td>${it.candidate_stage ?? 'applied'}</td>
  <td>${it.status ?? '—'}</td>
  <td>${ghUrl}</td>
  <td>${evalDate}</td>
</tr>`}).join('')}
</tbody>
</table>` : '<p>No candidates to display.</p>'}
</body></html>`
  const blob = new Blob([content], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report_${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

export default function FilterControls({
  nameSearch,
  setNameSearch,
  gradYearFrom,
  setGradYearFrom,
  gradYearTo,
  setGradYearTo,
  scoreFrom,
  setScoreFrom,
  scoreTo,
  setScoreTo,
  filterStatus,
  setFilterStatus,
  filterLevel,
  setFilterLevel,
  sortKey,
  setSortKey,
  selectedJobRoleId,
  evalStatus,
  queuedCount,
  isAdmin,
  bulkEmailMut,
  bulkEmailMsg,
  deleteAllMutation,
  pauseMut,
  resumeMut,
  exportCSV,
  downloadResultsCsv,
  refreshResults,
  items,
}: FilterControlsProps) {
  // Satisfy noUnusedLocals
  if (false as boolean) {
    console.log(sortKey, setSortKey)
  }

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const filtersRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  // Count active filters for badge
  const activeFilterCount = [
    filterStatus !== '',
    filterLevel !== '',
    gradYearFrom !== '' || gradYearTo !== '',
    scoreFrom !== '' || scoreTo !== '',
  ].filter(Boolean).length

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false)
      }
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function clearAllFilters() {
    setFilterStatus('')
    setFilterLevel('')
    setGradYearFrom('')
    setGradYearTo('')
    setScoreFrom('')
    setScoreTo('')
  }

  const isPaused = evalStatus?.paused
  const canPause = selectedJobRoleId != null

  return (
    <div className="space-y-2.5">
      {/* ── Main toolbar row ── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Search bar — full width on small, fixed on large */}
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-7 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400 dark:placeholder-gray-500 transition-shadow"
          />
          {nameSearch && (
            <button
              onClick={() => setNameSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-base leading-none"
            >×</button>
          )}
        </div>

        {/* ── FILTERS dropdown (Amazon/Myntra style) ── */}
        <div className="relative" ref={filtersRef}>
          <button
            onClick={() => { setFiltersOpen((v) => !v); setExportOpen(false) }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all select-none
              ${filtersOpen
                ? 'bg-[#534AB7] text-white border-[#534AB7] shadow-md shadow-[#534AB7]/25'
                : activeFilterCount > 0
                  ? 'bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] border-[#AFA9EC]/50 hover:border-[#534AB7]/60'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
          >
            <IconFilter />
            Filters
            {activeFilterCount > 0 && (
              <span className={`inline-flex items-center justify-center w-4.5 h-4.5 min-w-[18px] px-1 py-0.5 text-[10px] font-bold rounded-full leading-none
                ${filtersOpen ? 'bg-white/25 text-white' : 'bg-[#534AB7] text-white'}`}
              >
                {activeFilterCount}
              </span>
            )}
            <IconChevron open={filtersOpen} />
          </button>

          {/* Filters Dropdown Panel */}
          {filtersOpen && (
            <div className="absolute top-[calc(100%+6px)] left-0 z-50 w-[260px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl shadow-gray-200/60 dark:shadow-black/40 p-3.5 space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-150">
              {/* Header */}
              <div className="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-gray-800">
                <span className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                  <IconFilter />
                  Filters
                </span>
                <div className="flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="text-xs font-semibold text-[#E24B4A] hover:text-[#c23c3c] transition-colors"
                    >
                      Clear all ({activeFilterCount})
                    </button>
                  )}
                  <button
                    onClick={() => setFiltersOpen(false)}
                    title="Close filters"
                    className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { value: '', label: 'All' },
                    { value: 'shortlisted', label: '✓ Shortlisted' },
                    { value: 'review', label: '⚑ Review' },
                    { value: 'rejected', label: '✕ Rejected' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterStatus(opt.value)}
                      className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-all
                        ${filterStatus === opt.value
                          ? 'bg-[#534AB7] text-white border-[#534AB7] shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-[#534AB7]/40 hover:text-[#534AB7]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Experience Level */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Experience Level</label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { value: '', label: 'All' },
                    { value: 'entry', label: 'Entry' },
                    { value: 'junior', label: 'Junior' },
                    { value: 'mid', label: 'Mid' },
                    { value: 'senior', label: 'Senior' },
                    { value: 'executive', label: 'Exec' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterLevel(opt.value)}
                      className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-all
                        ${filterLevel === opt.value
                          ? 'bg-[#534AB7] text-white border-[#534AB7] shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-[#534AB7]/40 hover:text-[#534AB7]'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Graduation Year Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Graduation Year</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={gradYearFrom}
                    onChange={(e) => setGradYearFrom(e.target.value ? Number(e.target.value) : '')}
                    placeholder="From"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={gradYearTo}
                    onChange={(e) => setGradYearTo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="To"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
                  />
                  {(gradYearFrom !== '' || gradYearTo !== '') && (
                    <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="shrink-0 text-gray-400 hover:text-red-500 text-sm leading-none transition-colors">×</button>
                  )}
                </div>
              </div>

              {/* Score Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fit Score Range</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={scoreFrom}
                    onChange={(e) => setScoreFrom(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Min"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={scoreTo}
                    onChange={(e) => setScoreTo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Max"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
                  />
                  {(scoreFrom !== '' || scoreTo !== '') && (
                    <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="shrink-0 text-gray-400 hover:text-red-500 text-sm leading-none transition-colors">×</button>
                  )}
                </div>
              </div>

              {/* Active filter chips */}
              {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                  {filterStatus && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[10px] font-semibold border border-[#AFA9EC]/30">
                      Status: {filterStatus}
                      <button onClick={() => setFilterStatus('')} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {filterLevel && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[10px] font-semibold border border-[#AFA9EC]/30">
                      Level: {filterLevel}
                      <button onClick={() => setFilterLevel('')} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {(gradYearFrom !== '' || gradYearTo !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[10px] font-semibold border border-[#AFA9EC]/30">
                      Grad: {gradYearFrom || '…'}–{gradYearTo || '…'}
                      <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {(scoreFrom !== '' || scoreTo !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[10px] font-semibold border border-[#AFA9EC]/30">
                      Score: {scoreFrom || '0'}–{scoreTo || '100'}
                      <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Email Shortlisted button ── */}
        {isAdmin && selectedJobRoleId && (
          <button
            onClick={() => {
              if (confirm("Send next-steps email to all shortlisted candidates who haven't received one yet?")) {
                bulkEmailMut.mutate()
              }
            }}
            disabled={bulkEmailMut.isPending}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-[#1D9E75]/50 bg-[#E1F5EE] dark:bg-[#0d3328] text-[#085041] dark:text-[#5DCAA5] hover:bg-[#c8ede0] dark:hover:bg-[#0f4035] disabled:opacity-50 transition-colors select-none"
          >
            <IconEmail />
            {bulkEmailMut.isPending ? 'Sending…' : 'Email Shortlisted'}
          </button>
        )}
        {bulkEmailMsg && (
          <span className="text-xs text-[#1D9E75] font-medium animate-pulse">{bulkEmailMsg}</span>
        )}

        {/* ── Refresh ── */}
        <button
          onClick={refreshResults}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-colors select-none"
          title="Reload results from server"
        >
          <IconRefresh />
          Refresh
        </button>

        {/* ── Pause / Resume ── */}
        {canPause && (
          <button
            onClick={() => (isPaused ? resumeMut.mutate() : pauseMut.mutate())}
            disabled={pauseMut.isPending || resumeMut.isPending || (!evalStatus?.in_progress && !evalStatus?.paused)}
            title={
              isPaused
                ? `Resume evaluation${queuedCount > 0 ? ` — ${queuedCount} queued` : ''}`
                : 'Pause evaluation — queued resumes stay held'
            }
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 select-none
              ${isPaused
                ? 'border-[#1D9E75]/50 text-[#1D9E75] dark:border-[#1D9E75]/50 hover:bg-[#E1F5EE] dark:hover:bg-[#0a3329]'
                : 'border-amber-300 dark:border-amber-600/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${isPaused ? 'bg-[#1D9E75]' : 'bg-amber-400 animate-pulse'}`} />
            {isPaused
              ? (resumeMut.isPending ? 'Resuming…' : 'Resume')
              : (pauseMut.isPending ? 'Pausing…' : 'Pause')
            }
          </button>
        )}

        {/* ── Export Grid (⠿) dropdown ── */}
        <div className="relative ml-auto" ref={exportRef}>
          <button
            onClick={() => { setExportOpen((v) => !v); setFiltersOpen(false) }}
            title="Export options"
            className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all select-none
              ${exportOpen
                ? 'bg-[#534AB7] text-white border-[#534AB7] shadow-md shadow-[#534AB7]/25'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
          >
            <IconGrid />
          </button>

          {/* Export dropdown */}
          {exportOpen && (
            <div className="absolute top-[calc(100%+6px)] right-0 z-50 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl shadow-gray-200/60 dark:shadow-black/40 p-2 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 mb-1">
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Export Options</span>
                <button
                  onClick={() => setExportOpen(false)}
                  title="Close"
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <button
                onClick={() => { exportCSV(); setExportOpen(false) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] hover:text-[#3C3489] dark:hover:text-[#AFA9EC] transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-[#534AB7]/10 transition-colors">
                  <IconDownload />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export CSV</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Current view (filtered)</p>
                </div>
              </button>

              <button
                onClick={() => { downloadResultsCsv(selectedJobRoleId, undefined); setExportOpen(false) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] hover:text-[#3C3489] dark:hover:text-[#AFA9EC] transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-[#534AB7]/10 transition-colors">
                  <IconDownload />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export Full CSV</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">All pages — HRIS fields</p>
                </div>
              </button>

              <button
                onClick={() => { exportPDF(() => setExportOpen(false)) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-[#FCEBEB] dark:hover:bg-[#3a1515] hover:text-[#791F1F] dark:hover:text-[#E24B4A] transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-[#E24B4A]/10 transition-colors text-[#E24B4A]">
                  <IconPdf />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export PDF</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Print / Save as PDF</p>
                </div>
              </button>

              <button
                onClick={() => { exportFullReport(items); setExportOpen(false) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-[#E1F5EE] dark:hover:bg-[#0d3328] hover:text-[#085041] dark:hover:text-[#5DCAA5] transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-[#1D9E75]/10 transition-colors text-[#1D9E75]">
                  <IconGrid />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export Full Report</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">HTML report file</p>
                </div>
              </button>

              {/* Divider + Danger zone */}
              <div className="border-t border-gray-100 dark:border-gray-800 mt-1.5 pt-1.5">
                <button
                  onClick={() => {
                    if (confirm('Clear ALL results for this job role?')) {
                      deleteAllMutation.mutate(selectedJobRoleId!)
                      setExportOpen(false)
                    }
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
                >
                  <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500">
                    <IconTrash />
                  </span>
                  <div className="text-left">
                    <p className="font-semibold text-[13px] leading-tight">Clear All Results</p>
                    <p className="text-[10px] text-red-400/70 mt-0.5">Permanently removes all evaluations</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Active filter chips strip (always visible when filters are active) ── */}
      {activeFilterCount > 0 && !filtersOpen && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-1">Active:</span>
          {filterStatus && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[11px] font-semibold border border-[#AFA9EC]/30">
              Status: {filterStatus}
              <button onClick={() => setFilterStatus('')} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {filterLevel && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[11px] font-semibold border border-[#AFA9EC]/30">
              Level: {filterLevel}
              <button onClick={() => setFilterLevel('')} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {(gradYearFrom !== '' || gradYearTo !== '') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[11px] font-semibold border border-[#AFA9EC]/30">
              Grad {gradYearFrom || '…'}–{gradYearTo || '…'}
              <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {(scoreFrom !== '' || scoreTo !== '') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a] dark:text-[#AFA9EC] text-[11px] font-semibold border border-[#AFA9EC]/30">
              Score {scoreFrom || '0'}–{scoreTo || '100'}
              <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          <button
            onClick={clearAllFilters}
            className="text-[11px] font-semibold text-[#E24B4A] hover:text-[#c23c3c] transition-colors ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
