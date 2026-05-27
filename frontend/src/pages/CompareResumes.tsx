import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getResultDetail, getCompareAnalysis } from '../api/client'
import type { EvaluationDetail } from '../api/client'

function diffClass(inA: boolean, inB: boolean): string {
  if (inA && inB) return 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]'
  if (inA && !inB) return 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]'
  if (!inA && inB) return 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-400 border-gray-200 dark:border-gray-600'
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden mt-1">
      <div
        className="h-1.5 rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, (value / max) * 100)}%`, backgroundColor: color }}
      />
    </div>
  )
}

function parseBoldText(text: string) {
  const parts = text.split(/\*\*([^*]+)\*\*/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return (
        <strong key={index} className="font-extrabold text-gray-900 dark:text-white bg-indigo-50 dark:bg-indigo-950/40 px-1 rounded border border-indigo-100/60 dark:border-indigo-900/50">
          {part}
        </strong>
      )
    }
    const codeParts = part.split(/`([^`]+)`/g)
    return codeParts.map((subPart, subIndex) => {
      if (subIndex % 2 === 1) {
        return (
          <code key={subIndex} className="bg-gray-100 dark:bg-gray-800 text-[#534AB7] dark:text-[#AFA9EC] font-mono px-1.5 py-0.5 rounded text-[11px] border border-gray-200 dark:border-gray-700">
            {subPart}
          </code>
        )
      }
      return subPart
    })
  })
}

function renderMarkdown(text: string) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
      {lines.map((line, idx) => {
        let trimmed = line.trim()
        if (!trimmed) return <div key={idx} className="h-1.5" />

        // Check for headings
        if (trimmed.startsWith('####')) {
          return (
            <h4 key={idx} className="text-[11px] font-bold text-[#534AB7] dark:text-[#AFA9EC] mt-5 mb-2 first:mt-0 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-3 bg-[#534AB7] rounded-full inline-block" />
              {trimmed.replace(/^####\s*/, '')}
            </h4>
          )
        }
        if (trimmed.startsWith('###')) {
          return (
            <h3 key={idx} className="text-xs font-bold text-gray-950 dark:text-white mt-4 mb-2 first:mt-0 uppercase tracking-wider">
              {trimmed.replace(/^###\s*/, '')}
            </h3>
          )
        }
        if (trimmed.startsWith('##')) {
          return (
            <h2 key={idx} className="text-sm font-bold text-gray-950 dark:text-white mt-5 mb-2.5 first:mt-0 border-b border-gray-100 dark:border-gray-800 pb-1">
              {trimmed.replace(/^##\s*/, '')}
            </h2>
          )
        }
        if (trimmed.startsWith('#')) {
          return (
            <h1 key={idx} className="text-base font-bold text-gray-950 dark:text-white mt-6 mb-3 first:mt-0 border-b border-gray-200 dark:border-gray-800 pb-1.5">
              {trimmed.replace(/^#\s*/, '')}
            </h1>
          )
        }

        // Check for bullet list item
        const isBullet = trimmed.startsWith('*') || trimmed.startsWith('-')
        if (isBullet) {
          trimmed = trimmed.replace(/^[\*\-]\s*/, '')
          return (
            <div key={idx} className="flex items-start gap-2.5 ml-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#534AB7] dark:bg-[#AFA9EC] mt-2 shrink-0 opacity-70" />
              <div className="text-gray-600 dark:text-gray-300 text-xs flex-1">{parseBoldText(trimmed)}</div>
            </div>
          )
        }

        return <p key={idx} className="text-xs text-gray-600 dark:text-gray-300">{parseBoldText(trimmed)}</p>
      })}
    </div>
  )
}

function CandidateColumn({
  ev,
  isLoading,
  label,
  otherSkills,
}: {
  ev?: EvaluationDetail
  isLoading: boolean
  label: string
  otherSkills: string[]
}) {
  const allSkillNames = ev?.skills_matched.map((s) => s.skill_name) ?? []

  return (
    <div className="flex-1 min-w-0 space-y-4">
      {/* Header */}
      <div className={`p-4 rounded-xl border-2 ${ev ? 'border-[#534AB7]/30 bg-[#EEEDFE]/20 dark:bg-[#2d2a5a]/20' : 'border-gray-200 dark:border-gray-700'}`}>
        <p className="text-[10px] uppercase tracking-widest font-bold text-[#534AB7] dark:text-[#AFA9EC] mb-1">{label}</p>
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-36" />
            <div className="h-3 bg-gray-100 dark:bg-gray-850 rounded w-48" />
          </div>
        ) : ev ? (
          <>
            <p className="font-bold text-gray-900 dark:text-white text-lg leading-tight">{ev.candidate_name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-550">{ev.candidate_email}</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="text-2xl font-black"
                style={{ color: ev.total_score >= 75 ? '#1D9E75' : ev.total_score >= 50 ? '#EF9F27' : '#E24B4A' }}
              >
                {Math.round(ev.total_score)}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-550">/ 100</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-red-500">Not found</p>
        )}
      </div>

      {!isLoading && ev && (
        <>
          {/* Score breakdown */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Score Breakdown</p>
            {[
              { label: 'Projects', value: ev.project_score, color: '#EF9F27' },
              { label: 'Skills', value: ev.skill_score, color: '#534AB7' },
              { label: 'Education', value: ev.education_score, color: '#1D9E75' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>{label}</span>
                  <span className="font-semibold">{Math.round(value)}</span>
                </div>
                <ScoreBar value={value} color={color} />
              </div>
            ))}
          </div>

          {/* Profile Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Profile</p>
            <div className="text-xs text-gray-600 dark:text-gray-300 flex justify-between">
              <span>Role</span>
              <span className="font-medium truncate max-w-[150px] text-right">{ev.job_role_title}</span>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 flex justify-between">
              <span>GitHub</span>
              {ev.github_url ? (
                <a href={ev.github_url} target="_blank" rel="noopener noreferrer" className="text-[#534AB7] hover:underline font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  View
                </a>
              ) : (
                <span className="text-gray-300 dark:text-gray-650">Not provided</span>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 flex justify-between">
              <span>LinkedIn</span>
              {ev.linkedin_url ? (
                <a href={ev.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[#534AB7] hover:underline font-medium">View</a>
              ) : (
                <span className="text-gray-300 dark:text-gray-650">Not provided</span>
              )}
            </div>
          </div>

          {/* Skill diffs */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Matched Skills <span className="text-gray-300">({allSkillNames.length})</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {/* Skills this candidate has */}
              {allSkillNames.map((s) => {
                const inOther = otherSkills.includes(s)
                return (
                  <span
                    key={s}
                    title={inOther ? 'Both candidates have this skill' : 'Only this candidate has this skill'}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${diffClass(true, inOther)}`}
                  >
                    {s}
                  </span>
                )
              })}
              {/* Skills only the other candidate has (shown greyed out) */}
              {otherSkills.filter((s) => !allSkillNames.includes(s)).map((s) => (
                <span
                  key={s}
                  title="Only the other candidate has this skill"
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border-gray-100 dark:border-gray-700"
                >
                  {s}
                </span>
              ))}
            </div>
            {allSkillNames.length === 0 && (
              <p className="text-xs text-gray-355 dark:text-gray-600">No skills matched</p>
            )}
          </div>

          {/* Sections detected */}
          {ev.resume_sections && ev.resume_sections.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Sections Detected</p>
              <div className="flex flex-wrap gap-1">
                {ev.resume_sections.map((s: any) => (
                  <span key={s.type} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 capitalize">
                    {s.type?.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skill gaps */}
          {ev.skill_gaps && ev.skill_gaps.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Missed Requirements ({ev.skill_gaps.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ev.skill_gaps.map((g) => (
                  <span key={g} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]/50">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CompareResumes() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const idA = Number(searchParams.get('a'))
  const idB = Number(searchParams.get('b'))

  const { data: evA, isLoading: loadA } = useQuery({
    queryKey: ['result', idA],
    queryFn: () => getResultDetail(idA),
    enabled: !!idA,
  })

  const { data: evB, isLoading: loadB } = useQuery({
    queryKey: ['result', idB],
    queryFn: () => getResultDetail(idB),
    enabled: !!idB,
  })

  const { data: compData, isLoading: loadComp, isError: compError, refetch: retryComp } = useQuery({
    queryKey: ['compare-analysis', idA, idB],
    queryFn: () => getCompareAnalysis(idA, idB),
    enabled: !!idA && !!idB,
    retry: 1,
  })

  const skillsA = evA?.skills_matched.map((s) => s.skill_name) ?? []
  const skillsB = evB?.skills_matched.map((s) => s.skill_name) ?? []

  return (
    <div className="p-6 space-y-6 w-full max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Compare Candidates</h1>
          <p className="text-xs text-gray-450 dark:text-gray-500 mt-0.5">Side-by-side intelligence & stack alignment</p>
        </div>
      </div>

      {/* AI Fit Analysis & Quick Metrics Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left 2/3 - AI Fit Analysis */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {loadComp ? (
            <div className="animate-pulse space-y-4 p-6 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl flex flex-col justify-center h-[300px]">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-3" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-5/6" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/5" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-11/12 mt-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
            </div>
          ) : compError ? (
            <div className="p-6 bg-white dark:bg-gray-900 border border-red-100 dark:border-red-900/40 rounded-2xl flex flex-col items-center justify-center gap-3 min-h-[200px] text-center">
              <span className="text-2xl">⚠️</span>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">Analysis failed to load</p>
              <p className="text-xs text-gray-400">The AI comparison service may be temporarily unavailable.</p>
              <button
                onClick={() => retryComp()}
                className="mt-1 px-4 py-1.5 rounded-lg bg-[#534AB7] text-white text-xs font-semibold hover:bg-[#3C3489] transition-colors"
              >
                Retry Analysis
              </button>
            </div>
          ) : compData ? (
            <>
              {/* 🏆 Best Pick Banner */}
              {compData.best_pick_name && (
                <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-gradient-to-r from-[#1D9E75] to-[#0d7a59] text-white shadow-lg shadow-[#1D9E75]/20">
                  <span className="text-2xl">🏆</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-widest font-bold opacity-80 mb-0.5">Best Pick for this Role</p>
                    <p className="text-base font-black leading-tight truncate">{compData.best_pick_name}</p>
                  </div>
                  {compData.score_diff !== undefined && compData.score_diff > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wide font-bold opacity-70">Advantage</p>
                      <p className="text-lg font-black">+{compData.score_diff.toFixed(0)} pts</p>
                    </div>
                  )}
                </div>
              )}

              {/* AI Analysis card */}
              <div className="bg-gradient-to-br from-white to-[#EEEDFE]/10 dark:from-gray-900 dark:to-[#2d2a5a]/5 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white px-6 py-4 border-b border-gray-100 dark:border-gray-800/80 shrink-0">
                  <span className="p-1.5 bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#534AB7] dark:text-[#AFA9EC] rounded-lg">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </span>
                  AI Fit Analysis & Recommendation
                </div>
                <div className="overflow-y-auto max-h-[480px] px-6 py-4 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                  {renderMarkdown(compData.analysis)}
                </div>
              </div>
            </>
          ) : (
            <div className="p-6 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl flex items-center justify-center text-xs text-gray-400 min-h-[180px]">
              <div className="text-center space-y-2">
                <span className="text-2xl block">🔍</span>
                <p>Loading AI comparison analysis…</p>
              </div>
            </div>
          )}
        </div>

        {/* Right 1/3 - Key Metrics Comparison */}
        <div>
          {!loadA && !loadB && evA && evB ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 flex flex-col justify-between space-y-5">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#534AB7] dark:text-[#AFA9EC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                  </svg>
                  Profile Comparison
                </h3>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Quick side-by-side metrics overview</p>
              </div>

              <div className="space-y-4 flex-1 justify-center flex flex-col py-2">
                {/* Fit Score */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500 dark:text-gray-400">Fit Score</span>
                    <span className="text-[11px] text-gray-400">
                      <span className="text-[#534AB7] dark:text-[#AFA9EC] font-semibold">{Math.round(evA.total_score)}</span> vs <span className="text-[#EF9F27] font-semibold">{Math.round(evB.total_score)}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-[#534AB7] h-full" style={{ width: `${evA.total_score / (evA.total_score + evB.total_score || 1) * 100}%` }} />
                      <div className="bg-[#EF9F27] h-full" style={{ width: `${evB.total_score / (evA.total_score + evB.total_score || 1) * 100}%` }} />
                    </div>
                  </div>
                </div>

                {/* Matched Skills Count */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500 dark:text-gray-400">Matched Skills</span>
                    <span className="text-[11px] text-gray-400">
                      <span className="text-[#534AB7] dark:text-[#AFA9EC] font-semibold">{skillsA.length}</span> vs <span className="text-[#EF9F27] font-semibold">{skillsB.length}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-[#534AB7] h-full" style={{ width: `${(skillsA.length / Math.max(1, skillsA.length + skillsB.length)) * 100}%` }} />
                      <div className="bg-[#EF9F27] h-full" style={{ width: `${(skillsB.length / Math.max(1, skillsA.length + skillsB.length)) * 100}%` }} />
                    </div>
                  </div>
                </div>

                {/* Missed Requirements Count */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500 dark:text-gray-400">Skill Gaps</span>
                    <span className="text-[11px] text-gray-400">
                      <span className="text-[#534AB7] dark:text-[#AFA9EC] font-semibold">{evA.skill_gaps?.length || 0}</span> vs <span className="text-[#EF9F27] font-semibold">{evB.skill_gaps?.length || 0}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-[#534AB7] h-full" style={{ width: `${((evA.skill_gaps?.length || 0) / Math.max(1, (evA.skill_gaps?.length || 0) + (evB.skill_gaps?.length || 0))) * 100}%` }} />
                      <div className="bg-[#EF9F27] h-full" style={{ width: `${((evB.skill_gaps?.length || 0) / Math.max(1, (evA.skill_gaps?.length || 0) + (evB.skill_gaps?.length || 0))) * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* GitHub comparison row */}
              {(compData?.github_a || compData?.github_b) && (
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">GitHub Activity</p>
                  <div className="space-y-1">
                    <div className="flex items-start gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#534AB7] mt-1 shrink-0" />
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{evA.candidate_name.split(' ')[0]}:</span>{' '}
                        {compData?.github_a ?? 'No data'}
                      </p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#EF9F27] mt-1 shrink-0" />
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{evB.candidate_name.split(' ')[0]}:</span>{' '}
                        {compData?.github_b ?? 'No data'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                Colored segments reflect relative weight distribution between Candidate A (<span className="text-[#534AB7] dark:text-[#AFA9EC] font-bold">Purple</span>) and Candidate B (<span className="text-[#EF9F27] font-bold">Orange</span>)
              </div>
            </div>
          ) : (
            <div className="animate-pulse space-y-4 p-6 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl flex flex-col justify-center min-h-[200px]">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
              <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-full" />
            </div>
          )}
        </div>
      </div>

      {/* Technical Skills Alignment Center (Common vs Unique Skills) */}
      {!loadA && !loadB && evA && evB && compData && (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 space-y-5 shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-[#1D9E75]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Technical Skills Alignment Center
            </h3>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              Visual stack audit of shared technologies vs distinctive capabilities
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Shared Tech Stack */}
            <div className="bg-[#E1F5EE]/20 dark:bg-[#085041]/5 border border-[#5DCAA5]/20 p-4 rounded-xl space-y-3 flex flex-col">
              <div className="flex justify-between items-center pb-2 border-b border-[#5DCAA5]/20">
                <span className="text-xs font-bold text-[#085041] dark:text-[#5DCAA5] uppercase tracking-wide">Shared Tech Stack</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E1F5EE] text-[#085041] dark:bg-[#085041]/30 dark:text-[#5DCAA5] border border-[#5DCAA5]/40 shrink-0">
                  {compData.shared_count}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 flex-1 align-content-start">
                {compData.common_skills.map((s) => (
                  <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5]/20 dark:bg-[#085041]/20 dark:text-[#5DCAA5]">
                    {s}
                  </span>
                ))}
                {compData.shared_count === 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic py-2">No shared skills matched</span>
                )}
              </div>
            </div>

            {/* Unique to Candidate A */}
            <div className="bg-[#EEEDFE]/20 dark:bg-[#2d2a5a]/5 border border-[#AFA9EC]/20 p-4 rounded-xl space-y-3 flex flex-col">
              <div className="flex justify-between items-center pb-2 border-b border-[#AFA9EC]/20">
                <span className="text-xs font-bold text-[#3C3489] dark:text-[#AFA9EC] uppercase tracking-wide truncate max-w-[80%]">
                  Only in {evA.candidate_name.split(' ')[0]}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] dark:bg-[#2d2a5a]/30 dark:text-[#AFA9EC] border border-[#AFA9EC]/40 shrink-0">
                  {compData.only_a_count}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 flex-1 align-content-start">
                {compData.only_a.map((s) => (
                  <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489] border border-[#AFA9EC]/20 dark:bg-[#2d2a5a]/20 dark:text-[#AFA9EC]">
                    {s}
                  </span>
                ))}
                {compData.only_a_count === 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-555 italic py-2">No unique skills matched</span>
                )}
              </div>
            </div>

            {/* Unique to Candidate B */}
            <div className="bg-[#FAEEDA]/20 dark:bg-[#633806]/5 border border-[#EF9F27]/20 p-4 rounded-xl space-y-3 flex flex-col">
              <div className="flex justify-between items-center pb-2 border-b border-[#EF9F27]/20">
                <span className="text-xs font-bold text-[#633806] dark:text-[#EF9F27] uppercase tracking-wide truncate max-w-[80%]">
                  Only in {evB.candidate_name.split(' ')[0]}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#633806] dark:bg-[#633806]/30 dark:text-[#EF9F27] border border-[#EF9F27]/40 shrink-0">
                  {compData.only_b_count}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 flex-1 align-content-start">
                {compData.only_b.map((s) => (
                  <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#633806] border border-[#EF9F27]/20 dark:bg-[#633806]/20 dark:text-[#EF9F27]">
                    {s}
                  </span>
                ))}
                {compData.only_b_count === 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-555 italic py-2">No unique skills matched</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-column detailed candidate profiles */}
      <div className="flex flex-col md:flex-row gap-6 pt-2">
        <CandidateColumn ev={evA} isLoading={loadA} label="Candidate A" otherSkills={skillsB} />
        {/* Divider */}
        <div className="hidden md:block w-px bg-gradient-to-b from-transparent via-gray-250 dark:via-gray-800 to-transparent shrink-0" />
        <CandidateColumn ev={evB} isLoading={loadB} label="Candidate B" otherSkills={skillsA} />
      </div>
    </div>
  )
}
