import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { postManualEvaluation, getManualEvaluation } from '../../api/client'
import type { CandidateResult } from '../../api/client'

interface ManualEvalPanelProps {
  item: CandidateResult | null
  roleSkillNames: string[]
  onClose: () => void
}

export default function ManualEvalPanel({ item, roleSkillNames, onClose }: ManualEvalPanelProps) {
  const queryClient = useQueryClient()
  const [score, setScore] = useState(50)
  const [justification, setJustification] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)

  const isOpen = item !== null

  // Load existing manual eval if any
  const { data: existing } = useQuery({
    queryKey: ['manual-eval', item?.evaluation_id],
    queryFn: () => getManualEvaluation(item!.evaluation_id),
    enabled: !!item,
    retry: false,
  })

  useEffect(() => {
    if (existing) {
      setScore(existing.manual_score)
      setJustification(existing.justification ?? '')
      setChecklist(existing.skills_checklist ?? {})
    } else if (item) {
      setScore(Math.round(item.total_score))
      setJustification('')
      const init: Record<string, boolean> = {}
      roleSkillNames.forEach((s) => {
        init[s] = item.matched_skill_names?.includes(s) ?? false
      })
      setChecklist(init)
    }
  }, [item, existing, roleSkillNames])

  const submitMut = useMutation({
    mutationFn: () =>
      postManualEvaluation(item!.evaluation_id, {
        manual_score: score,
        justification: justification || null,
        skills_checklist: checklist,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-eval', item?.evaluation_id] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-30 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <aside
        className={`fixed top-0 right-0 h-full w-[420px] bg-white dark:bg-gray-900 shadow-2xl z-40 flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Manual Evaluation</h2>
            {item && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-[300px]">
                {item.candidate_name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Auto Score Reference */}
          {item && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <div className="text-center">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Auto Score</p>
                <p
                  className="text-xl font-bold"
                  style={{ color: item.total_score >= 75 ? '#1D9E75' : item.total_score >= 50 ? '#EF9F27' : '#E24B4A' }}
                >
                  {Math.round(item.total_score)}
                </p>
              </div>
              <svg className="w-4 h-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className="text-center flex-1">
                <p className="text-[10px] text-[#534AB7] dark:text-[#AFA9EC] uppercase tracking-wide font-semibold">Override Score</p>
                <p
                  className="text-xl font-bold"
                  style={{ color: score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A' }}
                >
                  {score}
                </p>
              </div>
            </div>
          )}

          {/* Score Slider */}
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 block">
              Override Score (0–100)
            </label>
            <input
              id="manual-score-slider"
              type="range"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="w-full accent-[#534AB7] mb-1"
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">0</span>
              <input
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="w-16 text-center text-sm font-bold border border-[#534AB7]/30 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600"
              />
              <span className="text-xs text-gray-400">100</span>
            </div>
          </div>

          {/* Skills Checklist */}
          {roleSkillNames.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Skills Checklist</p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {roleSkillNames.map((skill) => (
                  <label
                    key={skill}
                    className="flex items-center gap-2.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={checklist[skill] ?? false}
                      onChange={(e) => setChecklist((prev) => ({ ...prev, [skill]: e.target.checked }))}
                      className="rounded border-gray-300 dark:border-gray-600 accent-[#534AB7]"
                    />
                    <span
                      className={`text-xs font-medium transition-colors ${
                        checklist[skill]
                          ? 'text-[#1D9E75]'
                          : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200'
                      }`}
                    >
                      {skill}
                    </span>
                    {checklist[skill] && (
                      <svg className="w-3 h-3 text-[#1D9E75] ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Recruiter Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 block">
              Recruiter Notes / Justification
            </label>
            <textarea
              id="manual-eval-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Add notes about why the score was overridden…"
              rows={4}
              className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 resize-none placeholder-gray-300 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-4 flex items-center gap-3">
          <button
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
            id="manual-eval-submit"
            className="flex-1 bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            {submitMut.isPending ? 'Saving…' : 'Save Evaluation'}
          </button>
          {saved && (
            <span className="text-xs text-[#1D9E75] font-semibold flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
          {submitMut.isError && (
            <span className="text-xs text-red-500">Save failed</span>
          )}
        </div>
      </aside>
    </>
  )
}
