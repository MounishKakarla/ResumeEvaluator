interface SummaryCardsProps {
  totalEvaluated: number
  avgScore: number | null
  shortlisted: number
  needsReview: number
  pendingCount: number
  autoRejected: number | null
  tfidfFiltered: number
  experienceFiltered: number
  queuedCount: number
  summaryFetching: boolean
  summary: any
  scoreRangeFilter: { min: number; max: number } | null
  clearScoreFilter: () => void
}

export default function SummaryCards({
  totalEvaluated,
  // avgScore,
  shortlisted,
  needsReview,
  pendingCount,
  autoRejected,
  tfidfFiltered,
  experienceFiltered,
  queuedCount,
  summaryFetching,
  summary,
  scoreRangeFilter,
  clearScoreFilter,
}: SummaryCardsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Evaluated', value: totalEvaluated, color: '#534AB7', bg: '#EEEDFE', fromSummary: false, tooltip: undefined },
          // { label: 'Avg Score', value: avgScore !== null ? `${avgScore}` : null, color: '#1D9E75', bg: '#E1F5EE', fromSummary: true, tooltip: undefined },
          { label: 'Shortlisted', value: summary ? shortlisted : null, color: '#EF9F27', bg: '#FAEEDA', fromSummary: true, tooltip: undefined },
          { label: 'Next Consideration', value: summary ? needsReview + pendingCount : null, color: '#7C3AED', bg: '#F5F3FF', fromSummary: true, tooltip: 'Flagged for manual recruiter review' },
          {
            label: 'Auto-Rejected',
            value: summary ? autoRejected : null,
            color: '#E24B4A',
            bg: '#FCEBEB',
            fromSummary: true,
            tooltip: `${tfidfFiltered} keyword mismatch + ${experienceFiltered} experience mismatch — auto-disqualified before recruiter review`,
          },
          { label: 'Queued', value: summary ? queuedCount : null, color: '#6B7280', bg: '#F3F4F6', fromSummary: true, tooltip: 'Waiting to be scored' },
        ].map(({ label, value, color, bg, fromSummary, tooltip }) => (
          <div
            key={label}
            className="rounded-xl border p-4"
            style={{ backgroundColor: bg, borderColor: color + '40' }}
            title={tooltip}
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
            {label === 'Next Consideration' && summary && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: color + 'CC' }}>
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    Manual Review
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{needsReview}</span>
                </div>
              </div>
            )}
            {label === 'Auto-Rejected' && summary && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: color + 'CC' }}>
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Irrelevant Resumes
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{tfidfFiltered}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: color + 'CC' }}>
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Exp. Mismatch
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{experienceFiltered}</span>
                </div>
              </div>
            )}
          </div>
        ))}
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
    </div>
  )
}
