import React, { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { searchCandidates, searchResumes, deleteCandidate, bulkDeleteCandidates, updateCandidate } from '../api/client'
import type { CandidateSearchItem, ResumeSearchHit, CandidateUpdate } from '../api/client'

const STAGES = ['applied', 'screening', 'coding', 'interview', 'offer', 'hired', 'rejected']
const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior', 'executive']

const STAGE_COLORS: Record<string, string> = {
  applied: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  screening: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  coding: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  interview: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  offer: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  hired: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

type SearchTab = 'candidates' | 'resume'

export default function Search() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<SearchTab>('candidates')

  // Candidate search state
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [stage, setStage] = useState('')
  const [experienceLevel, setExperienceLevel] = useState('')
  const [page, setPage] = useState(1)

  // Resume text search state
  const [resumeQuery, setResumeQuery] = useState('')
  const [debouncedResumeQuery, setDebouncedResumeQuery] = useState('')
  const [resumePage, setResumePage] = useState(1)

  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Selection + delete state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['candidate-search'] })

  const deleteMut = useMutation({
    mutationFn: (ids: number[]) =>
      ids.length === 1 ? deleteCandidate(ids[0]).then(() => ({ deleted: 1 })) : bulkDeleteCandidates(ids),
    onSuccess: () => { setSelectedIds(new Set()); invalidate() },
    onError: () => alert('Delete failed. Check backend logs.'),
  })

  // Edit modal state
  const [editingCandidate, setEditingCandidate] = useState<CandidateSearchItem | null>(null)
  const [editForm, setEditForm] = useState<CandidateUpdate>({})

  function openEdit(c: CandidateSearchItem) {
    setEditingCandidate(c)
    setEditForm({
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      current_title: c.current_title ?? '',
      experience_level: c.experience_level ?? '',
      years_experience: c.years_experience ?? undefined,
      linkedin_url: c.linkedin_url ?? '',
      github_url: c.github_url ?? '',
      portfolio_url: c.portfolio_url ?? '',
    })
  }

  const editMut = useMutation({
    mutationFn: () => updateCandidate(editingCandidate!.id, editForm),
    onSuccess: () => { setEditingCandidate(null); invalidate() },
    onError: () => alert('Update failed. Check backend logs.'),
  })

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids: number[]) {
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(ids))
    }
  }

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setPage(1)
    if (debounceTimer) clearTimeout(debounceTimer)
    const t = setTimeout(() => setDebouncedQuery(value), 350)
    setDebounceTimer(t)
  }, [debounceTimer])

  const handleResumeQueryChange = useCallback((value: string) => {
    setResumeQuery(value)
    setResumePage(1)
    if (debounceTimer) clearTimeout(debounceTimer)
    const t = setTimeout(() => setDebouncedResumeQuery(value), 400)
    setDebounceTimer(t)
  }, [debounceTimer])

  const { data, isFetching } = useQuery({
    queryKey: ['candidate-search', debouncedQuery, stage, experienceLevel, page],
    queryFn: () => searchCandidates({
      q: debouncedQuery || undefined,
      stage: stage || undefined,
      experience_level: experienceLevel || undefined,
      page,
      limit: 20,
    }),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'candidates',
  })

  const { data: resumeData, isFetching: resumeFetching } = useQuery({
    queryKey: ['resume-search', debouncedResumeQuery, resumePage],
    queryFn: () => searchResumes({ q: debouncedResumeQuery, page: resumePage, limit: 20 }),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'resume' && debouncedResumeQuery.length >= 2,
  })

  const inputCls = 'border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition placeholder-gray-400 dark:placeholder-gray-500'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Search</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Search candidates by profile or by resume content</p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'candidates', label: 'By Candidate' },
          { key: 'resume', label: 'Resume Full-Text' },
        ] as { key: SearchTab; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-[#534AB7] text-[#534AB7]'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-[#534AB7]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Candidate search tab ─────────────────────────────────── */}
      {activeTab === 'candidates' && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search name, email, or title…"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className={`${inputCls} pl-9 w-full`}
              />
            </div>
            <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1) }} className={`${inputCls} pr-8`}>
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={experienceLevel} onChange={(e) => { setExperienceLevel(e.target.value); setPage(1) }} className={`${inputCls} pr-8`}>
              <option value="">All levels</option>
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
            </select>
            {(query || stage || experienceLevel) && (
              <button
                onClick={() => { setQuery(''); setDebouncedQuery(''); setStage(''); setExperienceLevel(''); setPage(1) }}
                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-[#EEEDFE] dark:bg-[#2d2a5a]/60 border border-[#534AB7]/30 rounded-xl">
              <span className="text-sm font-medium text-[#534AB7]">{selectedIds.size} selected</span>
              <button
                onClick={() => deleteMut.mutate(Array.from(selectedIds))}
                disabled={deleteMut.isPending}
                className="px-3 py-1.5 text-xs font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {deleteMut.isPending ? 'Deleting…' : `Delete Selected (${selectedIds.size})`}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Clear selection
              </button>
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {isFetching && !data && (
              <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">Searching…</div>
            )}
            {data && data.items.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 dark:text-gray-500 text-sm">No candidates found</p>
              </div>
            )}
            {data && data.items.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={data.items.every((c) => selectedIds.has(c.id))}
                            onChange={() => toggleSelectAll(data.items.map((c) => c.id))}
                            className="rounded border-gray-300 text-[#534AB7] focus:ring-[#534AB7]/40"
                            title="Select all on this page"
                          />
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Candidate</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Title / Level</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Stage</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Latest Role</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Links</th>
                        <th className="px-3 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((c: CandidateSearchItem) => (
                        <tr
                          key={c.id}
                          onClick={() => c.latest_evaluation_id ? navigate(`/results/${c.latest_evaluation_id}`) : undefined}
                          className={`group border-b border-gray-50 dark:border-gray-800 transition-colors ${c.latest_evaluation_id ? 'hover:bg-[#EEEDFE]/40 dark:hover:bg-[#2d2a5a]/20 cursor-pointer' : ''} ${selectedIds.has(c.id) ? 'bg-[#EEEDFE]/30 dark:bg-[#2d2a5a]/20' : ''}`}
                        >
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(c.id)}
                              onChange={() => toggleSelect(c.id)}
                              className="rounded border-gray-300 text-[#534AB7] focus:ring-[#534AB7]/40"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{c.name}</div>
                            {c.email && <div className="text-xs text-gray-400 dark:text-gray-500">{c.email}</div>}
                            {c.phone && <div className="text-xs text-gray-400 dark:text-gray-500">{c.phone}</div>}
                            {c.source && (
                              <span className={`inline-flex mt-0.5 px-1.5 py-0 rounded text-[10px] font-medium ${
                                c.source === 'email' ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400' :
                                c.source === 'csv' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
                                'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                              }`}>{c.source}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            <div>{c.current_title ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</div>
                            {(c.experience_level || c.years_experience != null) && (
                              <div className="text-xs text-gray-400 dark:text-gray-500">
                                {c.experience_level && <span className="capitalize">{c.experience_level}</span>}
                                {c.years_experience != null && <span> · {c.years_experience}y</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STAGE_COLORS[c.stage] ?? STAGE_COLORS.applied}`}>
                              {c.stage}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                            {c.latest_job_role ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                              {c.linkedin_url && (
                                <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[#0077B5] hover:opacity-80 transition-opacity" title="LinkedIn">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/>
                                    <circle cx="4" cy="4" r="2"/>
                                  </svg>
                                </a>
                              )}
                              {c.github_url && (
                                <a href={c.github_url} target="_blank" rel="noopener noreferrer" className="text-gray-700 dark:text-gray-300 hover:opacity-80 transition-opacity" title="GitHub">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.465-2.381 1.235-3.221-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23A11.51 11.51 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.911 1.23 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/>
                                  </svg>
                                </a>
                              )}
                              {c.portfolio_url && (
                                <a href={c.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-[#534AB7] hover:opacity-80 transition-opacity" title="Portfolio">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => openEdit(c)}
                                title="Edit candidate"
                                className="p-1.5 text-gray-300 hover:text-[#534AB7] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] rounded transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => deleteMut.mutate([c.id])}
                                disabled={deleteMut.isPending}
                                title="Delete candidate"
                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {data.total} candidate{data.total !== 1 ? 's' : ''}
                      {data.pages > 1 && ` · Page ${data.page} of ${data.pages}`}
                    </span>
                    {data.total > 0 && (
                      <>
                        {!confirmDeleteAll ? (
                          <button
                            onClick={() => setConfirmDeleteAll(true)}
                            className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                          >
                            Delete All
                          </button>
                        ) : (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="text-red-500 font-medium">Delete all {data.total} candidates?</span>
                            <button
                              onClick={() => {
                                const allIds = data.items.map((c) => c.id)
                                deleteMut.mutate(allIds)
                                setConfirmDeleteAll(false)
                              }}
                              disabled={deleteMut.isPending}
                              className="px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-semibold disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteAll(false)}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                              Cancel
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {data.pages > 1 && (
                    <div className="flex gap-2">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                        className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        Previous
                      </button>
                      <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page === data.pages}
                        className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {data && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
              {isFetching ? 'Refreshing…' : `${data.total} result${data.total !== 1 ? 's' : ''}`}
            </p>
          )}
        </>
      )}

      {/* ── Resume full-text search tab ──────────────────────────── */}
      {activeTab === 'resume' && (
        <>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search resume text — e.g. 'React', 'AWS', 'machine learning'…"
              value={resumeQuery}
              onChange={(e) => handleResumeQueryChange(e.target.value)}
              className={`${inputCls} pl-9 w-full`}
              autoFocus
            />
          </div>

          {resumeQuery.length > 0 && resumeQuery.length < 2 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">Enter at least 2 characters to search</p>
          )}

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {resumeFetching && !resumeData && debouncedResumeQuery.length >= 2 && (
              <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">Searching resumes…</div>
            )}

            {!resumeQuery && (
              <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">
                Type a keyword to search across all resume text
              </div>
            )}

            {resumeData && resumeData.hits.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-gray-400 dark:text-gray-500 text-sm">No matching resumes found for "{debouncedResumeQuery}"</p>
              </div>
            )}

            {resumeData && resumeData.hits.length > 0 && (
              <>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {resumeData.hits.map((hit: ResumeSearchHit) => (
                    <div
                      key={hit.evaluation_id}
                      onClick={() => navigate(`/results/${hit.evaluation_id}`)}
                      className="px-5 py-4 hover:bg-[#EEEDFE]/40 dark:hover:bg-[#2d2a5a]/20 cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{hit.candidate_name}</span>
                          {hit.candidate_email && (
                            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{hit.candidate_email}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-400 dark:text-gray-500">{hit.job_role_title}</span>
                          <span className={`text-xs font-semibold ${hit.total_score >= 75 ? 'text-[#1D9E75]' : hit.total_score >= 50 ? 'text-[#EF9F27]' : 'text-[#E24B4A]'}`}>
                            {Math.round(hit.total_score)}
                          </span>
                        </div>
                      </div>
                      {/* Snippet with keyword highlighted */}
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-mono bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5">
                        {highlightSnippet(hit.snippet, debouncedResumeQuery)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {resumeData.total > 20 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {resumeData.total} match{resumeData.total !== 1 ? 'es' : ''}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setResumePage((p) => Math.max(1, p - 1))} disabled={resumePage === 1}
                        className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        Previous
                      </button>
                      <button onClick={() => setResumePage((p) => p + 1)} disabled={resumeData.hits.length < 20}
                        className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Edit Candidate Modal ──────────────────────────────── */}
      {editingCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Edit Candidate</h2>
              <button onClick={() => setEditingCandidate(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              {[
                { label: 'Full Name', field: 'name' as const, type: 'text' },
                { label: 'Email', field: 'email' as const, type: 'email' },
                { label: 'Phone', field: 'phone' as const, type: 'text' },
                { label: 'Current Title', field: 'current_title' as const, type: 'text' },
                { label: 'Years Experience', field: 'years_experience' as const, type: 'number' },
                { label: 'LinkedIn URL', field: 'linkedin_url' as const, type: 'url' },
                { label: 'GitHub URL', field: 'github_url' as const, type: 'url' },
                { label: 'Portfolio URL', field: 'portfolio_url' as const, type: 'url' },
              ].map(({ label, field, type }) => (
                <div key={field} className={field.endsWith('_url') ? 'col-span-2' : ''}>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
                  <input
                    type={type}
                    value={(editForm[field] as string | number | undefined) ?? ''}
                    onChange={(e) => setEditForm((prev) => ({
                      ...prev,
                      [field]: type === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value
                    }))}
                    className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Experience Level</label>
                <select
                  value={editForm.experience_level ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, experience_level: e.target.value || undefined }))}
                  className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
                >
                  <option value="">— not set —</option>
                  {['junior', 'mid', 'senior', 'executive'].map((l) => (
                    <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setEditingCandidate(null)} className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Cancel</button>
              <button
                onClick={() => editMut.mutate()}
                disabled={editMut.isPending}
                className="px-4 py-2 text-sm font-semibold bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {editMut.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function highlightSnippet(snippet: string, query: string): React.ReactNode {
  if (!query) return snippet
  const parts = snippet.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-[#FEF08A] dark:bg-[#713F12] text-gray-900 dark:text-yellow-200 rounded-sm">{part}</mark>
          : part
      )}
    </>
  )
}
