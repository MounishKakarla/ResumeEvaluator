import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getResultDetail,
  shortlistCandidate,
  sendCandidateEmail,
  sendRejectionEmail,
  getEnrichment,
  enrichGitHub,
  enrichLinkedIn,
  enrichPortfolio,
  getFeedbackForCandidate,
  createFeedback,
  deleteFeedback,
  updateResumeSections,
  getComments,
  createComment,
  updateComment,
  deleteComment,
  reparseCandidate,
} from '../api/client'
import type {
  ShortlistStatus,
  SkillMatch,
  EvaluationDetail,
  RequirementBreakdown,
  ConsistencyFlag,
  GitHubSummary,
  PortfolioSummary,
  InterviewFeedback,
  FeedbackCreate,
  ResumeSection,
  CandidateComment,
} from '../api/client'
import ScoreBar from '../components/ScoreBar'
import StatusBadge from '../components/StatusBadge'

type Tab = 'breakdown' | 'resume' | 'enrichment' | 'notes' | 'feedback' | 'comments'

const SKILL_CHIP_STYLES: Record<string, string> = {
  projects:       'bg-[#E1F5EE] text-[#1D9E75] border-[#5DCAA5]/40',
  experience:     'bg-[#E1F5EE] text-[#1D9E75] border-[#5DCAA5]/40',
  work_experience:'bg-[#E1F5EE] text-[#1D9E75] border-[#5DCAA5]/40',
  skills_section: 'bg-[#EEEDFE] text-[#534AB7] border-[#AFA9EC]/40',
  skills:         'bg-[#EEEDFE] text-[#534AB7] border-[#AFA9EC]/40',
  certifications: 'bg-[#EEEDFE] text-[#534AB7] border-[#AFA9EC]/40',
  education:      'bg-[#E1F5FE] text-[#004D7A] border-[#74C2F1]/40',
  unknown:        'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600',
}

const SKILL_CHIP_LABELS: Record<string, string> = {
  projects:       'Projects / Experience',
  skills_section: 'Skills Section',
  education:      'Education',
  unknown:        'Other',
}

const FLAG_SEVERITY_STYLES: Record<string, string> = {
  high:   'bg-[#FCEBEB] border-[#E24B4A] text-[#791F1F]',
  medium: 'bg-[#FAEEDA] border-[#EF9F27] text-[#633806]',
  low:    'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300',
}

function FlagRow({ flag }: { flag: ConsistencyFlag }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${FLAG_SEVERITY_STYLES[flag.severity] ?? FLAG_SEVERITY_STYLES.low}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold capitalize">{flag.severity}</span>
        <span className="text-xs opacity-60">{flag.flag_type.replace('_', ' ')}</span>
      </div>
      <p>{flag.recruiter_note}</p>
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

      {summary.relevant_repos.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">JD-Relevant Repos</p>
          <div className="space-y-2">
            {summary.relevant_repos.slice(0, 5).map((r) => (
              <div key={r.name} className="flex items-start justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-800 dark:text-gray-100">{r.name}</span>
                  {r.description && <span className="text-gray-400 ml-2 text-xs">{r.description.slice(0, 80)}</span>}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.matched_skills.map((s) => (
                      <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-[#E1F5EE] text-[#085041]">{s}</span>
                    ))}
                  </div>
                </div>
                {r.stars > 0 && <span className="text-xs text-gray-400 ml-2 shrink-0">★ {r.stars}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.inferred_skills.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Inferred Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.inferred_skills.map((s) => (
              <span key={s.name} title={`Evidence: ${s.evidence.join(', ')}`}
                className="text-xs px-2.5 py-1 rounded-full border bg-[#E1F5FE] text-[#004D7A] border-[#74C2F1]">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A'
  const circumference = 2 * Math.PI * 36
  const dash = (score / 100) * circumference

  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle
          cx="40" cy="40" r="36" fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-black tracking-tight" style={{ color }}>{Math.round(score)}</span>
        <span className="text-[10px] uppercase font-bold text-gray-400 -mt-1">Score</span>
      </div>
    </div>
  )
}

export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const evaluationId = Number(id)

  const [activeTab, setActiveTab] = useState<Tab>('breakdown')
  const [noteText, setNoteText] = useState('')
  const [noteStatus, setNoteStatus] = useState<ShortlistStatus>('review')
  const [noteSaved, setNoteSaved] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailSubject, setEmailSubject] = useState('Regarding your application')
  const [emailBody, setEmailBody] = useState('')
  const [ghUrl, setGhUrl] = useState('')
  const [liUrl, setLiUrl] = useState('')
  const [localSections, setLocalSections] = useState<ResumeSection[]>([])
  const [sectionsSaved, setSectionsSaved] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set())

  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ['resultDetail', evaluationId],
    queryFn: () => getResultDetail(evaluationId),
    enabled: !!evaluationId,
  })

  const data = rawData as EvaluationDetail | undefined

  useEffect(() => {
    if (!data) return
    if (data.notes) setNoteText(data.notes)
    if (data.shortlist_status) setNoteStatus(data.shortlist_status)
    if (data.github_url && !ghUrl) setGhUrl(data.github_url)
    if (data.linkedin_url && !liUrl) setLiUrl(data.linkedin_url)
  }, [data])

  const shortlistMut = useMutation({
    mutationFn: () => shortlistCandidate(evaluationId, noteStatus, noteText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2000)
    },
  })

  const emailMut = useMutation({
    mutationFn: () => sendCandidateEmail(evaluationId, emailSubject, emailBody),
    onSuccess: () => { setShowEmailModal(false); setEmailBody('') },
    onError: () => alert('Failed to send email.'),
  })

  const [rejectionNote, setRejectionNote] = useState('')
  const [showRejectionModal, setShowRejectionModal] = useState(false)
  const [rejectionSent, setRejectionSent] = useState(false)
  const rejectionMut = useMutation({
    mutationFn: () => sendRejectionEmail(evaluationId, rejectionNote || undefined),
    onSuccess: () => {
      setShowRejectionModal(false)
      setRejectionNote('')
      setRejectionSent(true)
      setTimeout(() => setRejectionSent(false), 3000)
    },
    onError: () => alert('Failed to send rejection email.'),
  })

  const { data: enrichData, refetch: refetchEnrich } = useQuery({
    queryKey: ['enrichment', data?.candidate_id],
    queryFn: () => getEnrichment(data!.candidate_id),
    enabled: !!data?.candidate_id,
  })

  const ghMut = useMutation({
    mutationFn: () => enrichGitHub(data!.candidate_id, ghUrl || undefined, data?.job_role_id),
    onSuccess: () => refetchEnrich(),
  })
  const liMut = useMutation({
    mutationFn: () => enrichLinkedIn(data!.candidate_id, liUrl || undefined),
    onSuccess: () => refetchEnrich(),
  })
  const portfolioMut = useMutation({
    mutationFn: () => enrichPortfolio(data!.candidate_id),
    onSuccess: () => refetchEnrich(),
  })

  const [reparseDone, setReparseDone] = useState(false)
  const reparseMut = useMutation({
    mutationFn: () => reparseCandidate(data!.candidate_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setReparseDone(true)
      setTimeout(() => setReparseDone(false), 3000)
    },
    onError: () => alert('Re-parse failed. The stored resume text may be missing.'),
  })

  // Comments state
  const [commentText, setCommentText] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

  useEffect(() => {
    if (data?.resume_sections && localSections.length === 0) {
      setLocalSections(data.resume_sections as ResumeSection[])
    }
  }, [data?.resume_sections])

  const saveSectionsMut = useMutation({
    mutationFn: () => updateResumeSections(evaluationId, localSections),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      setSectionsSaved(true)
      setTimeout(() => setSectionsSaved(false), 2000)
    },
  })

  const { data: commentsList = [], refetch: refetchComments } = useQuery<CandidateComment[]>({
    queryKey: ['comments', data?.candidate_id],
    queryFn: () => getComments(data!.candidate_id),
    enabled: !!data?.candidate_id && activeTab === 'comments',
  })

  const addCommentMut = useMutation({
    mutationFn: () => createComment(data!.candidate_id, commentText),
    onSuccess: () => { setCommentText(''); refetchComments() },
  })

  const editCommentMut = useMutation({
    mutationFn: (commentId: number) => updateComment(data!.candidate_id, commentId, editingCommentText),
    onSuccess: () => { setEditingCommentId(null); setEditingCommentText(''); refetchComments() },
  })

  const deleteCommentMut = useMutation({
    mutationFn: (commentId: number) => deleteComment(data!.candidate_id, commentId),
    onSuccess: () => refetchComments(),
  })

  function updateSectionType(index: number, newType: string) {
    setLocalSections((prev) => prev.map((s, i) => i === index ? { ...s, type: newType } : s))
  }

  function toggleSection(index: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'breakdown',  label: 'Score Breakdown' },
    { key: 'resume',     label: 'Resume Text' },
    { key: 'enrichment', label: 'Enrichment' },
    { key: 'notes',      label: 'Notes' },
    { key: 'feedback',   label: 'Interview Feedback' },
    { key: 'comments',   label: 'Team Comments' },
  ]

  // ── Interview Feedback ──────────────────────────────────────────
  const { data: feedbackList = [], refetch: refetchFeedback } = useQuery<InterviewFeedback[]>({
    queryKey: ['feedback', data?.candidate_id],
    queryFn: () => getFeedbackForCandidate(data!.candidate_id),
    enabled: !!data?.candidate_id,
  })
  const [fbStage, setFbStage] = useState<'screening' | 'coding' | 'interview'>('interview')
  const [fbRating, setFbRating] = useState(3)
  const [fbTech, setFbTech] = useState('')
  const [fbComm, setFbComm] = useState('')
  const [fbCulture, setFbCulture] = useState('')
  const [fbRecommendation, setFbRecommendation] = useState('')
  const [fbNotes, setFbNotes] = useState('')
  const [fbSaved, setFbSaved] = useState(false)
  const addFeedbackMut = useMutation({
    mutationFn: () => createFeedback({
      candidate_id: data!.candidate_id,
      evaluation_id: evaluationId,
      stage: fbStage,
      rating: fbRating,
      technical_score: fbTech ? parseFloat(fbTech) : null,
      communication_score: fbComm ? parseFloat(fbComm) : null,
      culture_fit_score: fbCulture ? parseFloat(fbCulture) : null,
      recommendation: fbRecommendation || null,
      notes: fbNotes || null,
    } as FeedbackCreate),
    onSuccess: () => {
      setFbNotes(''); setFbTech(''); setFbComm(''); setFbCulture(''); setFbRecommendation(''); setFbRating(3)
      setFbSaved(true)
      setTimeout(() => setFbSaved(false), 2000)
      refetchFeedback()
    },
  })
  const deleteFeedbackMut = useMutation({
    mutationFn: (id: number) => deleteFeedback(id),
    onSuccess: () => refetchFeedback(),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-56px)] animate-pulse">
        {/* Header skeleton */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-52" />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="h-9 w-28 bg-gray-100 dark:bg-gray-700 rounded-lg" />
            <div className="h-9 w-28 bg-gray-100 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>
        {/* Tab bar skeleton */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-6 shrink-0 py-1">
          {[72, 64, 80, 56, 68, 76].map((w, i) => (
            <div key={i} className="h-3 bg-gray-100 dark:bg-gray-700 rounded my-2.5" style={{ width: w }} />
          ))}
        </div>
        {/* Body skeleton */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-full" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-5/6" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] gap-3">
        <p className="text-[#791F1F]">Failed to load candidate detail.</p>
        <button onClick={() => navigate(-1)} className="text-sm text-[#534AB7] underline">Go back</button>
      </div>
    )
  }

  const foundInProjects   = data.skills_matched?.filter((s) => ['projects','experience','work_experience'].includes(s.best_section)) || []
  const foundInSkills     = data.skills_matched?.filter((s) => ['skills_section','skills','certifications'].includes(s.best_section)) || []
  const foundInEducation  = data.skills_matched?.filter((s) => s.best_section === 'education') || []
  const foundOther        = data.skills_matched?.filter((s) => !['projects','experience','work_experience','skills_section','skills','certifications','education'].includes(s.best_section)) || []
  const missing           = data.skill_gaps || []

  function SkillChip({ match }: { match: SkillMatch }) {
    return (
      <span
        className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${SKILL_CHIP_STYLES[match.best_section] ?? SKILL_CHIP_STYLES.unknown}`}
        title={`Score: ${(match.score * 100).toFixed(0)}%`}
      >
        {match.skill_name}
      </span>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-gray-50 dark:bg-gray-950">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center gap-4 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-[#534AB7] hover:bg-[#EEEDFE] dark:hover:bg-[#534AB7]/20 transition-all"
          aria-label="Back"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{data.candidate_name}</h1>
            <StatusBadge status={data.status as Parameters<typeof StatusBadge>[0]['status']} />
            {reparseDone ? (
              <span className="text-xs text-[#1D9E75] font-medium">Re-parsed</span>
            ) : (
              <button
                onClick={() => reparseMut.mutate()}
                disabled={reparseMut.isPending}
                title="Re-extract name and graduation year from resume text"
                className="text-xs text-gray-400 hover:text-[#534AB7] dark:hover:text-[#AFA9EC] transition-colors disabled:opacity-40"
              >
                {reparseMut.isPending ? 'Re-parsing…' : '↺ Re-parse name'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{data.candidate_email}</p>
            {data.email_sent_at && (
              <span
                title={`Sent ${new Date(data.email_sent_at).toLocaleString()}`}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  data.email_opened_at
                    ? 'bg-[#E1F5EE] text-[#085041]'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {data.email_opened_at ? (
                  <>
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Opened {new Date(data.email_opened_at).toLocaleDateString()}
                  </>
                ) : (
                  <>
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Sent {new Date(data.email_sent_at).toLocaleDateString()}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setShowEmailModal(true)}
          className="flex items-center gap-2 text-sm font-medium border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300 hover:border-[#534AB7] hover:text-[#534AB7] dark:hover:border-[#534AB7] dark:hover:text-[#AFA9EC] transition-all bg-white dark:bg-gray-800"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Email Candidate
        </button>

        {rejectionSent ? (
          <span className="text-xs text-[#1D9E75] font-medium px-3 py-2">Rejection sent</span>
        ) : (
          <button
            onClick={() => setShowRejectionModal(true)}
            className="flex items-center gap-2 text-sm font-medium border border-[#E24B4A]/40 rounded-lg px-3 py-2 text-[#791F1F] dark:text-[#E24B4A] hover:bg-[#FCEBEB] dark:hover:bg-[#791F1F]/20 transition-all bg-white dark:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Send Rejection
          </button>
        )}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-0 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-[#534AB7] text-[#534AB7]'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-[#534AB7] dark:hover:text-[#AFA9EC]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Tab 1: Score Breakdown */}
        {activeTab === 'breakdown' && (
          <div className="flex h-full">

            {/* Left column */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto">

              {/* Skills Match */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Skills Match</h3>

                {/* Legend */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {Object.entries(SKILL_CHIP_LABELS).map(([key, label]) => (
                    <span key={key} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${SKILL_CHIP_STYLES[key]}`}>
                      {label}
                    </span>
                  ))}
                </div>

                <div className="space-y-4">
                  {foundInProjects.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Projects &amp; Experience</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInProjects.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundInSkills.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Skills Section</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInSkills.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundInEducation.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">In Education</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInEducation.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundOther.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Other</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundOther.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {missing.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Missing Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missing.map((skill: string) => (
                          <span key={skill} className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confidence tiers */}
                {data.confidence_tiers && (
                  (data.confidence_tiers.high.length + data.confidence_tiers.medium.length + data.confidence_tiers.low.length) > 0
                ) && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Confidence by match quality</p>
                    <div className="space-y-1.5">
                      {data.confidence_tiers!.high.length > 0 && (
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5]/50 shrink-0 mt-0.5">High</span>
                          <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.high.join(', ')}</p>
                        </div>
                      )}
                      {data.confidence_tiers!.medium.length > 0 && (
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FAEEDA] text-[#633806] border border-[#EF9F27]/50 shrink-0 mt-0.5">Mid</span>
                          <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.medium.join(', ')}</p>
                        </div>
                      )}
                      {data.confidence_tiers!.low.length > 0 && (
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 shrink-0 mt-0.5">Low</span>
                          <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.low.join(', ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Requirements Breakdown */}
              {data.requirements_breakdown && data.requirements_breakdown.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Requirements Breakdown</h3>
                  <div className="space-y-4">
                    {data.requirements_breakdown.map((rb: RequirementBreakdown) => {
                      const color = rb.score >= 75 ? '#1D9E75' : rb.score >= 40 ? '#EF9F27' : '#E24B4A'
                      return (
                        <div key={rb.requirement_id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{rb.label}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">{rb.req_type}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <span className="text-[10px] text-gray-400">w:{rb.weight}%</span>
                              <span className="text-xs font-semibold" style={{ color }}>{Math.round(rb.score)}%</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${rb.score}%`, backgroundColor: color }} />
                          </div>
                          {rb.evidence && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate" title={rb.evidence}>{rb.evidence}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {data.reasoning_summary && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">AI Analysis</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEEDFE] dark:bg-[#534AB7]/20 text-[#3C3489] dark:text-[#AFA9EC] border border-[#AFA9EC]/40">AI</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{data.reasoning_summary}</p>
                </div>
              )}

              {/* Interview Prep Questions — disabled, uncomment to restore
              {data.interview_questions && data.interview_questions.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Interview Prep Questions</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E1F5FE] text-[#004D7A] border border-[#74C2F1]/40">AI Generated</span>
                  </div>
                  <ol className="space-y-2.5 list-none">
                    {data.interview_questions.map((q, i) => (
                      <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#EEEDFE] dark:bg-[#534AB7]/30 text-[#534AB7] dark:text-[#AFA9EC] text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <span className="leading-relaxed">{q}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              */}

              {/* Top Matched Excerpt */}
              {data.excerpts && data.excerpts.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Top Matched Excerpt</h3>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    <p>{data.excerpts[0]}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <aside className="w-64 shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-5 overflow-y-auto">

              {/* Score circle */}
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Overall Score</p>
                <ScoreCircle score={data.total_score} />
              </div>

              {/* Section Scores */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Section Breakdown</p>
                <div className="space-y-3">
                  {[
                    { label: 'Projects', score: data.project_score },
                    { label: 'Skills',   score: data.skill_score },
                    { label: 'Education', score: data.education_score },
                  ].map(({ label, score }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span>{label}</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{Math.round(score)}%</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Candidate Info */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Candidate</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{data.candidate_name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">{data.candidate_email}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Role: <span className="text-gray-600 dark:text-gray-300">{data.job_role_title}</span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Evaluated: {new Date(data.evaluated_at).toLocaleDateString()}
                </p>

                {/* Social links */}
                {(data.github_url || data.linkedin_url || data.portfolio_url) && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {data.github_url && (
                      <a href={data.github_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors truncate"
                        title={data.github_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        GitHub
                      </a>
                    )}
                    {data.linkedin_url && (
                      <a href={data.linkedin_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-[#0A66C2] transition-colors truncate"
                        title={data.linkedin_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        LinkedIn
                      </a>
                    )}
                    {data.portfolio_url && (
                      <a href={data.portfolio_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-[#534AB7] dark:hover:text-[#AFA9EC] transition-colors truncate"
                        title={data.portfolio_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                        </svg>
                        Portfolio
                      </a>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* Tab 2: Resume Text */}
        {activeTab === 'resume' && (
          <div className="p-6 space-y-4">
            {localSections.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Resume Sections</h3>
                  <div className="flex items-center gap-3">
                    {sectionsSaved && <span className="text-xs text-[#1D9E75] font-medium">Saved</span>}
                    {saveSectionsMut.isError && <span className="text-xs text-[#791F1F]">Save failed</span>}
                    <button
                      onClick={() => saveSectionsMut.mutate()}
                      disabled={saveSectionsMut.isPending}
                      className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors"
                    >
                      {saveSectionsMut.isPending ? 'Saving…' : 'Save Section Types'}
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {localSections.map((sec, idx) => {
                    const sectionColors: Record<string, string> = {
                      projects: '#1D9E75', work_experience: '#1D9E75', experience: '#1D9E75',
                      skills_section: '#534AB7', skills: '#534AB7', certifications: '#534AB7',
                      education: '#004D7A', summary: '#EF9F27', objective: '#EF9F27',
                      awards: '#6B7280', publications: '#6B7280', volunteer: '#6B7280',
                      languages: '#6B7280', interests: '#6B7280', unknown: '#9CA3AF',
                    }
                    const color = sectionColors[sec.type] ?? '#9CA3AF'
                    const confPct = Math.round((sec.confidence ?? 0) * 100)
                    const isExpanded = expandedSections.has(idx)
                    return (
                      <div key={idx} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                        {/* Section header */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full text-white shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {sec.type.replace('_', ' ')}
                          </span>
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex-1 truncate">
                            {sec.title || `Lines ${sec.start_line}–${sec.end_line}`}
                          </span>
                          {/* Confidence bar */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${confPct}%`,
                                  backgroundColor: confPct >= 80 ? '#1D9E75' : confPct >= 50 ? '#EF9F27' : '#E24B4A',
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 w-7 text-right">{confPct}%</span>
                          </div>
                          {/* Type editor */}
                          <select
                            value={sec.type}
                            onChange={(e) => updateSectionType(idx, e.target.value)}
                            className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
                          >
                            {[
                              'projects','work_experience','skills_section','education',
                              'certifications','summary','objective','awards',
                              'publications','volunteer','languages','interests','unknown',
                            ].map((t) => (
                              <option key={t} value={t}>{t.replace('_', ' ')}</option>
                            ))}
                          </select>
                          {/* Expand toggle */}
                          <button
                            onClick={() => toggleSection(idx)}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shrink-0 ml-1"
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </div>
                        {/* Section text — collapsible */}
                        {isExpanded && sec.text && (
                          <pre className="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-mono bg-gray-50 dark:bg-gray-800 px-4 py-3 border-t border-gray-100 dark:border-gray-700 max-h-48 overflow-auto">
                            {sec.text}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Full Resume Text</h3>
                <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-mono bg-gray-50 dark:bg-gray-800 rounded-lg p-4 overflow-auto max-h-[60vh]">
                  {data.resume_text || 'No text extracted.'}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Enrichment */}
        {activeTab === 'enrichment' && (
          <div className="p-6 space-y-5 max-w-3xl">
            {enrichData?.needs_manual_review && (
              <div className="flex items-center gap-3 bg-[#FCEBEB] border border-[#E24B4A] rounded-xl px-4 py-3 text-sm text-[#791F1F]">
                <span className="font-semibold">Manual review required</span>
                <span>— discrepancies detected between resume and LinkedIn.</span>
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
              {/* Graceful degradation: LinkedIn blocks automated scraping */}
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

            {/* Portfolio Analysis */}
            {data.portfolio_url && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Portfolio Analysis</h3>
                  {enrichData?.enrichment_sources?.includes('portfolio') && (
                    <span className="text-xs bg-[#E1F5EE] text-[#085041] border border-[#5DCAA5] px-2 py-0.5 rounded-full">Analysed</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <a href={data.portfolio_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-[#534AB7] hover:underline truncate flex-1">{data.portfolio_url}</a>
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

            {/* Consistency flags */}
            {(enrichData?.consistency_flags ?? []).length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">Review Flags</h3>
                {(enrichData!.consistency_flags as ConsistencyFlag[]).map((flag, i) => (
                  <FlagRow key={i} flag={flag} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Notes */}
        {activeTab === 'notes' && (
          <div className="p-6 max-w-2xl">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Annotations</h3>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Shortlist Status</label>
                <select
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
                  value={noteStatus}
                  onChange={(e) => setNoteStatus(e.target.value as ShortlistStatus)}
                >
                  <option value="shortlisted">Shortlisted</option>
                  <option value="review">Review</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Notes</label>
                <textarea rows={6}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
                  placeholder="Add notes about this candidate…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => shortlistMut.mutate()} disabled={shortlistMut.isPending}
                  className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors">
                  {shortlistMut.isPending ? 'Saving…' : 'Save'}
                </button>
                {noteSaved && <span className="text-xs text-[#1D9E75] font-medium">Saved successfully</span>}
                {shortlistMut.isError && <span className="text-xs text-[#791F1F]">Save failed</span>}
              </div>
            </div>
          </div>
        )}
      </div>

        {/* Tab 5: Interview Feedback */}
        {activeTab === 'feedback' && (
          <div className="p-6 space-y-6 max-w-2xl">

            {/* Summary panel */}
            {feedbackList.length > 0 && (() => {
              const avg = (arr: (number | null)[]) => {
                const vals = arr.filter((v): v is number => v != null)
                return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null
              }
              const avgRating = avg(feedbackList.map((f) => f.rating))
              const avgTech = avg(feedbackList.map((f) => f.technical_score))
              const avgComm = avg(feedbackList.map((f) => f.communication_score))
              const avgCulture = avg(feedbackList.map((f) => f.culture_fit_score))
              const recCounts: Record<string, number> = {}
              feedbackList.forEach((f) => { if (f.recommendation) recCounts[f.recommendation] = (recCounts[f.recommendation] ?? 0) + 1 })
              const REC_STYLES: Record<string, string> = {
                strong_hire: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
                hire: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
                no_hire: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
                strong_no_hire: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
              }
              return (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm mb-3">
                    Aggregate Scores <span className="font-normal text-gray-400">({feedbackList.length} response{feedbackList.length !== 1 ? 's' : ''})</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Avg Rating', value: avgRating != null ? `${avgRating.toFixed(1)} / 5` : '—', color: '#534AB7' },
                      { label: 'Technical', value: avgTech != null ? `${avgTech.toFixed(1)} / 10` : '—', color: '#1D9E75' },
                      { label: 'Communication', value: avgComm != null ? `${avgComm.toFixed(1)} / 10` : '—', color: '#EF9F27' },
                      { label: 'Culture Fit', value: avgCulture != null ? `${avgCulture.toFixed(1)} / 10` : '—', color: '#3B82F6' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center">
                        <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
                        <p className="text-base font-bold" style={{ color }}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {Object.keys(recCounts).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(recCounts).map(([rec, count]) => (
                        <span key={rec} className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${REC_STYLES[rec] ?? 'bg-gray-100 text-gray-600'}`}>
                          {rec.replace('_', ' ')} × {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Existing feedback entries */}
            {feedbackList.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Previous Feedback</h3>
                {feedbackList.map((fb) => (
                  <div key={fb.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="capitalize text-xs font-semibold bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#534AB7] px-2 py-0.5 rounded-full">{fb.stage}</span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}</span>
                        {fb.recommendation && (
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                            fb.recommendation === 'strong_hire' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                            fb.recommendation === 'hire' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                            fb.recommendation === 'no_hire' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                            'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          }`}>{fb.recommendation.replace('_', ' ')}</span>
                        )}
                      </div>
                      <button
                        onClick={() => deleteFeedbackMut.mutate(fb.id)}
                        className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete"
                      >✕</button>
                    </div>
                    {(fb.technical_score != null || fb.communication_score != null || fb.culture_fit_score != null) && (
                      <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                        {fb.technical_score != null && <span>Tech <strong>{fb.technical_score}/10</strong></span>}
                        {fb.communication_score != null && <span>Comm <strong>{fb.communication_score}/10</strong></span>}
                        {fb.culture_fit_score != null && <span>Culture <strong>{fb.culture_fit_score}/10</strong></span>}
                      </div>
                    )}
                    {fb.notes && <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{fb.notes}</p>}
                    <p className="text-xs text-gray-400 dark:text-gray-500">{fb.interviewer_email ?? 'Unknown'} · {new Date(fb.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add feedback form */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Add Interview Feedback</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Stage</label>
                  <select value={fbStage} onChange={(e) => setFbStage(e.target.value as typeof fbStage)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40">
                    <option value="screening">Screening</option>
                    <option value="coding">Coding</option>
                    <option value="interview">Interview</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Overall Rating</label>
                  <select value={fbRating} onChange={(e) => setFbRating(Number(e.target.value))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40">
                    {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} Star{n !== 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[['Technical', fbTech, setFbTech], ['Communication', fbComm, setFbComm], ['Culture Fit', fbCulture, setFbCulture]].map(([label, val, setter]) => (
                  <div key={label as string}>
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{label as string} (0–10)</label>
                    <input type="number" min={0} max={10} step={0.5}
                      value={val as string}
                      onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                      placeholder="—"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Recommendation</label>
                <select value={fbRecommendation} onChange={(e) => setFbRecommendation(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40">
                  <option value="">— Select —</option>
                  <option value="strong_hire">Strong Hire</option>
                  <option value="hire">Hire</option>
                  <option value="no_hire">No Hire</option>
                  <option value="strong_no_hire">Strong No Hire</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Notes</label>
                <textarea rows={4} value={fbNotes} onChange={(e) => setFbNotes(e.target.value)}
                  placeholder="Observations, strengths, concerns…"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => addFeedbackMut.mutate()} disabled={addFeedbackMut.isPending}
                  className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors">
                  {addFeedbackMut.isPending ? 'Saving…' : 'Save Feedback'}
                </button>
                {fbSaved && <span className="text-xs text-[#1D9E75] font-medium">Saved</span>}
                {addFeedbackMut.isError && <span className="text-xs text-red-500">Save failed</span>}
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Team Comments */}
        {activeTab === 'comments' && (
          <div className="p-6 max-w-2xl space-y-4">
            {/* Existing comments */}
            {commentsList.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No comments yet. Be the first to add one.</p>
            )}
            <div className="space-y-3">
              {commentsList.map((comment: CandidateComment) => (
                <div key={comment.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#534AB7]/20 flex items-center justify-center text-[#534AB7] text-xs font-bold">
                        {(comment.author_email ?? '?')[0].toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{comment.author_email ?? 'Unknown'}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(comment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {comment.updated_at && <span className="ml-1 italic">(edited)</span>}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.body) }}
                        className="text-xs text-gray-300 dark:text-gray-600 hover:text-[#534AB7] dark:hover:text-[#AFA9EC] transition-colors"
                      >Edit</button>
                      <button
                        onClick={() => deleteCommentMut.mutate(comment.id)}
                        className="text-xs text-gray-300 dark:text-gray-600 hover:text-[#E24B4A] transition-colors"
                      >Delete</button>
                    </div>
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={editingCommentText}
                        onChange={(e) => setEditingCommentText(e.target.value)}
                        className="w-full border border-[#534AB7] rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => editCommentMut.mutate(comment.id)}
                          disabled={editCommentMut.isPending || !editingCommentText.trim()}
                          className="text-xs bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                        >
                          {editCommentMut.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingCommentId(null); setEditingCommentText('') }}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 transition-colors"
                        >Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{comment.body}</p>
                  )}
                </div>
              ))}
            </div>

            {/* New comment form */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <textarea
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment visible to all team members…"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => addCommentMut.mutate()}
                  disabled={addCommentMut.isPending || !commentText.trim()}
                  className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                >
                  {addCommentMut.isPending ? 'Posting…' : 'Post Comment'}
                </button>
                {addCommentMut.isError && <span className="text-xs text-red-500">Failed to post comment</span>}
              </div>
            </div>
          </div>
        )}

      {/* ── Email Modal ─────────────────────────────────────────── */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 max-w-lg w-full border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Send Email to {data.candidate_name}</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
                <input type="text"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Message</label>
                <textarea
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm h-32 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder={`Hi ${data.candidate_name},\n\nWe wanted to reach out regarding your application...`}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowEmailModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={() => emailMut.mutate()} disabled={emailMut.isPending || !emailSubject || !emailBody}
                  className="px-4 py-2 text-sm font-medium bg-[#534AB7] text-white rounded-lg hover:bg-[#3C3489] disabled:opacity-50 transition-colors">
                  {emailMut.isPending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Rejection Email Modal ──────────────────────────────── */}
      {showRejectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 max-w-lg w-full border border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Send Rejection Email</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              A constructive rejection email with skill gap feedback will be sent to <strong>{data.candidate_email}</strong>.
            </p>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Optional personal note</label>
            <textarea
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              rows={3}
              placeholder="Add a personalised message (optional)…"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowRejectionModal(false)}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button onClick={() => rejectionMut.mutate()} disabled={rejectionMut.isPending}
                className="px-4 py-2 text-sm font-medium bg-[#E24B4A] text-white rounded-lg hover:bg-[#c43c3b] disabled:opacity-50 transition-colors">
                {rejectionMut.isPending ? 'Sending...' : 'Send Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
