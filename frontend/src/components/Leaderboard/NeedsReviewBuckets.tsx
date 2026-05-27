import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CandidateResult, JobRole, ShortlistStatus } from '../../api/client'

interface NeedsReviewBucketsProps {
  items: CandidateResult[]
  selectedRole: JobRole | null
  bulkShortlistMut: any
  selectedIds: Set<number>
  toggleSelect: (id: number) => void
  onOpenPreview?: (resumeId: number, name: string) => void
  onManualEval?: (item: any) => void
  deleteMutation: any
  blindMode?: boolean
}

interface Bucket {
  key: string
  label: string
  color: string
  badgeClass: string
  items: CandidateResult[]
  description: string
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

function BucketSection({
  bucket,
  selectedIds,
  toggleSelect,
  bulkShortlistMut,
  onOpenPreview,
  onManualEval,
  deleteMutation,
  blindMode = false,
}: {
  bucket: Bucket
  selectedIds: Set<number>
  toggleSelect: (id: number) => void
  bulkShortlistMut: any
  onOpenPreview?: (resumeId: number, name: string) => void
  onManualEval?: (item: any) => void
  deleteMutation: any
  blindMode?: boolean
}) {
  const [open, setOpen] = useState(true)
  const bucketIds = bucket.items.map((i) => i.evaluation_id)
  const navigate = useNavigate()

  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 ${bucket.color} transition-colors`}
      >
        <div className="flex items-center gap-2.5">
          <svg
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{bucket.label}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bucket.badgeClass}`}>
            {bucket.items.length}
          </span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">{bucket.description}</span>
      </button>

      {open && bucket.items.length > 0 && (
        <>
          {/* Bulk action bar for bucket */}
          <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-50 dark:border-gray-800">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium mr-1">Bulk:</span>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: bucketIds, status: 'shortlisted' as ShortlistStatus })}
              disabled={bulkShortlistMut.isPending}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5] hover:bg-[#c8ede0] disabled:opacity-50 transition-colors"
            >
              ✓ Approve All
            </button>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: bucketIds, status: 'rejected' as ShortlistStatus })}
              disabled={bulkShortlistMut.isPending}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#FCEBEB] text-[#791F1F] border border-[#E24B4A] hover:bg-[#f8d5d5] disabled:opacity-50 transition-colors"
            >
              ✕ Reject All
            </button>
          </div>

          {/* Candidate cards */}
          <div className="divide-y divide-gray-50 dark:divide-gray-800 bg-white dark:bg-gray-900">
            {bucket.items.map((item, idx) => {
              const cName = displayName(item.candidate_name, item.candidate_email)
              return (
                <div
                  key={item.evaluation_id}
                  onClick={() => navigate(`/results/${item.evaluation_id}`)}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-[#EEEDFE]/20 dark:hover:bg-[#2d2a5a]/20 cursor-pointer transition-colors ${
                    selectedIds.has(item.evaluation_id) ? 'bg-[#EEEDFE]/40 dark:bg-[#2d2a5a]/40' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600 accent-[#534AB7] shrink-0"
                    checked={selectedIds.has(item.evaluation_id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      toggleSelect(item.evaluation_id)
                    }}
                  />

                  {/* PDF Preview Icon */}
                  {!blindMode && (
                    <button
                      title="Preview resume PDF"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenPreview?.(item.resume_id, cName)
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded text-gray-300 dark:text-gray-600 hover:text-[#534AB7] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                  )}

                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0">
                    <span className="text-[10px] text-white font-bold">
                      {blindMode ? `C${idx + 1}` : getInitials(cName)}
                    </span>
                  </div>

                  {/* Candidate Info + Badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {blindMode ? `Candidate #${idx + 1}` : cName}
                      </p>

                      {/* Discrepancy / Manual Review Badges */}
                      {!blindMode && item.needs_manual_review && (
                        <span
                          title="Manual review required — discrepancies detected"
                          className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]"
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                          </svg>
                          Review
                        </span>
                      )}

                      {!blindMode && item.github_skill_gap_severity && item.github_skill_gap_severity !== 'low' && (
                        <span
                          title={
                            item.github_skill_gap_severity === 'high'
                              ? 'GitHub: claimed skills not evidenced in repositories (high concern)'
                              : 'GitHub: some claimed skills unverified in repositories'
                          }
                          className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
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

                      {!blindMode && item.missed_requirements?.includes('GitHub') && (
                        <span
                          title="GitHub profile required for this role but not provided"
                          className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700"
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                          </svg>
                          Missed Req: GitHub
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {blindMode ? 'redacted@email.com' : item.candidate_email}
                      {item.candidate_graduation_year != null && (
                        <span className="ml-1.5 text-[9px] font-medium bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#534AB7] dark:text-[#AFA9EC] px-1.5 py-0.5 rounded">
                          {item.candidate_graduation_year}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Score & Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      {item.filter_stage === 'experience_filtered' ? (
                        <span className="inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                          Auto-Rejected (Exp)
                        </span>
                      ) : item.filter_stage === 'tfidf_filtered' ? (
                        <span className="inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                          Auto-Rejected (Relevance)
                        </span>
                      ) : (
                        <>
                          <span
                            className="text-sm font-bold"
                            style={{
                              color: item.total_score >= 75 ? '#1D9E75' : item.total_score >= 50 ? '#EF9F27' : '#E24B4A',
                            }}
                          >
                            {Math.round(item.total_score)}
                          </span>
                          {item.tfidf_score != null && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                              {(item.tfidf_score * 100).toFixed(0)}% relevance
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions: Evaluate + Delete */}
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {onManualEval && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onManualEval(item)
                          }}
                          className="p-1.5 text-gray-400 hover:text-[#534AB7] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] rounded transition-colors"
                          title="Manual evaluation — override score"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
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
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {open && bucket.items.length === 0 && (
        <div className="px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900">
          No candidates in this category
        </div>
      )}
    </div>
  )
}

export default function NeedsReviewBuckets({
  items,
  selectedRole,
  bulkShortlistMut,
  selectedIds,
  toggleSelect,
  onOpenPreview,
  onManualEval,
  deleteMutation,
  blindMode = false,
}: NeedsReviewBucketsProps) {
  const buckets: Bucket[] = [
    {
      key: 'missing_github',
      label: 'Missing GitHub',
      color: 'bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50',
      badgeClass: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400',
      description: 'GitHub link required but not provided',
      items: items.filter(
        (i) => i.missed_requirements?.includes('GitHub')
      ),
    },
    {
      key: 'borderline_score',
      label: 'Borderline Score (55–64)',
      color: 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50',
      badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
      description: 'Auto-routed to coding test band',
      items: items.filter(
        (i) => i.total_score >= 55 && i.total_score < 65 && !i.missed_requirements?.includes('GitHub')
      ),
    },
    {
      key: 'grad_year',
      label: 'Grad Year Outside Range',
      color: 'bg-orange-50 dark:bg-orange-950/30 hover:bg-orange-100 dark:hover:bg-orange-950/50',
      badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400',
      description: 'Graduation year outside role filter',
      items: items.filter((i) => {
        if (!selectedRole) return false
        const { min_graduation_year, max_graduation_year } = selectedRole
        const year = i.candidate_graduation_year
        if (year == null) return false
        if (min_graduation_year != null && year < min_graduation_year) return true
        if (max_graduation_year != null && year > max_graduation_year) return true
        return false
      }),
    },
    {
      key: 'experience_mismatch',
      label: 'Experience Mismatch',
      color: 'bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-950/50',
      badgeClass: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
      description: 'Claimed years below required minimum',
      items: items.filter((i) => i.filter_stage === 'experience_filtered'),
    },
    {
      key: 'low_tfidf',
      label: 'Low TF-IDF Match (8–15%)',
      color: 'bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50',
      badgeClass: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
      description: 'Passed threshold but barely relevant',
      items: items.filter(
        (i) => i.tfidf_score != null && i.tfidf_score >= 0.08 && i.tfidf_score <= 0.15
      ),
    },
    {
      key: 'manual_flag',
      label: 'Manual Flag',
      color: 'bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800',
      badgeClass: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
      description: 'Recruiter-tagged for second look',
      items: items.filter(
        (i) =>
          i.status === 'review' &&
          !i.missed_requirements?.includes('GitHub') &&
          !(i.total_score >= 55 && i.total_score < 65) &&
          i.filter_stage === 'llm_scored'
      ),
    },
  ]

  const totalBucketed = new Set(buckets.flatMap((b) => b.items.map((i) => i.evaluation_id))).size

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Needs Review — Structured View
        </h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {totalBucketed} candidate{totalBucketed !== 1 ? 's' : ''} across {buckets.filter(b => b.items.length > 0).length} categories
        </span>
      </div>
      {buckets.map((bucket) => (
        <BucketSection
          key={bucket.key}
          bucket={bucket}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          bulkShortlistMut={bulkShortlistMut}
          onOpenPreview={onOpenPreview}
          onManualEval={onManualEval}
          deleteMutation={deleteMutation}
          blindMode={blindMode}
        />
      ))}
    </div>
  )
}
