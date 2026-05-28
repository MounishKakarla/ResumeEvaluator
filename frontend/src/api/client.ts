/// <reference types="vite/client" />
import axios from 'axios'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string
  refresh_token: string
  token_type: string
  role: string
  email: string
}

export interface Skill {
  id: number
  name: string
  category: string
  created_at: string
}

export interface SkillsParams {
  page?: number
  limit?: number
  category?: string
  search?: string
}

export interface PaginatedSkills {
  items: Skill[]
  total: number
  page: number
  limit: number
}

export interface ScoringWeights {
  projects: number
  skills: number
  education: number
}

export interface JobRoleRequirement {
  id: number
  label: string
  weight: number
  req_type: 'skill' | 'experience' | 'education' | 'other'
  description?: string | null
  min_years?: number | null
}

export interface RequirementBreakdown {
  requirement_id: number
  label: string
  req_type: string
  weight: number
  score: number
  evidence?: string | null
}

export interface JobRole {
  id: number
  title: string
  min_experience: number
  weight_projects: number
  weight_skills: number
  weight_education: number
  cosine_threshold: number
  skill_ids: number[]
  skill_names: string[]
  skill_required_flags: boolean[]
  intake_paused: boolean
  shortlist_target: number | null
  min_fit_score: number | null
  created_at: string
  requirements: JobRoleRequirement[]
  description?: string | null
  min_degree?: 'bachelor' | 'master' | 'phd' | 'doctorate' | null
  preferred_majors: string[]
  filter_experience_levels: string[]
  auto_email_enabled: boolean
  tfidf_threshold: number
  min_graduation_year?: number | null
  max_graduation_year?: number | null
  is_entry_level: boolean
  require_github: boolean
}

export interface JobRoleCreate {
  title: string
  min_experience: number
  weight_projects: number
  weight_skills: number
  weight_education: number
  cosine_threshold: number
  skill_ids: number[]
  skill_required_flags?: boolean[]
  shortlist_target?: number | null
  min_fit_score?: number | null
  description?: string | null
  min_degree?: 'bachelor' | 'master' | 'phd' | 'doctorate' | null
  preferred_majors?: string[]
  filter_experience_levels?: string[]
  auto_email_enabled?: boolean
  min_graduation_year?: number | null
  max_graduation_year?: number | null
  is_entry_level?: boolean
  require_github?: boolean
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

export interface GitHubLanguage {
  language: string
  repo_count: number
}

export interface GitHubRepo {
  name: string
  description: string | null
  language: string | null
  stars: number
  matched_skills: string[]
}

export interface GitHubSummary {
  username: string
  public_repos: number
  languages: GitHubLanguage[]
  relevant_repos: GitHubRepo[]
  activity_score: number
  inferred_skills: { name: string; source: string; evidence: string[] }[]
  error: string | null
}

export interface ConsistencyFlag {
  severity: 'low' | 'medium' | 'high'
  field: string
  flag_type: string
  resume_value: string | null
  linkedin_value: string | null
  recruiter_note: string
}

export interface PortfolioSummary {
  url: string
  title: string
  description: string
  tech_stack: string[]
  project_snippets: string[]
  error: string | null
}

export interface EnrichmentData {
  candidate_id: number
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  github_summary: GitHubSummary | null
  linkedin_data: Record<string, unknown> | null
  portfolio_summary: PortfolioSummary | null
  consistency_flags: ConsistencyFlag[]
  needs_manual_review: boolean
  enrichment_sources: string[]
  error?: string | null
}

export interface UploadResponse {
  resume_id: number
  candidate_id: number
  duplicate_status: string
  sections_detected: string[]
  candidate_name: string
  candidate_email: string | null
}

export interface ResultsParams {
  job_role_id?: number
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  status?: string
  search?: string
}

export type ShortlistStatus = 'shortlisted' | 'review' | 'rejected'
export type OutcomeType = 'hired' | 'rejected' | 'ghosted' | 'declined'

export interface SkillMatch {
  skill_name: string
  score: number
  confidence: number
  best_section: 'projects' | 'skills_section' | 'skills' | 'certifications' | 'education' | 'experience' | 'work_experience' | 'unknown'
  excerpt?: string
}

export interface Excerpt {
  text: string
  cosine_score: number
  confidence_tier: 'high' | 'medium' | 'low'
  line_start: number
  line_end: number
  section: string
}

export interface SectionScore {
  section: string
  score: number
  weight: number
}

export interface CandidateResult {
  evaluation_id: number
  candidate_id: number
  resume_id: number
  candidate_name: string
  candidate_email: string
  candidate_phone?: string | null
  candidate_current_title?: string | null
  candidate_experience_level?: string | null
  candidate_years_experience?: number | null
  candidate_graduation_year?: number | null
  total_score: number
  skills_matched: number
  skills_total: number
  matched_skill_names: string[]
  project_match_score: number
  project_match_label: 'High' | 'Med' | 'Low'
  status: ShortlistStatus | 'pending' | 'parsing' | 'scoring' | 'done' | 'error'
  job_role_id: number
  job_role_title: string
  needs_manual_review: boolean
  evaluated_at: string
  email_sent_at: string | null
  email_opened_at: string | null
  candidate_stage: CandidateStage
  tfidf_score: number | null
  filter_stage: 'llm_scored' | 'tfidf_filtered' | 'experience_filtered'
  github_skill_gap_severity?: 'low' | 'medium' | 'high' | null
  missed_requirements?: string[]
}

export interface PaginatedResults {
  items: CandidateResult[]
  total: number
  page: number
  limit: number
}

export interface EvaluationDetail {
  id: number
  resume_id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string
  job_role_id: number
  job_role_title: string
  total_score: number
  project_score: number
  skill_score: number
  education_score: number
  skills_matched: SkillMatch[]
  skill_gaps: string[]
  excerpts: string[]
  resume_text: string
  resume_sections: ResumeSection[]
  status: string
  shortlist_status: ShortlistStatus | null
  notes: string | null
  evaluated_at: string
  requirements_breakdown: RequirementBreakdown[]
  reasoning_summary?: string | null
  interview_questions?: string[]
  email_sent_at?: string | null
  email_opened_at?: string | null
  github_url?: string | null
  linkedin_url?: string | null
  portfolio_url?: string | null
  confidence_tiers?: { high: string[]; medium: string[]; low: string[] }
  tfidf_score?: number | null
}

export interface ResumeSection {
  type: string
  title: string
  start_line: number
  end_line: number
  text: string
  confidence: number
  weight_multiplier: number
}

export async function updateResumeSections(
  evaluationId: number,
  sections: ResumeSection[]
): Promise<void> {
  await apiClient.patch(`/results/${evaluationId}/sections`, { sections })
}

export async function reclassifyAndRescore(evaluationId: number): Promise<{ sections: number; message: string }> {
  const { data } = await apiClient.post<{ sections: number; message: string }>(
    `/results/${evaluationId}/reclassify-and-rescore`
  )
  return data
}

// ─── Axios Instance ──────────────────────────────────────────────────────────

const getBaseUrl = (): string => {
  const url = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
    // If it's a naked Render host name (e.g. resume-eval-backend-x213)
    if (!url.includes('.')) {
      return `https://${url}.onrender.com`
    }
    return `https://${url}`
  }
  return url
}

export const API_BASE_URL = getBaseUrl()

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach Bearer token
apiClient.interceptors.request.use((config: any) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: silent refresh on 401, then redirect if refresh also fails
let _refreshing: Promise<string> | null = null

apiClient.interceptors.response.use(
  (response: any) => response,
  async (error: any) => {
    const original = error.config
    if (
      error.response?.status === 401 &&
      !original._retried &&
      !original.url?.includes('/auth/')
    ) {
      original._retried = true
      const storedRefresh = localStorage.getItem('refresh_token')
      if (storedRefresh) {
        try {
          if (!_refreshing) {
            _refreshing = apiClient
              .post<AuthResponse>('/auth/refresh', { refresh_token: storedRefresh })
              .then((r) => {
                localStorage.setItem('token', r.data.access_token)
                localStorage.setItem('refresh_token', r.data.refresh_token)
                // Sync Zustand store so auth-store persists the new token;
                // without this, page reload would rehydrate the old expired token
                import('../store/useAppStore').then(({ useAppStore }) => {
                  useAppStore.getState().setAuth(r.data.access_token, r.data.role, r.data.email)
                })
                return r.data.access_token
              })
              .finally(() => { _refreshing = null })
          }
          const newToken = await _refreshing
          original.headers.Authorization = `Bearer ${newToken}`
          return apiClient(original)
        } catch {
          // refresh failed — fall through to logout
        }
      }
      import('../store/useAppStore').then(({ useAppStore }) => {
        useAppStore.getState().clearAuth()
      })
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  return data
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>('/auth/login', {
    email,
    password,
  })
  return data
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export async function getSkills(params?: SkillsParams): Promise<PaginatedSkills> {
  const { data } = await apiClient.get<PaginatedSkills>('/skills', { params })
  return data
}

export async function createSkill(name: string, category: string): Promise<Skill> {
  const { data } = await apiClient.post<Skill>('/skills', { name, category })
  return data
}

export async function deleteSkill(id: number): Promise<void> {
  await apiClient.delete(`/skills/${id}`)
}

export async function extractSkillsFromJd(text: string): Promise<{ skill_ids: number[]; skill_names: string[]; skill_required: boolean[] }> {
  const { data } = await apiClient.post<{ skill_ids: number[]; skill_names: string[]; skill_required: boolean[] }>(
    '/skills/extract-from-jd',
    { text }
  )
  return data
}

// ─── Job Roles ───────────────────────────────────────────────────────────────

export async function getJobRoles(): Promise<JobRole[]> {
  const { data } = await apiClient.get<JobRole[]>('/job-roles')
  return data
}

export async function createJobRole(payload: JobRoleCreate): Promise<JobRole> {
  const { data } = await apiClient.post<JobRole>('/job-roles', payload)
  return data
}

export async function updateJobRole(id: number, payload: JobRoleCreate): Promise<JobRole> {
  const { data } = await apiClient.put<JobRole>(`/job-roles/${id}`, payload)
  return data
}

export async function deleteJobRole(id: number): Promise<void> {
  await apiClient.delete(`/job-roles/${id}`)
}

export async function updateRequirements(
  roleId: number,
  requirements: Omit<JobRoleRequirement, 'id'>[]
): Promise<JobRoleRequirement[]> {
  const { data } = await apiClient.put<JobRoleRequirement[]>(
    `/job-roles/${roleId}/requirements`,
    { requirements }
  )
  return data
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface ParseSettings {
  ocrFallback: boolean
  stripHeaders: boolean
  detectTables: boolean
  multilingualNlp: boolean
}

export async function uploadResume(
  file: File,
  candidateName: string,
  candidateEmail: string,
  parseSettings?: ParseSettings
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('candidate_name', candidateName)
  form.append('candidate_email', candidateEmail)
  if (parseSettings) {
    form.append('ocr_fallback', String(parseSettings.ocrFallback))
    form.append('strip_headers', String(parseSettings.stripHeaders))
    form.append('detect_tables', String(parseSettings.detectTables))
    form.append('multilingual_nlp', String(parseSettings.multilingualNlp))
  }
  const { data } = await apiClient.post<UploadResponse>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ─── Evaluate ────────────────────────────────────────────────────────────────

export async function runEvaluation(
  jobRoleId: number,
  resumeIds?: number[],
  weights?: ScoringWeights
): Promise<{ job_id: string; queued_count: number }> {
  const { data } = await apiClient.post<{ job_id: string; queued_count: number }>('/evaluate', {
    job_role_id: jobRoleId,
    resume_ids: resumeIds,
    weights,
  })
  return data
}

export async function bulkRerun(jobRoleId: number): Promise<void> {
  await apiClient.post(`/evaluate/rerun`, { job_role_id: jobRoleId })
}

export async function pauseEvaluation(jobRoleId: number): Promise<void> {
  await apiClient.post(`/evaluate/pause?job_role_id=${jobRoleId}`)
}

export async function resumeEvaluation(jobRoleId: number): Promise<{ queued_count: number; message?: string }> {
  const { data } = await apiClient.post<{ queued_count: number; message?: string }>(
    `/evaluate/resume?job_role_id=${jobRoleId}`
  )
  return data
}

export interface ResultsSummary {
  total: number
  avg_score: number
  shortlisted: number
  needs_review: number
  pending: number
  tfidf_filtered: number
  experience_filtered: number
  queued: number
}

export async function getResultsSummary(jobRoleId?: number): Promise<ResultsSummary> {
  const params: Record<string, unknown> = {}
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<ResultsSummary>('/results/summary', { params })
  return data
}

export interface EvaluationStatus {
  job_role_id: number
  total: number
  scored: number
  queued: number
  processing: number
  filtered: number
  error: number
  in_progress: boolean
  paused: boolean
}

export async function getEvaluationStatus(jobRoleId: number): Promise<EvaluationStatus> {
  const { data } = await apiClient.get<EvaluationStatus>(`/evaluate/status?job_role_id=${jobRoleId}`)
  return data
}

export async function sendNextStepsEmail(
  evaluationId: number,
  force = false
): Promise<{ sent: boolean; message: string }> {
  const { data } = await apiClient.post<{ sent: boolean; message: string }>(
    `/evaluate/${evaluationId}/send-next-steps`,
    { force }
  )
  return data
}

// ─── Candidate utilities ─────────────────────────────────────────────────────

export async function reparseCandidate(candidateId: number): Promise<{ name: string; graduation_year: number | null }> {
  const { data } = await apiClient.post<{ name: string; graduation_year: number | null }>(
    `/candidates/${candidateId}/reparse`
  )
  return data
}

export async function reparseAllCandidates(): Promise<{ updated: number; total: number }> {
  const { data } = await apiClient.post<{ updated: number; total: number }>('/candidates/reparse-all')
  return data
}

// ─── Resume Management ───────────────────────────────────────────────────────

export async function getResumes(): Promise<UploadResponse[]> {
  const { data } = await apiClient.get<UploadResponse[]>('/upload')
  return data
}

export async function deleteResume(resumeId: number): Promise<void> {
  await apiClient.delete(`/upload/${resumeId}`)
}

export async function deleteAllResumes(): Promise<{ message: string }> {
  const { data } = await apiClient.delete<{ message: string }>('/upload')
  return data
}

export async function archiveResume(resumeId: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/upload/${resumeId}/archive`)
  return data
}

export async function hardDeleteCandidate(candidateId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}/permanent`)
}

export async function retryInboundEmail(emailId: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/inbound-emails/${emailId}/retry`)
  return data
}

// ─── Results ─────────────────────────────────────────────────────────────────

export async function getResults(params?: ResultsParams): Promise<PaginatedResults> {
  const { data } = await apiClient.get<PaginatedResults>('/results', { params })
  return data
}

export async function getResultDetail(evaluationId: number): Promise<EvaluationDetail> {
  const { data } = await apiClient.get<EvaluationDetail>(`/results/${evaluationId}`)
  return data
}

export interface CompareAnalysisResponse {
  analysis: string
  common_skills: string[]
  only_a: string[]
  only_b: string[]
  shared_count: number
  only_a_count: number
  only_b_count: number
  best_pick_name?: string
  score_diff?: number
  github_a?: string
  github_b?: string
}

export async function getCompareAnalysis(a: number, b: number): Promise<CompareAnalysisResponse> {
  const { data } = await apiClient.get<CompareAnalysisResponse>('/results/compare-analysis', { params: { a, b } })
  return data
}


export async function deleteResult(evaluationId: number): Promise<void> {
  await apiClient.delete(`/results/${evaluationId}`)
}

export async function deleteAllResults(jobRoleId: number): Promise<void> {
  await apiClient.delete(`/results/all?job_role_id=${jobRoleId}`)
}

// ─── Shortlist / Outcomes ────────────────────────────────────────────────────

export async function shortlistCandidate(
  evaluationId: number,
  status: ShortlistStatus,
  note?: string
): Promise<void> {
  await apiClient.post('/shortlist', { evaluation_id: evaluationId, status, note })
}

export async function recordOutcome(candidateId: number, outcome: OutcomeType): Promise<void> {
  await apiClient.post(`/candidates/${candidateId}/outcome`, { outcome })
}

export async function sendCandidateEmail(
  evaluationId: number,
  subject: string,
  body: string
): Promise<void> {
  await apiClient.post(`/results/${evaluationId}/email`, { subject, body })
}

export async function sendRejectionEmail(
  evaluationId: number,
  note?: string
): Promise<{ status: string; message: string }> {
  const { data } = await apiClient.post<{ status: string; message: string }>(
    `/results/${evaluationId}/send-rejection`,
    { note: note ?? null }
  )
  return data
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

export async function getEnrichment(candidateId: number): Promise<EnrichmentData> {
  const { data } = await apiClient.get<EnrichmentData>(`/enrich/${candidateId}`)
  return data
}

export async function enrichGitHub(
  candidateId: number,
  githubUrl?: string,
  jobRoleId?: number
): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/github`, {
    github_url: githubUrl ?? null,
    job_role_id: jobRoleId ?? null,
  })
  return data
}

export async function enrichLinkedIn(
  candidateId: number,
  linkedinUrl?: string
): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/linkedin`, {
    linkedin_url: linkedinUrl ?? null,
  })
  return data
}

export async function enrichPortfolio(candidateId: number): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/portfolio`)
  return data
}

export async function setIntakePause(roleId: number, paused: boolean): Promise<JobRole> {
  const { data } = await apiClient.patch<JobRole>(`/job-roles/${roleId}/intake`, { paused })
  return data
}

// ─── Inbound Emails ──────────────────────────────────────────────────────────

export interface InboundEmailItem {
  id: number
  message_id: string
  sender_email: string | null
  subject: string | null
  received_at: string
  job_id: number | null
  job_title: string | null
  status: 'new' | 'processed' | 'failed' | 'no_attachment'
  error_message: string | null
  attachment_count: number
}

export interface PaginatedInboundEmails {
  items: InboundEmailItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface ImapConfig {
  enabled: boolean
  method: 'imap' | 'graph' | 'none'
  host: string | null
  port: number
  poll_interval: number
  stats: {
    total: number
    processed: number
    failed: number
    no_attachment: number
  }
}

export async function getImapConfig(): Promise<ImapConfig> {
  const { data } = await apiClient.get<ImapConfig>('/inbound-emails/config')
  return data
}

export type IngestionMethod = 'disabled' | 'imap' | 'graph' | 'auto'

export async function getIngestionMethod(): Promise<{ method: IngestionMethod }> {
  const { data } = await apiClient.get<{ method: IngestionMethod }>('/admin/email-ingestion-method')
  return data
}

export async function setIngestionMethod(method: IngestionMethod): Promise<{ method: IngestionMethod; message: string }> {
  const { data } = await apiClient.post('/admin/email-ingestion-method', { method })
  return data
}

export async function getInboundEmails(params?: {
  status?: string
  search?: string
  page?: number
  limit?: number
}): Promise<PaginatedInboundEmails> {
  const { data } = await apiClient.get<PaginatedInboundEmails>('/inbound-emails', { params })
  return data
}

export async function deleteInboundEmail(emailId: number): Promise<void> {
  await apiClient.delete(`/inbound-emails/${emailId}`)
}

export async function clearInboundEmails(filterStatus?: string): Promise<{ deleted: number; message: string }> {
  const { data } = await apiClient.delete<{ deleted: number; message: string }>(
    '/inbound-emails',
    { params: filterStatus ? { status: filterStatus } : undefined }
  )
  return data
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface SkillMatchRate {
  skill_name: string
  matched_count: number
  total: number
  match_rate: number
}

export interface ScoreBucket {
  range: string
  count: number
}

export interface DailyCount {
  date: string
  count: number
}

export interface SectionAverages {
  projects: number
  skills: number
  education: number
}

export interface StageFunnelItem {
  stage: string
  label: string
  count: number
}

export interface AnalyticsData {
  total_evaluated: number
  avg_score: number
  score_distribution: ScoreBucket[]
  status_counts: Record<string, number>
  skill_match_rates: SkillMatchRate[]
  top_skill_gaps: string[]
  experience_level_counts: Record<string, number>
  avg_score_by_level: Record<string, number>
  section_averages: SectionAverages
  evaluations_per_day: DailyCount[]
  needs_review_count: number
  stage_funnel: StageFunnelItem[]
}

export async function getAnalytics(jobRoleId?: number, days = 30): Promise<AnalyticsData> {
  const params: Record<string, unknown> = { days }
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<AnalyticsData>('/analytics', { params })
  return data
}

export interface CalibrationBucket {
  range: string
  score_min: number
  score_max: number
  total: number
  hired: number
  rejected: number
  hire_rate: number
}

export interface ThresholdOption {
  threshold: number
  precision: number
  recall: number
  f1: number
  candidates_above: number
}

export interface CalibrationData {
  buckets: CalibrationBucket[]
  total_with_outcomes: number
  total_hired: number
  total_rejected: number
  suggested_threshold: number | null
  threshold_options: ThresholdOption[]
}

export async function getCalibration(jobRoleId?: number): Promise<CalibrationData> {
  const params: Record<string, unknown> = {}
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<CalibrationData>('/analytics/calibration', { params })
  return data
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number
  email: string
  role: string
  is_active: boolean
  created_at: string
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await apiClient.get<AdminUser[]>('/admin/users')
  return data
}

export async function createAdminUser(email: string, role: string): Promise<AdminUser> {
  const { data } = await apiClient.post<AdminUser>('/admin/users', { email, role })
  return data
}

export async function resetAdminUserPassword(userId: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/admin/users/${userId}/reset-password`)
  return data
}

export async function revokeUser(userId: number): Promise<AdminUser> {
  const { data } = await apiClient.patch<AdminUser>(`/admin/users/${userId}/revoke`)
  return data
}

export async function deleteUser(userId: number): Promise<void> {
  await apiClient.delete(`/admin/users/${userId}`)
}

export async function bulkShortlist(
  evaluationIds: number[],
  status: ShortlistStatus,
  note?: string
): Promise<{ updated: number; missing: number[] }> {
  const { data } = await apiClient.post<{ updated: number; missing: number[] }>(
    '/shortlist/bulk',
    { evaluation_ids: evaluationIds, status, note }
  )
  return data
}

export async function bulkDelete(evaluationIds: number[]): Promise<{ deleted: number }> {
  if (evaluationIds.length === 0) return { deleted: 0 }
  const { data } = await apiClient.post<{ deleted: number }>('/results/bulk-delete', { ids: evaluationIds })
  return data
}

export async function autoApplyShortlist(jobRoleId: number): Promise<{ applied: number; total_qualifying: number }> {
  const { data } = await apiClient.post<{ applied: number; total_qualifying: number }>(
    `/shortlist/auto-apply?job_role_id=${jobRoleId}`
  )
  return data
}

export async function extractJdText(file: File): Promise<{ text: string; page_count: number }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post<{ text: string; page_count: number }>(
    '/admin/jd-extract',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data
}

export interface SystemStatus {
  smtp_configured: boolean
  llm_configured: boolean
  llm_provider: string
  llm_model: string | null
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const { data } = await apiClient.get<SystemStatus>('/admin/system-status')
  return data
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export interface EmailTemplate {
  key: string
  subject: string
  body_text: string
  updated_at: string | null
}

export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  next_steps: 'Shortlist / Next Steps',
  rejection: 'Rejection',
  coding_invite: 'Coding Assessment Invite',
  interview_invite: 'Technical Interview Invite',
  github_request: 'Request GitHub Profile',
}

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const { data } = await apiClient.get<EmailTemplate[]>('/admin/email-templates')
  return data
}

export async function updateEmailTemplate(
  key: string,
  subject: string,
  body_text: string
): Promise<EmailTemplate> {
  const { data } = await apiClient.put<EmailTemplate>(`/admin/email-templates/${key}`, { subject, body_text })
  return data
}

export async function resetEmailTemplate(key: string): Promise<EmailTemplate> {
  const { data } = await apiClient.delete<EmailTemplate>(`/admin/email-templates/${key}/reset`)
  return data
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/auth/forgot-password', { email })
  return data
}

export async function bulkSendNextSteps(
  jobRoleId: number
): Promise<{ sent: number; skipped: number; errors: number; message: string }> {
  const { data } = await apiClient.post<{ sent: number; skipped: number; errors: number; message: string }>(
    `/evaluate/bulk-send-next-steps?job_role_id=${jobRoleId}`
  )
  return data
}

export type CandidateStage = 'applied' | 'screening' | 'coding' | 'interview' | 'offer' | 'hired' | 'rejected'

export async function updateCandidateStage(
  candidateId: number,
  stage: CandidateStage
): Promise<{ candidate_id: number; stage: CandidateStage }> {
  const { data } = await apiClient.patch<{ candidate_id: number; stage: CandidateStage }>(
    `/results/candidates/${candidateId}/stage`,
    { stage }
  )
  return data
}

export interface ImapSettings {
  imap_host: string
  imap_port: number
  imap_username: string
  imap_password_set: boolean
  imap_ssl: boolean
  imap_folder: string
  imap_subject_keywords: string
  configured: boolean
}

export async function getImapSettings(): Promise<ImapSettings> {
  const { data } = await apiClient.get<ImapSettings>('/admin/imap-settings')
  return data
}

export async function saveImapSettings(payload: {
  imap_host: string
  imap_port: number
  imap_username: string
  imap_password: string
  imap_ssl: boolean
  imap_folder: string
  imap_subject_keywords: string
}): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/imap-settings', payload)
  return data
}

export async function testImapConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-imap')
  return data
}

export async function testSmtpConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-smtp')
  return data
}

// ─── Microsoft Graph API Settings ────────────────────────────────────────────

export interface GraphSettings {
  graph_client_id: string
  graph_tenant_id: string
  graph_client_secret_set: boolean
  graph_mailbox: string
  graph_folder: string
  graph_subject_keywords: string
  graph_fetch_from_date: string
  graph_fetch_to_date: string
  configured: boolean
}

export async function getGraphSettings(): Promise<GraphSettings> {
  const { data } = await apiClient.get<GraphSettings>('/admin/graph-settings')
  return data
}

export async function saveGraphSettings(payload: {
  graph_client_id: string
  graph_tenant_id: string
  graph_client_secret: string
  graph_mailbox: string
  graph_folder: string
  graph_subject_keywords: string
  graph_fetch_from_date: string
  graph_fetch_to_date: string
}): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/graph-settings', payload)
  return data
}

export async function testGraphConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-graph')
  return data
}

export async function triggerGraphFetch(fromDate?: string, toDate?: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/trigger-graph-fetch', {
    from_date: fromDate ?? '',
    to_date: toDate ?? '',
    tz_offset_minutes: new Date().getTimezoneOffset(),
  })
  return data
}

export async function stopGraphFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/stop-graph-fetch')
  return data
}

export async function triggerImapFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/trigger-imap-fetch')
  return data
}

export async function stopImapFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/stop-imap-fetch')
  return data
}

export async function reclassifyExperienceLevels(): Promise<{ updated: number; total: number }> {
  const { data } = await apiClient.post<{ updated: number; total: number }>('/admin/reclassify-experience-levels')
  return data
}

// ─── Candidate Search ─────────────────────────────────────────────────────────

export interface CandidateSearchItem {
  id: number
  name: string
  email: string | null
  phone: string | null
  current_title: string | null
  experience_level: string | null
  years_experience: number | null
  stage: string
  source: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  latest_job_role: string | null
  latest_evaluation_id: number | null
}

export interface PaginatedCandidates {
  items: CandidateSearchItem[]
  total: number
  page: number
  limit: number
  pages: number
}

// ─── Interview Feedback ───────────────────────────────────────────────────────

export interface InterviewFeedback {
  id: number
  candidate_id: number
  evaluation_id: number | null
  interviewer_email: string | null
  stage: string
  rating: number
  technical_score: number | null
  communication_score: number | null
  culture_fit_score: number | null
  recommendation: string | null
  notes: string | null
  created_at: string
}

export interface FeedbackCreate {
  candidate_id: number
  evaluation_id?: number | null
  stage: 'screening' | 'coding' | 'interview'
  rating: number
  technical_score?: number | null
  communication_score?: number | null
  culture_fit_score?: number | null
  recommendation?: string | null
  notes?: string | null
}

export async function getFeedbackForCandidate(candidateId: number): Promise<InterviewFeedback[]> {
  const { data } = await apiClient.get<InterviewFeedback[]>(`/interview-feedback/candidate/${candidateId}`)
  return data
}

export async function createFeedback(body: FeedbackCreate): Promise<InterviewFeedback> {
  const { data } = await apiClient.post<InterviewFeedback>('/interview-feedback', body)
  return data
}

export async function deleteFeedback(feedbackId: number): Promise<void> {
  await apiClient.delete(`/interview-feedback/${feedbackId}`)
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export async function downloadResultsCsv(jobRoleId?: number | null, status?: string): Promise<void> {
  const { data } = await apiClient.get('/results/export/csv', {
    params: {
      ...(jobRoleId != null ? { job_role_id: jobRoleId } : {}),
      ...(status ? { status } : {}),
    },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `candidates_export_${jobRoleId ?? 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Bulk CSV / Excel Import ──────────────────────────────────────────────────

export interface BulkImportResult {
  created: number
  updated: number
  errors: string[]
}

export async function bulkImportCandidates(file: File): Promise<BulkImportResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post<BulkImportResult>('/upload/bulk-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ─── Candidate Search ─────────────────────────────────────────────────────────

export async function searchCandidates(params: {
  q?: string
  stage?: string
  experience_level?: string
  page?: number
  limit?: number
}): Promise<PaginatedCandidates> {
  const { data } = await apiClient.get<PaginatedCandidates>('/candidates/search', { params })
  return data
}

export interface CandidateUpdate {
  name?: string
  email?: string
  phone?: string
  current_title?: string
  experience_level?: string
  years_experience?: number | null
  linkedin_url?: string | null
  github_url?: string | null
  portfolio_url?: string | null
  stage?: string
}

export async function updateCandidate(candidateId: number, data: CandidateUpdate): Promise<CandidateSearchItem> {
  const { data: res } = await apiClient.patch<CandidateSearchItem>(`/candidates/${candidateId}`, data)
  return res
}

export async function deleteCandidate(candidateId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}`)
}

export async function bulkDeleteCandidates(ids: number[]): Promise<{ deleted: number }> {
  const { data } = await apiClient.post<{ deleted: number }>('/candidates/bulk-delete', { ids })
  return data
}

// ─── Candidate Comments ───────────────────────────────────────────────────────

export interface CandidateComment {
  id: number
  candidate_id: number
  author_id: number | null
  author_email: string | null
  body: string
  created_at: string
  updated_at: string | null
}

export async function getComments(candidateId: number): Promise<CandidateComment[]> {
  const { data } = await apiClient.get<CandidateComment[]>(`/candidates/${candidateId}/comments`)
  return data
}

export async function createComment(candidateId: number, body: string): Promise<CandidateComment> {
  const { data } = await apiClient.post<CandidateComment>(`/candidates/${candidateId}/comments`, { body })
  return data
}

export async function updateComment(candidateId: number, commentId: number, body: string): Promise<CandidateComment> {
  const { data } = await apiClient.patch<CandidateComment>(`/candidates/${candidateId}/comments/${commentId}`, { body })
  return data
}

export async function deleteComment(candidateId: number, commentId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}/comments/${commentId}`)
}

// ─── Resume Full-text Search ──────────────────────────────────────────────────

export interface ResumeSearchHit {
  evaluation_id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string | null
  job_role_title: string
  total_score: number
  snippet: string
}

export interface ResumeSearchResponse {
  hits: ResumeSearchHit[]
  total: number
}

export async function searchResumes(params: {
  q: string
  job_role_id?: number
  page?: number
  limit?: number
}): Promise<ResumeSearchResponse> {
  const { data } = await apiClient.get<ResumeSearchResponse>('/results/search', { params })
  return data
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number
  user_id: number | null
  user_email: string | null
  action: string
  target_type: string | null
  target_id: number | null
  details: Record<string, any> | null
  timestamp: string
}

export interface PaginatedAuditLog {
  items: AuditLogEntry[]
  total: number
  page: number
  limit: number
  pages: number
}

export async function getAuditLog(params: {
  target_type?: string
  target_id?: number
  action?: string
  page?: number
  limit?: number
}): Promise<PaginatedAuditLog> {
  const { data } = await apiClient.get<PaginatedAuditLog>('/audit-log', { params })
  return data
}

// ─── Manual Evaluation ────────────────────────────────────────────────────────

export interface ManualEvaluationPayload {
  manual_score: number
  justification?: string | null
  skills_checklist?: Record<string, boolean> | null
}

export interface ManualEvaluation {
  id: number
  evaluation_id: number
  recruiter_id: number | null
  manual_score: number
  justification: string | null
  skills_checklist: Record<string, boolean> | null
  created_at: string
  updated_at: string | null
}

export async function postManualEvaluation(
  evaluationId: number,
  payload: ManualEvaluationPayload
): Promise<ManualEvaluation> {
  const { data } = await apiClient.post<ManualEvaluation>(
    `/resumes/${evaluationId}/manual-evaluation`,
    payload
  )
  return data
}

export async function getManualEvaluation(evaluationId: number): Promise<ManualEvaluation> {
  const { data } = await apiClient.get<ManualEvaluation>(`/resumes/${evaluationId}/manual-evaluation`)
  return data
}

// ─── SharePoint Config ────────────────────────────────────────────────────────

export interface SharePointConfig {
  site_url: string | null
  list_name: string | null
  status_column: string
  enabled: boolean
}

export async function getSharePointConfig(): Promise<SharePointConfig> {
  const { data } = await apiClient.get<SharePointConfig>('/admin/sharepoint/config')
  return data
}

export async function saveSharePointConfig(config: SharePointConfig): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/sharepoint/connect', config)
  return data
}

// ─── OneDrive Config ──────────────────────────────────────────────────────────

export interface OneDriveConfig {
  folder_id: string | null
  folder_name: string | null
  poll_interval_minutes: number
  enabled: boolean
}

export async function getOneDriveConfig(): Promise<OneDriveConfig> {
  const { data } = await apiClient.get<OneDriveConfig>('/admin/onedrive/config')
  return data
}

export async function saveOneDriveConfig(config: OneDriveConfig): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/onedrive/config', config)
  return data
}

export function getResumeFileUrl(resumeId: number): string {
  const baseUrl = API_BASE_URL
  const token = localStorage.getItem('token') ?? ''
  return `${baseUrl}/upload/${resumeId}/file?token=${encodeURIComponent(token)}`
}

export default apiClient
