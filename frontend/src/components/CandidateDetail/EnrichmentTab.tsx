import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getEnrichment, enrichGitHub, enrichLinkedIn, enrichPortfolio } from '../../api/client'
import type { ConsistencyFlag, GitHubSummary, PortfolioSummary } from '../../api/client'

interface Props {
  candidateId: number
  jobRoleId: number
  portfolioUrl?: string | null
  initialGhUrl?: string
  initialLiUrl?: string
}

function FlagRow({ flag }: { flag: ConsistencyFlag }) {
  const styles: Record<string, string> = {
    high:   'bg-[#FCEBEB] border-[#E24B4A] text-[#791F1F]',
    medium: 'bg-[#FAEEDA] border-[#EF9F27] text-[#633806]',
    low:    'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles[flag.severity] ?? styles.low}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold capitalize">{flag.severity}</span>
        <span className="text-xs opacity-60">{flag.flag_type.replace('_', ' ')}</span>
      </div>
      <p>{flag.recruiter_note}</p>
    </div>
  )
}

function GitHubSkillVerification({ flags }: { flags: ConsistencyFlag[] }) {
  const flag = flags.find((f) => f.flag_type === 'github_skill_gap')
  if (!flag || !flag.resume_value) return null

  const unverified = flag.resume_value.split(',').map((s) => s.trim()).filter(Boolean)
  const severityStyles = {
    high: { badge: 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]', label: 'High concern' },
    medium: { badge: 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]', label: 'Needs review' },
    low: { badge: 'bg-gray-100 text-gray-600 border-gray-300', label: 'Minor' },
  }
  const style = severityStyles[flag.severity as keyof typeof severityStyles] ?? severityStyles.low

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-4 mt-2">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Skill Verification</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${style.badge}`}>
          {style.label}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        The following skills claimed on the resume have no evidence in GitHub repositories:
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {unverified.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]/50"
          >
            <span className="opacity-60">✗</span> {s}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">{flag.recruiter_note}</p>
    </div>
  )
}

function GitHubPanel({ summary }: { summary: GitHubSummary }) {
  const activityColor = summary.activity_score >= 70 ? '#1D9E75' : summary.activity_score >= 40 ? '#EF9F27' : '#E24B4A'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Activity</div>
        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-2 rounded-full" style={{ width: `${summary.activity_score}%`, backgroundColor: activityColor }} />
        </div>
        <span className="text-sm font-semibold shrink-0" style={{ color: activityColor }}>{summary.activity_score}/100</span>
      </div>
      <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
        <span><span className="font-semibold text-gray-800 dark:text-gray-100">{summary.public_repos}</span> repos</span>
        <span className="font-semibold text-gray-700 dark:text-gray-200">{summary.username}</span>
      </div>
      {summary.languages.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Top Languages</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.languages.slice(0, 8).map((l) => (
              <span key={l.language} className="text-xs px-2.5 py-1 rounded-full border bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600">
                {l.language} <span className="text-gray-400">×{l.repo_count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {summary.inferred_skills.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Inferred Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.inferred_skills.map((s) => (
              <span key={s.name} className="text-xs px-2.5 py-1 rounded-full border bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]/50">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {summary.relevant_repos.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Relevant Repos</p>
          <div className="space-y-2">
            {summary.relevant_repos.slice(0, 5).map((r) => (
              <div key={r.name} className="flex items-start gap-2">
                <span className="text-xs font-mono text-[#534AB7] dark:text-[#AFA9EC] shrink-0">{r.name}</span>
                {r.description && <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.description}</span>}
                {r.stars > 0 && <span className="text-xs text-gray-400 ml-auto shrink-0">★{r.stars}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function EnrichmentTab({ candidateId, jobRoleId, portfolioUrl, initialGhUrl, initialLiUrl }: Props) {
  const [ghUrl, setGhUrl] = useState(initialGhUrl ?? '')
  const [liUrl, setLiUrl] = useState(initialLiUrl ?? '')

  const { data: enrichData, refetch: refetchEnrich } = useQuery({
    queryKey: ['enrichment', candidateId],
    queryFn: () => getEnrichment(candidateId),
    enabled: !!candidateId,
  })

  const ghMut = useMutation({
    mutationFn: () => enrichGitHub(candidateId, ghUrl || undefined, jobRoleId),
    onSuccess: () => refetchEnrich(),
  })
  const liMut = useMutation({
    mutationFn: () => enrichLinkedIn(candidateId, liUrl || undefined),
    onSuccess: () => refetchEnrich(),
  })
  const portfolioMut = useMutation({
    mutationFn: () => enrichPortfolio(candidateId),
    onSuccess: () => refetchEnrich(),
  })

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {enrichData?.needs_manual_review && (
        <div className="flex items-center gap-3 bg-[#FCEBEB] border border-[#E24B4A] rounded-xl px-4 py-3 text-sm text-[#791F1F]">
          <span className="font-semibold">Manual review required</span>
          <span>— significant discrepancies detected between resume and external sources.</span>
        </div>
      )}

      {/* GitHub */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">GitHub Analysis</h3>
          {enrichData?.enrichment_sources?.includes('github') && (
            <span className="text-xs bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5] px-2 py-0.5 rounded-full">Enriched</span>
          )}
        </div>
        <div className="flex gap-2">
          <input type="text"
            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
            placeholder={enrichData?.github_url ?? 'github.com/username'}
            value={ghUrl}
            onChange={(e) => setGhUrl(e.target.value)}
          />
          <button onClick={() => ghMut.mutate()} disabled={ghMut.isPending}
            className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors">
            {ghMut.isPending ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {ghMut.isError && <p className="text-xs text-[#791F1F]">Failed: {(ghMut.error as any)?.response?.data?.detail ?? 'Unknown error'}</p>}
        {enrichData?.github_summary && !enrichData.github_summary.error && (
          <GitHubPanel summary={enrichData.github_summary} />
        )}
        {enrichData?.github_summary && !enrichData.github_summary.error && (enrichData.consistency_flags ?? []).some((f) => f.flag_type === 'github_skill_gap') && (
          <GitHubSkillVerification flags={enrichData.consistency_flags as ConsistencyFlag[]} />
        )}
        {enrichData?.github_summary?.error && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{enrichData.github_summary.error}</p>
        )}
      </div>

      {/* LinkedIn */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">LinkedIn Enrichment</h3>
          {enrichData?.enrichment_sources?.includes('linkedin') && (
            <span className="text-xs bg-[#EEEDFE] text-[#3C3489] border border-[#AFA9EC] px-2 py-0.5 rounded-full">Enriched</span>
          )}
        </div>
        <div className="flex gap-2">
          <input type="text"
            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
            placeholder={enrichData?.linkedin_url ?? 'linkedin.com/in/username'}
            value={liUrl}
            onChange={(e) => setLiUrl(e.target.value)}
          />
          <button onClick={() => liMut.mutate()} disabled={liMut.isPending}
            className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors">
            {liMut.isPending ? 'Enriching…' : 'Enrich'}
          </button>
        </div>
        {liMut.isError && <p className="text-xs text-[#791F1F]">Failed: {(liMut.error as any)?.response?.data?.detail ?? 'Unknown error'}</p>}
        {(liMut.data?.error || (enrichData?.enrichment_sources?.includes('linkedin') && !enrichData?.linkedin_data)) && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-medium">LinkedIn access restricted</p>
              <p className="opacity-80 mt-0.5">LinkedIn blocks automated profile access. The URL has been saved — review the profile manually.</p>
              {(enrichData?.linkedin_url || liUrl) && (
                <a href={enrichData?.linkedin_url || liUrl} target="_blank" rel="noopener noreferrer"
                  className="underline opacity-80 hover:opacity-100 mt-1 block">
                  Open profile →
                </a>
              )}
            </div>
          </div>
        )}
        {enrichData?.linkedin_data && (
          <div>
            {((enrichData.linkedin_data as any).linkedin_skills ?? []).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">LinkedIn Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {((enrichData.linkedin_data as any).linkedin_skills as string[]).map((s) => (
                    <span key={s} className="text-xs px-2.5 py-1 rounded-full border bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Portfolio */}
      {portfolioUrl && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Portfolio Analysis</h3>
            {enrichData?.enrichment_sources?.includes('portfolio') && (
              <span className="text-xs bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5] px-2 py-0.5 rounded-full">Analysed</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <a href={portfolioUrl} target="_blank" rel="noopener noreferrer"
              className="text-sm text-[#534AB7] hover:underline truncate flex-1">{portfolioUrl}</a>
            <button onClick={() => portfolioMut.mutate()} disabled={portfolioMut.isPending}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors shrink-0">
              {portfolioMut.isPending ? 'Analysing…' : 'Analyse'}
            </button>
          </div>
          {portfolioMut.isError && <p className="text-xs text-[#791F1F]">Analysis failed</p>}
          {enrichData?.portfolio_summary && (() => {
            const ps = enrichData.portfolio_summary as PortfolioSummary
            return (
              <div className="space-y-3">
                {ps.title && <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{ps.title}</p>}
                {ps.description && <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{ps.description}</p>}
                {ps.tech_stack.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Detected Tech Stack</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ps.tech_stack.map((t) => (
                        <span key={t} className="text-xs px-2.5 py-1 rounded-full border bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]/50">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {ps.project_snippets.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Project Sections</p>
                    <ul className="space-y-1">
                      {ps.project_snippets.map((s, i) => (
                        <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
                          <span className="text-gray-300 dark:text-gray-600 shrink-0 mt-0.5">›</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {ps.error && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">{ps.error}</p>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Consistency flags — excludes github_skill_gap which is shown in the GitHub panel */}
      {(enrichData?.consistency_flags ?? []).filter((f) => f.flag_type !== 'github_skill_gap').length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Review Flags</h3>
          {(enrichData!.consistency_flags as ConsistencyFlag[])
            .filter((f) => f.flag_type !== 'github_skill_gap')
            .map((flag, i) => (
              <FlagRow key={i} flag={flag} />
            ))}
        </div>
      )}
    </div>
  )
}
