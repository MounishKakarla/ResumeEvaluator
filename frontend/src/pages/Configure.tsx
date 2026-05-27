import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSkills,
  getJobRoles,
  createSkill,
  deleteSkill,
  createJobRole,
  updateJobRole,
  deleteJobRole,
  updateRequirements,
  setIntakePause,
  extractJdText,
  extractSkillsFromJd,
  getSystemStatus,
  testSmtpConnection,
} from '../api/client'
import type { JobRole, JobRoleRequirement, Skill } from '../api/client'
import EmailTemplatesPanel from '../components/Configure/EmailTemplatesPanel'
import { useAppStore } from '../store/useAppStore'
import SkillTag from '../components/SkillTag'

const CATEGORIES = ['Programming', 'Framework', 'Database', 'Cloud', 'DevOps', 'ML/AI', 'Backend', 'Frontend', 'Other']

function SmtpTestButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)

  async function test() {
    setLoading(true)
    setResult(null)
    try {
      setResult(await testSmtpConnection())
    } catch {
      setResult({ ok: false, error: 'Request failed.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={test}
        disabled={loading}
        className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-gray-600 dark:text-gray-300"
      >
        {loading ? 'Sending…' : 'Send Test Email'}
      </button>
      {result && (
        <span className={`text-xs font-medium ${result.ok ? 'text-[#1D9E75]' : 'text-[#E24B4A]'}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </div>
  )
}

export default function Configure() {
  const queryClient = useQueryClient()
  const { selectedJobRoleId, setJobRole } = useAppStore()

  // ── Role form state ─────────────────────────────────────────────────────
  const [roleTitle, setRoleTitle] = useState('')
  const [minExp, setMinExp] = useState(0)
  const [requiredSkillIds, setRequiredSkillIds] = useState<number[]>([])
  const [requiredSkillNames, setRequiredSkillNames] = useState<string[]>([])
  const [niceToHaveSkillIds, setNiceToHaveSkillIds] = useState<number[]>([])
  const [niceToHaveSkillNames, setNiceToHaveSkillNames] = useState<string[]>([])
  const [weights, setWeights] = useState({ projects: 50, skills: 30, education: 20 })
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErrMsg, setSaveErrMsg] = useState<string | null>(null)

  // ── Requirements state ──────────────────────────────────────────────────
  type ReqDraft = Omit<JobRoleRequirement, 'id'>
  const [requirements, setRequirements] = useState<ReqDraft[]>([])
  const [reqSaveMsg, setReqSaveMsg] = useState<string | null>(null)
  const [expandedReqDesc, setExpandedReqDesc] = useState<Set<number>>(new Set())

  // ── Auto-pause / email state ─────────────────────────────────────────────
  const [shortlistTarget, setShortlistTarget] = useState<number | ''>('')
  const [minFitScore, setMinFitScore] = useState<number | ''>('')
  const [tfidfThreshold, setTfidfThreshold] = useState<number | ''>(0)
  const [intakePaused, setIntakePaused] = useState(false)
  const [autoEmailEnabled, setAutoEmailEnabled] = useState(true)

  // ── Auto-save refs ──────────────────────────────────────────────────────
  const isLoadingRoleRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── JD / Education filter state ─────────────────────────────────────────
  const [jdDescription, setJdDescription] = useState('')
  const [jdUploading, setJdUploading] = useState(false)
  const [jdExtractMsg, setJdExtractMsg] = useState<string | null>(null)
  const [minDegree, setMinDegree] = useState<'bachelor' | 'master' | 'phd' | 'doctorate' | ''>('')
  const [preferredMajors, setPreferredMajors] = useState<string[]>([])
  const [majorInput, setMajorInput] = useState('')

  // ── Experience level filter state ────────────────────────────────────────
  const [filterExpLevels, setFilterExpLevels] = useState<string[]>([])
  const [minGradYear, setMinGradYear] = useState<number | ''>('')
  const [maxGradYear, setMaxGradYear] = useState<number | ''>('')
  const [isEntryLevel, setIsEntryLevel] = useState(false)
  const [requireGithub, setRequireGithub] = useState(false)


  // ── Skill browser state ─────────────────────────────────────────────────
  const [skillSearch, setSkillSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newTaxSkillName, setNewTaxSkillName] = useState('')
  const [newTaxCategory, setNewTaxCategory] = useState('Other')

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: skillsData } = useQuery({
    queryKey: ['skills', skillSearch, categoryFilter],
    queryFn: () => getSkills({ search: skillSearch || undefined, category: categoryFilter || undefined, limit: 100 }),
  })

  const { data: jobRoles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['jobRoles'],
    queryFn: getJobRoles,
  })

  const { data: systemStatus } = useQuery({
    queryKey: ['systemStatus'],
    queryFn: getSystemStatus,
    staleTime: 60_000,
  })

  const role = useAppStore((s) => s.role)
  const isAdmin = role === 'admin'


  const [rolesInitialized, setRolesInitialized] = useState(false)
  useEffect(() => {
    if ((jobRoles as JobRole[]).length === 0 || rolesInitialized) return
    setRolesInitialized(true)
    const roles = jobRoles as JobRole[]
    const target = selectedJobRoleId ? roles.find((r) => r.id === selectedJobRoleId) : undefined
    loadRole(target ?? roles[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRoles])

  function loadRole(role: JobRole) {
    isLoadingRoleRef.current = true
    setJobRole(role.id)
    setRoleTitle(role.title)
    setMinExp(role.min_experience)
    const reqIds: number[] = [], nthIds: number[] = [], reqNames: string[] = [], nthNames: string[] = []
    ;(role.skill_ids ?? []).forEach((id, i) => {
      const name = (role.skill_names ?? [])[i] ?? ''
      const isReq = (role.skill_required_flags ?? [])[i] ?? true
      if (isReq) { reqIds.push(id); reqNames.push(name) }
      else { nthIds.push(id); nthNames.push(name) }
    })
    setRequiredSkillIds(reqIds)
    setRequiredSkillNames(reqNames)
    setNiceToHaveSkillIds(nthIds)
    setNiceToHaveSkillNames(nthNames)
    setWeights({
      projects: role.weight_projects,
      skills: role.weight_skills,
      education: role.weight_education,
    })
    setRequirements(
      (role.requirements ?? []).map(({ label, weight, req_type, description, min_years }) => ({
        label, weight, req_type, description, min_years,
      }))
    )
    setExpandedReqDesc(new Set())
    setJdDescription(role.description ?? '')
    setMinDegree((role.min_degree as typeof minDegree) ?? '')
    setPreferredMajors(role.preferred_majors ?? [])
    setShortlistTarget(role.shortlist_target ?? '')
    setMinFitScore(role.min_fit_score ?? '')
    setTfidfThreshold(
      role.tfidf_threshold != null && role.tfidf_threshold > 0
        ? Number((role.tfidf_threshold * 100).toFixed(1))
        : 0
    )
    setIntakePaused(role.intake_paused ?? false)
    setAutoEmailEnabled(role.auto_email_enabled ?? true)
    setFilterExpLevels(role.filter_experience_levels ?? [])
    setMinGradYear(role.min_graduation_year ?? '')
    setMaxGradYear(role.max_graduation_year ?? '')
    setIsEntryLevel(role.is_entry_level ?? false)
    setRequireGithub(role.require_github ?? false)
    setTimeout(() => { isLoadingRoleRef.current = false }, 0)
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  const createSkillMut = useMutation({
    mutationFn: ({ name, cat }: { name: string; cat: string }) => createSkill(name, cat),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const deleteSkillMut = useMutation({
    mutationFn: (id: number) => deleteSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const saveRoleMut = useMutation({
    mutationFn: () => {
      const payload = {
        title: roleTitle,
        min_experience: minExp,
        cosine_threshold: 0.8,
        weight_projects: weights.projects,
        weight_skills: weights.skills,
        weight_education: weights.education,
        skill_ids: [...requiredSkillIds, ...niceToHaveSkillIds],
        skill_required_flags: [
          ...requiredSkillIds.map(() => true),
          ...niceToHaveSkillIds.map(() => false),
        ],
        description: jdDescription || null,
        min_degree: minDegree || null,
        preferred_majors: preferredMajors,
        shortlist_target: shortlistTarget !== '' ? Number(shortlistTarget) : null,
        min_fit_score: minFitScore !== '' ? Number(minFitScore) : null,
        tfidf_threshold: tfidfThreshold !== '' ? Number(tfidfThreshold) / 100 : 0,
        filter_experience_levels: filterExpLevels,
        auto_email_enabled: autoEmailEnabled,
        min_graduation_year: minGradYear !== '' ? Number(minGradYear) : null,
        max_graduation_year: maxGradYear !== '' ? Number(maxGradYear) : null,
        is_entry_level: isEntryLevel,
        require_github: requireGithub,
      }
      if (selectedJobRoleId) return updateJobRole(selectedJobRoleId, payload)
      return createJobRole(payload)
    },
    onSuccess: (role) => {
      setSaveErrMsg(null)
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      setJobRole(role.id)
      setSaveMsg('Saved successfully')
      setTimeout(() => setSaveMsg(null), 2000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Unknown error'
      setSaveErrMsg(typeof detail === 'string' ? detail : JSON.stringify(detail))
    },
  })

  const saveReqMut = useMutation({
    mutationFn: () => {
      if (!selectedJobRoleId) throw new Error('No job role selected')
      return updateRequirements(selectedJobRoleId, requirements)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      setReqSaveMsg('Requirements saved')
      setTimeout(() => setReqSaveMsg(null), 2000)
    },
  })

  const extractSkillsMut = useMutation({
    mutationFn: (text: string) => extractSkillsFromJd(text),
    onSuccess: (result) => {
      const addedReqIds: number[] = [], addedReqNames: string[] = []
      const addedNthIds: number[] = [], addedNthNames: string[] = []
      result.skill_ids.forEach((id, i) => {
        const name = result.skill_names[i]
        const isReq = result.skill_required?.[i] ?? true
        const alreadyAdded = requiredSkillIds.includes(id) || niceToHaveSkillIds.includes(id)
        if (alreadyAdded) return
        if (isReq) { addedReqIds.push(id); addedReqNames.push(name) }
        else { addedNthIds.push(id); addedNthNames.push(name) }
      })
      const totalAdded = addedReqIds.length + addedNthIds.length
      if (totalAdded === 0) {
        setJdExtractMsg('No new skills found in JD')
      } else {
        if (addedReqIds.length > 0) {
          setRequiredSkillIds((prev) => [...prev, ...addedReqIds])
          setRequiredSkillNames((prev) => [...prev, ...addedReqNames])
        }
        if (addedNthIds.length > 0) {
          setNiceToHaveSkillIds((prev) => [...prev, ...addedNthIds])
          setNiceToHaveSkillNames((prev) => [...prev, ...addedNthNames])
        }
        setJdExtractMsg(`${totalAdded} skill${totalAdded !== 1 ? 's' : ''} added from JD`)
      }
      setTimeout(() => setJdExtractMsg(null), 3000)
    },
    onError: () => setJdExtractMsg('Failed to extract skills'),
  })

  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => setIntakePause(selectedJobRoleId!, paused),
    onSuccess: (role) => {
      setIntakePaused(role.intake_paused)
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
    },
  })

  const deleteRoleMut = useMutation({
    mutationFn: (id: number) => deleteJobRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      setJobRole(null as unknown as number)
      setRoleTitle('')
      setMinExp(0)
      setRequiredSkillIds([])
      setRequiredSkillNames([])
      setNiceToHaveSkillIds([])
      setNiceToHaveSkillNames([])
      setWeights({ projects: 50, skills: 30, education: 20 })
      setJdDescription('')
      setMinDegree('')
      setPreferredMajors([])
      setShortlistTarget('')
      setMinFitScore('')
      setTfidfThreshold(0)
      setFilterExpLevels([])
      setMinGradYear('')
      setMaxGradYear('')
      setIntakePaused(false)
      setAutoEmailEnabled(true)
      setRequirements([])
      setRequireGithub(false)
    },
  })

  // ── Auto-save weights (debounced 800 ms) ────────────────────────────────
  useEffect(() => {
    if (isLoadingRoleRef.current || !selectedJobRoleId || !roleTitle) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveRoleMut.mutate(), 800)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights.projects, weights.skills, weights.education])

  // ── Auto-save skills (debounced 300 ms) ─────────────────────────────────
  useEffect(() => {
    if (isLoadingRoleRef.current || !selectedJobRoleId || !roleTitle) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveRoleMut.mutate(), 300)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredSkillIds, niceToHaveSkillIds])

  // ── Weight auto-adjust ───────────────────────────────────────────────────
  // When one slider moves, the other two redistribute proportionally so the
  // sum stays at 100, keeping the Save button always enabled.
  function handleWeightChange(changed: 'projects' | 'skills' | 'education', val: number) {
    const clamped = Math.max(0, Math.min(100, val))
    const remaining = 100 - clamped
    const others = (['projects', 'skills', 'education'] as const).filter((k) => k !== changed)
    const [keyA, keyB] = others
    const sumOthers = weights[keyA] + weights[keyB]
    let newA: number, newB: number
    if (sumOthers > 0) {
      newA = Math.round(remaining * weights[keyA] / sumOthers)
      newB = remaining - newA
    } else {
      newA = Math.floor(remaining / 2)
      newB = remaining - newA
    }
    setWeights({ [changed]: clamped, [keyA]: Math.max(0, newA), [keyB]: Math.max(0, newB) } as typeof weights)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function toggleSkill(skill: Skill) {
    const reqIdx = requiredSkillIds.indexOf(skill.id)
    const nthIdx = niceToHaveSkillIds.indexOf(skill.id)
    if (reqIdx !== -1) {
      // Required → Nice-to-have
      setRequiredSkillIds((prev) => prev.filter((_, i) => i !== reqIdx))
      setRequiredSkillNames((prev) => prev.filter((_, i) => i !== reqIdx))
      setNiceToHaveSkillIds((prev) => [...prev, skill.id])
      setNiceToHaveSkillNames((prev) => [...prev, skill.name])
    } else if (nthIdx !== -1) {
      // Nice-to-have → Remove
      setNiceToHaveSkillIds((prev) => prev.filter((_, i) => i !== nthIdx))
      setNiceToHaveSkillNames((prev) => prev.filter((_, i) => i !== nthIdx))
    } else {
      // Unselected → Required
      setRequiredSkillIds((prev) => [...prev, skill.id])
      setRequiredSkillNames((prev) => [...prev, skill.name])
    }
  }

  function removeRequiredSkill(idx: number) {
    setRequiredSkillIds((prev) => prev.filter((_, i) => i !== idx))
    setRequiredSkillNames((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeNiceToHaveSkill(idx: number) {
    setNiceToHaveSkillIds((prev) => prev.filter((_, i) => i !== idx))
    setNiceToHaveSkillNames((prev) => prev.filter((_, i) => i !== idx))
  }

  const filteredSkills: Skill[] = skillsData?.items ?? []

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40'

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Sidebar ─────────────────────────────────────── */}
      <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-y-auto p-4 gap-5">
        {/* Job role selector */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Job Role
              <span className="ml-1 font-normal normal-case text-gray-400">({(jobRoles as JobRole[]).length})</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setJobRole(null as unknown as number)
                  setRoleTitle('')
                  setMinExp(0)
                  setRequiredSkillIds([])
                  setRequiredSkillNames([])
                  setNiceToHaveSkillIds([])
                  setNiceToHaveSkillNames([])
                  setWeights({ projects: 50, skills: 30, education: 20 })
                  setJdDescription('')
                  setMinDegree('')
                  setPreferredMajors([])
                  setShortlistTarget('')
                  setMinFitScore('')
                  setTfidfThreshold(0)
                  setFilterExpLevels([])
                  setMinGradYear('')
                  setMaxGradYear('')
                  setIntakePaused(false)
                  setRequirements([])
                }}
                className="text-xs text-[#534AB7] hover:text-[#3C3489] font-medium flex items-center gap-1"
                title="Create a new job role"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                </svg>
                New
              </button>
              {selectedJobRoleId && (
                <button
                  onClick={() => {
                    if (confirm(`Delete "${roleTitle}"? This will remove all associated evaluations.`)) {
                      deleteRoleMut.mutate(selectedJobRoleId)
                    }
                  }}
                  disabled={deleteRoleMut.isPending}
                  className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 disabled:opacity-50"
                  title="Delete this job role"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
          </div>
          <select
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
            value={selectedJobRoleId ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value)
              const role = (jobRoles as JobRole[]).find((r) => r.id === id)
              if (role) loadRole(role)
            }}
          >
            {(jobRoles as JobRole[]).length === 0 && <option value="">No roles yet — create one</option>}
            {(jobRoles as JobRole[]).map((r) => (
              <option key={r.id} value={r.id}>{r.title}{r.intake_paused ? ' (paused)' : ''}</option>
            ))}
          </select>
        </div>

        {/* Required Skills */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Required Skills ({requiredSkillIds.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {requiredSkillNames.map((name, idx) => (
              <SkillTag key={requiredSkillIds[idx]} label={name} onRemove={() => removeRequiredSkill(idx)} variant="purple" />
            ))}
            {requiredSkillNames.length === 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">Click skills below to add</span>
            )}
          </div>
        </div>

        {/* Nice-to-Have Skills */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Nice to Have ({niceToHaveSkillIds.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {niceToHaveSkillNames.map((name, idx) => (
              <SkillTag key={niceToHaveSkillIds[idx]} label={name} onRemove={() => removeNiceToHaveSkill(idx)} variant="amber" />
            ))}
            {niceToHaveSkillNames.length === 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">Optional preferred skills</span>
            )}
          </div>
        </div>

        {/* Scoring Weights */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Scoring Weights
          </p>
          {(
            [
              { key: 'projects' as const, label: 'Projects', color: '#534AB7' },
              { key: 'skills' as const, label: 'Skills', color: '#1D9E75' },
              { key: 'education' as const, label: 'Education', color: '#EF9F27' },
            ]
          ).map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-600 dark:text-gray-400 w-20 shrink-0">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={weights[key]}
                onChange={(e) => handleWeightChange(key, Number(e.target.value))}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 text-right"
              />
              <span className="text-xs font-semibold shrink-0" style={{ color }}>%</span>
            </div>
          ))}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Values auto-adjust to sum 100%</p>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {rolesLoading && (
          <div className="animate-pulse space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
                <div className="grid grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-24" />
                      <div className="h-9 bg-gray-100 dark:bg-gray-700 rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Active Job Role Card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">
            {selectedJobRoleId ? 'Edit Job Role' : 'Create Job Role'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Role Title</label>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className={inputCls}
                placeholder="e.g. Senior Backend Engineer"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Min. Experience (yrs)</label>
              <input
                type="number"
                min={0}
                value={minExp}
                onChange={(e) => setMinExp(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>

          {/* Experience Level Filter */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Candidate Level Filter
              <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(only evaluate selected levels — leave empty to allow all)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(['junior', 'mid', 'senior', 'executive'] as const).map((lvl) => {
                const checked = filterExpLevels.includes(lvl)
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() =>
                      setFilterExpLevels(
                        checked
                          ? filterExpLevels.filter((l) => l !== lvl)
                          : [...filterExpLevels, lvl]
                      )
                    }
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      checked
                        ? 'bg-[#534AB7] text-white border-[#534AB7]'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-[#534AB7]'
                    }`}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                )
              })}
              {filterExpLevels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterExpLevels([])}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Entry / Fresher / Intern Role Toggle */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Scoring Mode
              <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(entry-level scoring rewards design-oriented projects and skips recency decay)</span>
            </label>
            <button
              type="button"
              onClick={() => setIsEntryLevel(!isEntryLevel)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isEntryLevel
                  ? 'bg-[#534AB7] text-white border-[#534AB7]'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-[#534AB7]'
              }`}
            >
              Entry / Fresher / Intern
            </button>
          </div>

          {/* GitHub Prime Requirement Toggle */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              GitHub Requirement
              <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(candidates missing a GitHub profile are flagged with a "Missed Requirement: GitHub" badge)</span>
            </label>
            <button
              type="button"
              onClick={() => setRequireGithub(!requireGithub)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                requireGithub
                  ? 'bg-[#534AB7] text-white border-[#534AB7]'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-[#534AB7]'
              }`}
            >
              {requireGithub ? '✓ GitHub Required' : 'GitHub Optional'}
            </button>
          </div>

          {/* Graduation Year Range Filter */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Graduation Year Range
              <span className="ml-1 font-normal text-gray-400">(resumes outside this range are filtered before evaluation — leave blank for no restriction)</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">From</span>
                <input
                  type="number"
                  min={1980}
                  max={2040}
                  step={1}
                  className={`${inputCls} w-28`}
                  placeholder="e.g. 2025"
                  value={minGradYear}
                  onChange={(e) => setMinGradYear(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">To</span>
                <input
                  type="number"
                  min={1980}
                  max={2040}
                  step={1}
                  className={`${inputCls} w-28`}
                  placeholder="e.g. 2026"
                  value={maxGradYear}
                  onChange={(e) => setMaxGradYear(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              {(minGradYear !== '' || maxGradYear !== '') && (
                <button
                  type="button"
                  onClick={() => { setMinGradYear(''); setMaxGradYear('') }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {minGradYear !== '' && maxGradYear !== '' && Number(minGradYear) > Number(maxGradYear) && (
              <p className="text-xs text-[#E24B4A] mt-1">From year must be ≤ To year.</p>
            )}
          </div>

          {/* Auto-Pause Settings */}
          <div className="mt-5 border-t border-gray-100 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Auto-Pause Settings
              </p>
              {selectedJobRoleId && (
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    intakePaused ? 'bg-[#FCEBEB] text-[#791F1F]' : 'bg-[#E1F5EE] text-[#085041]'
                  }`}>
                    {intakePaused ? 'Intake Paused' : 'Intake Active'}
                  </span>
                  <button
                    onClick={() => pauseMut.mutate(!intakePaused)}
                    disabled={pauseMut.isPending}
                    className={`text-xs font-medium border rounded-lg px-3 py-1 transition-colors disabled:opacity-50 ${
                      intakePaused
                        ? 'border-[#1D9E75] text-[#1D9E75] hover:bg-[#E1F5EE]'
                        : 'border-[#E24B4A] text-[#E24B4A] hover:bg-[#FCEBEB]'
                    }`}
                  >
                    {pauseMut.isPending ? '…' : intakePaused ? 'Resume Intake' : 'Pause Intake'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Shortlist Target
                  <span className="ml-1 font-normal text-gray-400">(auto-pause after N qualified)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  placeholder="e.g. 10"
                  value={shortlistTarget}
                  onChange={(e) => setShortlistTarget(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Min Fit Score %
                  <span className="ml-1 font-normal text-gray-400">(to count as qualified)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  placeholder="e.g. 70"
                  value={minFitScore}
                  onChange={(e) => setMinFitScore(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>

            {/* TF-IDF pre-filter threshold */}
            <div className="mt-4">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                TF-IDF Pre-filter Threshold
              </label>
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className={`${inputCls} w-32`}
                  placeholder="0"
                  value={tfidfThreshold}
                  onChange={(e) => setTfidfThreshold(e.target.value !== '' ? Number(e.target.value) : '')}
                />
                {(() => {
                  const v = Number(tfidfThreshold) || 0
                  if (v === 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Disabled — all resumes go to LLM</span>
                  if (v < 5) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">Light filter — only clearly off-topic removed</span>
                  if (v < 10) return <span className="text-xs px-2 py-0.5 rounded-full bg-[#E1F5EE] text-[#085041]">Recommended — good balance of speed vs accuracy</span>
                  if (v < 20) return <span className="text-xs px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#633806]">Strict — may filter borderline-relevant resumes</span>
                  return <span className="text-xs px-2 py-0.5 rounded-full bg-[#FCEBEB] text-[#791F1F]">Very strict — high risk of false negatives</span>
                })()}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                Before sending a resume to the AI scorer, a fast keyword-similarity check runs against the job description.
                Resumes below this threshold are marked <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-700 px-1 rounded">tfidf_filtered</span> and skipped — reducing LLM cost on clearly irrelevant applicants.
                Set to <span className="font-semibold">0</span> to disable entirely. Suggested starting value: <span className="font-semibold">8%</span>.
              </p>
            </div>
          </div>

          {/* SMTP status row */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {systemStatus && !systemStatus.smtp_configured ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 px-3 py-2.5 flex-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>SMTP not configured.</strong> Set{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_SERVER</code>,{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_USERNAME</code>, and{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_FROM_EMAIL</code>{' '}
                  in your environment to enable outbound emails.
                </p>
              </div>
            ) : systemStatus?.smtp_configured ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#085041] bg-[#E1F5EE] px-2.5 py-1 rounded-full">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                SMTP configured
              </span>
            ) : null}
            {systemStatus?.smtp_configured && (
              <SmtpTestButton />
            )}
          </div>

          {/* Auto-email toggle */}
          <div className="mt-4 flex items-center gap-3 pb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Auto-send next-steps email</span>
            <button
              type="button"
              onClick={() => setAutoEmailEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoEmailEnabled ? 'bg-[#1D9E75]' : 'bg-gray-300 dark:bg-gray-600'}`}
              title={autoEmailEnabled ? 'Auto-email ON — candidates scoring ≥85 get next-steps email automatically' : 'Auto-email OFF — only manual sends'}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${autoEmailEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
            <span className={`text-xs font-semibold ${autoEmailEnabled ? 'text-[#1D9E75]' : 'text-gray-400 dark:text-gray-500'}`}>
              {autoEmailEnabled ? 'On (score ≥ 85)' : 'Off'}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => saveRoleMut.mutate()}
              disabled={saveRoleMut.isPending || !roleTitle}
              className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors"
            >
              {saveRoleMut.isPending ? 'Saving…' : selectedJobRoleId ? 'Update Role' : 'Save Role'}
            </button>
            {saveMsg && <span className="text-xs text-[#1D9E75] font-medium">{saveMsg}</span>}
            {saveErrMsg && (
              <span className="text-xs text-[#791F1F] max-w-xs truncate" title={saveErrMsg}>
                Save failed: {saveErrMsg}
              </span>
            )}
          </div>
        </div>

        {/* AI Scoring Context + Education Filters */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">AI Scoring Context</h2>
              {systemStatus && (
                systemStatus.llm_configured ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-[#E1F5EE] dark:bg-[#0d3328] text-[#085041] dark:text-[#5DCAA5] border-[#5DCAA5]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] inline-block" />
                    {systemStatus.llm_provider === 'groq' ? 'Groq AI' : systemStatus.llm_provider}
                    {systemStatus.llm_model && <span className="opacity-70">· {systemStatus.llm_model}</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    TF-IDF fallback
                  </span>
                )
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              The job description below is fed to the AI to score how well the resume aligns with the role. Education filters gate eligibility.
            </p>
          </div>

          {/* JD full text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Full Job Description
                <span className="ml-1 text-gray-400 font-normal">(used by the AI for semantic alignment scoring)</span>
              </label>
              <label className={`cursor-pointer text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${jdUploading ? 'opacity-50 pointer-events-none' : 'border-[#534AB7] text-[#534AB7] hover:bg-[#EEEDFE]'}`}>
                {jdUploading ? 'Extracting…' : 'Upload PDF/DOCX'}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setJdUploading(true)
                    try {
                      const result = await extractJdText(file)
                      setJdDescription(result.text)
                      extractSkillsMut.mutate(result.text)
                    } catch {
                      alert('Failed to extract text from file.')
                    } finally {
                      setJdUploading(false)
                      e.target.value = ''
                    }
                  }}
                />
              </label>
            </div>
            <textarea
              rows={6}
              className={`${inputCls} resize-y`}
              placeholder="Paste the full job description here, or upload a PDF/DOCX above…"
              value={jdDescription}
              onChange={(e) => setJdDescription(e.target.value)}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => extractSkillsMut.mutate(jdDescription)}
                disabled={extractSkillsMut.isPending || !jdDescription.trim()}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#534AB7] text-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50 transition-colors"
              >
                {extractSkillsMut.isPending ? 'Extracting…' : 'Auto-fill Skills from JD'}
              </button>
              {jdExtractMsg && (
                <span className={`text-xs font-medium ${jdExtractMsg.startsWith('No') || jdExtractMsg.startsWith('Failed') ? 'text-gray-500 dark:text-gray-400' : 'text-[#1D9E75]'}`}>
                  {jdExtractMsg}
                </span>
              )}
            </div>
          </div>

          {/* Degree + Majors row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Minimum Degree</label>
              <select
                className={inputCls}
                value={minDegree}
                onChange={(e) => setMinDegree(e.target.value as typeof minDegree)}
              >
                <option value="">No requirement</option>
                <option value="bachelor">Bachelor's</option>
                <option value="master">Master's</option>
                <option value="phd">PhD / Doctorate</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Preferred Majors</label>
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="e.g. Computer Science"
                  value={majorInput}
                  onChange={(e) => setMajorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && majorInput.trim()) {
                      if (!preferredMajors.includes(majorInput.trim())) {
                        setPreferredMajors([...preferredMajors, majorInput.trim()])
                      }
                      setMajorInput('')
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (majorInput.trim() && !preferredMajors.includes(majorInput.trim())) {
                      setPreferredMajors([...preferredMajors, majorInput.trim()])
                    }
                    setMajorInput('')
                  }}
                  className="bg-[#534AB7] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#3C3489]"
                >
                  Add
                </button>
              </div>
              {preferredMajors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {preferredMajors.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]"
                    >
                      {m}
                      <button
                        onClick={() => setPreferredMajors(preferredMajors.filter((x) => x !== m))}
                        className="opacity-60 hover:opacity-100 leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Requirements Editor — hidden for now */}
        {false && selectedJobRoleId && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Scoring Criteria</h2>
              {(() => {
                const total = requirements.reduce((s, r) => s + r.weight, 0)
                return total !== 100 && requirements.length > 0 ? (
                  <span className="text-xs text-[#E24B4A]">Weights sum to {total.toFixed(1)} (need 100)</span>
                ) : null
              })()}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Define specific scored criteria (e.g. "Python 3+ years", "CS degree"). When saved, these replace the default Skills / Projects / Education percentage split.
            </p>

            <div className="space-y-3 mb-3">
              {requirements.map((req, idx) => (
                <div key={idx} className="space-y-1.5 pb-3 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0">
                  <div className="flex gap-2 items-start flex-wrap">
                    <input
                      className={`${inputCls} flex-[3] min-w-0`}
                      placeholder="Requirement label…"
                      value={req.label}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = { ...updated[idx], label: e.target.value }
                        setRequirements(updated)
                      }}
                    />
                    <select
                      className={`${inputCls} flex-[1.5] min-w-0`}
                      value={req.req_type}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = {
                          ...updated[idx],
                          req_type: e.target.value as JobRoleRequirement['req_type'],
                          min_years: e.target.value !== 'experience' ? null : updated[idx].min_years,
                        }
                        setRequirements(updated)
                      }}
                    >
                      <option value="skill">Skill</option>
                      <option value="experience">Experience</option>
                      <option value="education">Education</option>
                      <option value="other">Other</option>
                    </select>
                    {req.req_type === 'experience' && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={50}
                          className={`${inputCls} w-14`}
                          placeholder="yrs"
                          value={req.min_years ?? ''}
                          onChange={(e) => {
                            const updated = [...requirements]
                            updated[idx] = { ...updated[idx], min_years: e.target.value ? Number(e.target.value) : null }
                            setRequirements(updated)
                          }}
                        />
                        <span className="text-xs text-gray-400 shrink-0">min yrs</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={`${inputCls} w-16`}
                        value={req.weight}
                        onChange={(e) => {
                          const updated = [...requirements]
                          updated[idx] = { ...updated[idx], weight: Number(e.target.value) }
                          setRequirements(updated)
                        }}
                      />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                    <button
                      onClick={() => {
                        setRequirements(requirements.filter((_, i) => i !== idx))
                        setExpandedReqDesc((prev) => {
                          const next = new Set(prev)
                          next.delete(idx)
                          return next
                        })
                      }}
                      className="text-gray-400 hover:text-[#E24B4A] text-lg leading-none px-1 pt-1.5"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                  {/* Description row */}
                  {expandedReqDesc.has(idx) || req.description ? (
                    <input
                      className={`${inputCls} text-xs`}
                      placeholder="Optional description or notes (shown to scorer as evidence context)…"
                      value={req.description ?? ''}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = { ...updated[idx], description: e.target.value || null }
                        setRequirements(updated)
                      }}
                    />
                  ) : (
                    <button
                      className="text-[11px] text-gray-400 hover:text-[#534AB7] ml-0.5 transition-colors"
                      onClick={() => setExpandedReqDesc((prev) => new Set([...prev, idx]))}
                    >
                      + Add description
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-gray-100 dark:border-gray-700 pt-3">
              <button
                onClick={() => setRequirements([...requirements, { label: '', weight: 0, req_type: 'skill', description: null, min_years: null }])}
                className="text-xs text-[#534AB7] border border-[#534AB7] rounded-lg px-3 py-1.5 hover:bg-[#EEEDFE] transition-colors"
              >
                + Add requirement
              </button>
              <button
                onClick={() => saveReqMut.mutate()}
                disabled={
                  saveReqMut.isPending ||
                  (requirements.length > 0 && Math.abs(requirements.reduce((s, r) => s + r.weight, 0) - 100) > 0.5)
                }
                className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-4 py-1.5 transition-colors"
              >
                {saveReqMut.isPending ? 'Saving…' : 'Save requirements'}
              </button>
              {reqSaveMsg && <span className="text-xs text-[#1D9E75] font-medium">{reqSaveMsg}</span>}
              {saveReqMut.isError && <span className="text-xs text-[#791F1F]">Save failed.</span>}
            </div>
          </div>
        )}

        {/* Skill Taxonomy Browser */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Skill Taxonomy</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Click a skill to cycle: <span className="font-medium text-[#534AB7]">Required ✓</span> → <span className="font-medium text-amber-600">Nice-to-have ★</span> → removed.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
              placeholder="Search skills…"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
            />
            <select
              className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4 min-h-[40px]">
            {filteredSkills.length === 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">No skills found.</span>
            )}
            {filteredSkills.map((skill) => {
              const isReq = requiredSkillIds.includes(skill.id)
              const isNth = niceToHaveSkillIds.includes(skill.id)
              return (
                <div key={skill.id} className="inline-flex items-center gap-0.5">
                  {/* 3-state cycling chip: unselected → required → nice-to-have → removed */}
                  <button
                    onClick={() => toggleSkill(skill)}
                    title={isReq ? 'Required — click for nice-to-have' : isNth ? 'Nice-to-have — click to remove' : 'Click to add as required'}
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-l-full border transition-colors ${
                      isReq
                        ? 'bg-[#534AB7] text-white border-[#534AB7] hover:bg-[#3C3489]'
                        : isNth
                          ? 'bg-amber-400 text-white border-amber-400 hover:bg-amber-500'
                          : 'bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#3C3489] dark:text-[#AFA9EC] border-[#AFA9EC] hover:bg-[#534AB7] hover:text-white hover:border-[#534AB7]'
                    }`}
                  >
                    {skill.name}
                    {isReq && <span className="text-[10px]">✓</span>}
                    {isNth && <span className="text-[10px]">★</span>}
                    {!isReq && !isNth && <span className="opacity-50 text-[10px]">{skill.category}</span>}
                  </button>
                  {/* Delete from taxonomy — only when unselected */}
                  {!isReq && !isNth && (
                    <button
                      onClick={() => deleteSkillMut.mutate(skill.id)}
                      title="Delete from taxonomy"
                      className="text-xs px-1.5 py-1 rounded-r-full border border-l-0 border-[#AFA9EC] dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700 transition-colors"
                    >
                      ×
                    </button>
                  )}
                  {/* Show state indicator when selected (rounded-r since no delete button) */}
                  {(isReq || isNth) && (
                    <button
                      onClick={() => toggleSkill(skill)}
                      title="Click to advance state"
                      className={`text-[10px] px-1.5 py-1 rounded-r-full border border-l-0 transition-colors ${
                        isReq
                          ? 'bg-[#534AB7] text-white border-[#534AB7] hover:bg-[#3C3489]'
                          : 'bg-amber-400 text-white border-amber-400 hover:bg-amber-500'
                      }`}
                    >
                      {isReq ? '→★' : '×'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add new skill to taxonomy */}
          <div className="flex gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <input
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
              placeholder="New skill name…"
              value={newTaxSkillName}
              onChange={(e) => setNewTaxSkillName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTaxSkillName.trim()) {
                  createSkillMut.mutate({ name: newTaxSkillName.trim(), cat: newTaxCategory })
                  setNewTaxSkillName('')
                }
              }}
            />
            <select
              className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              value={newTaxCategory}
              onChange={(e) => setNewTaxCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (newTaxSkillName.trim()) {
                  createSkillMut.mutate({ name: newTaxSkillName.trim(), cat: newTaxCategory })
                  setNewTaxSkillName('')
                }
              }}
              disabled={createSkillMut.isPending}
              className="bg-[#534AB7] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#3C3489] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Email Templates — admin only */}
        {isAdmin && <EmailTemplatesPanel />}

      </div>
    </div>
  )
}
