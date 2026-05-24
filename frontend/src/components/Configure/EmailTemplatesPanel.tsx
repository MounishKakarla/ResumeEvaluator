import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getEmailTemplates,
  updateEmailTemplate,
  resetEmailTemplate,
  EMAIL_TEMPLATE_LABELS,
} from '../../api/client'
import type { EmailTemplate } from '../../api/client'

const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40'

export default function EmailTemplatesPanel() {
  const queryClient = useQueryClient()
  const [tplKey, setTplKey] = useState('next_steps')
  const [tplSubject, setTplSubject] = useState('')
  const [tplBody, setTplBody] = useState('')
  const [tplSaveMsg, setTplSaveMsg] = useState<string | null>(null)

  const { data: emailTemplates } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: getEmailTemplates,
  })

  useEffect(() => {
    if (!emailTemplates) return
    const tpl = emailTemplates.find((t: EmailTemplate) => t.key === tplKey)
    if (tpl) { setTplSubject(tpl.subject); setTplBody(tpl.body_text) }
  }, [tplKey, emailTemplates])

  const saveTplMut = useMutation({
    mutationFn: () => updateEmailTemplate(tplKey, tplSubject, tplBody),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      setTplSaveMsg('Saved')
      setTimeout(() => setTplSaveMsg(null), 2000)
    },
  })

  const resetTplMut = useMutation({
    mutationFn: () => resetEmailTemplate(tplKey),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      setTplSubject(data.subject)
      setTplBody(data.body_text)
      setTplSaveMsg('Reset to default')
      setTimeout(() => setTplSaveMsg(null), 2000)
    },
  })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Email Templates</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Customize the subject and body of candidate-facing emails. Use{' '}
        <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded text-[11px]">{'{candidate_name}'}</code>{' '}
        and{' '}
        <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded text-[11px]">{'{job_title}'}</code>{' '}
        as placeholders.
      </p>
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(EMAIL_TEMPLATE_LABELS).map(([key, label]) => {
          const tpl = emailTemplates?.find((t: EmailTemplate) => t.key === key)
          const isCustom = tpl?.updated_at != null
          return (
            <button
              key={key}
              onClick={() => setTplKey(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tplKey === key
                  ? 'bg-[#534AB7] text-white border-[#534AB7]'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#534AB7]'
              }`}
            >
              {label}
              {isCustom && <span className="ml-1 text-[9px] opacity-70">●</span>}
            </button>
          )
        })}
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
          <input
            className={inputCls}
            value={tplSubject}
            onChange={(e) => setTplSubject(e.target.value)}
            placeholder="Email subject…"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Body (plain text)</label>
          <textarea
            rows={8}
            className={`${inputCls} resize-y font-mono text-xs`}
            value={tplBody}
            onChange={(e) => setTplBody(e.target.value)}
            placeholder="Email body…"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => saveTplMut.mutate()}
            disabled={saveTplMut.isPending || !tplSubject.trim() || !tplBody.trim()}
            className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
          >
            {saveTplMut.isPending ? 'Saving…' : 'Save Template'}
          </button>
          <button
            onClick={() => { if (confirm('Reset to default template?')) resetTplMut.mutate() }}
            disabled={resetTplMut.isPending}
            className="border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 text-sm rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {resetTplMut.isPending ? 'Resetting…' : 'Reset to Default'}
          </button>
          {tplSaveMsg && <span className="text-xs text-[#1D9E75] font-medium">{tplSaveMsg}</span>}
        </div>
      </div>
    </div>
  )
}
