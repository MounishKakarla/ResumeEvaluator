import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getFeedbackForCandidate, createFeedback, deleteFeedback } from '../../api/client'
import type { InterviewFeedback, FeedbackCreate } from '../../api/client'

interface Props {
  candidateId: number
  evaluationId: number
}

const REC_STYLES: Record<string, string> = {
  strong_hire: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  hire: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  no_hire: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  strong_no_hire: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function FeedbackTab({ candidateId, evaluationId }: Props) {
  const [fbStage, setFbStage] = useState<'screening' | 'coding' | 'interview'>('interview')
  const [fbRating, setFbRating] = useState(3)
  const [fbTech, setFbTech] = useState('')
  const [fbComm, setFbComm] = useState('')
  const [fbCulture, setFbCulture] = useState('')
  const [fbRecommendation, setFbRecommendation] = useState('')
  const [fbNotes, setFbNotes] = useState('')
  const [fbSaved, setFbSaved] = useState(false)

  const { data: feedbackList = [], refetch: refetchFeedback } = useQuery<InterviewFeedback[]>({
    queryKey: ['feedback', candidateId],
    queryFn: () => getFeedbackForCandidate(candidateId),
    enabled: !!candidateId,
  })

  const addFeedbackMut = useMutation({
    mutationFn: () => createFeedback({
      candidate_id: candidateId,
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

  const avg = (arr: (number | null)[]) => {
    const vals = arr.filter((v): v is number => v != null)
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Aggregate summary */}
      {feedbackList.length > 0 && (() => {
        const avgRating = avg(feedbackList.map((f) => f.rating))
        const avgTech = avg(feedbackList.map((f) => f.technical_score))
        const avgComm = avg(feedbackList.map((f) => f.communication_score))
        const avgCulture = avg(feedbackList.map((f) => f.culture_fit_score))
        const recCounts: Record<string, number> = {}
        feedbackList.forEach((f) => { if (f.recommendation) recCounts[f.recommendation] = (recCounts[f.recommendation] ?? 0) + 1 })
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

      {/* Previous feedback entries */}
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
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${REC_STYLES[fb.recommendation] ?? 'bg-gray-100 text-gray-600'}`}>
                      {fb.recommendation.replace('_', ' ')}
                    </span>
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
  )
}
