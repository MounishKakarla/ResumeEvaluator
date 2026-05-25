interface FilterControlsProps {
  nameSearch: string
  setNameSearch: (v: string) => void
  gradYearFrom: number | ''
  setGradYearFrom: (v: number | '') => void
  gradYearTo: number | ''
  setGradYearTo: (v: number | '') => void
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
}

export default function FilterControls({
  nameSearch,
  setNameSearch,
  gradYearFrom,
  setGradYearFrom,
  gradYearTo,
  setGradYearTo,
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
}: FilterControlsProps) {
  // Satisfy noUnusedLocals for commented-out sorting UI
  if (false as boolean) {
    console.log(sortKey, setSortKey)
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
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
          onChange={(e) => setGradYearFrom(e.target.value ? Number(e.target.value) : '')}
          placeholder="From"
          className="w-20 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 placeholder-gray-400"
        />
        <span className="text-xs text-gray-400">–</span>
        <input
          type="number"
          value={gradYearTo}
          onChange={(e) => setGradYearTo(e.target.value ? Number(e.target.value) : '')}
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
        onChange={(e) => setFilterStatus(e.target.value)}
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
        onChange={(e) => setFilterLevel(e.target.value)}
      >
        <option value="">All Levels</option>
        <option value="entry">Entry Level</option>
        <option value="junior">Junior</option>
        <option value="mid">Mid-level</option>
        <option value="senior">Senior</option>
        <option value="executive">Executive</option>
      </select>

      {/* 
      <select
        className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
        value={sortKey}
        onChange={(e) => setSortKey(e.target.value)}
      >
        <option value="total_score">Sort: Score</option>
        <option value="candidate_name">Sort: Name</option>
        <option value="skills_matched">Sort: Skills Matched</option>
        <option value="years_experience">Sort: Experience (yrs)</option>
      </select>
      */}

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
        onClick={refreshResults}
        className="border border-gray-200 dark:border-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Refresh
      </button>

      {/* Pause / Resume */}
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
  )
}
