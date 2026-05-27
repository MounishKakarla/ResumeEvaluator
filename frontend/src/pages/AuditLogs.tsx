import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuditLog } from '../api/client'
import type { AuditLogEntry } from '../api/client'

const inputCls = 'border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 focus:border-[#534AB7] transition placeholder-gray-400 dark:placeholder-gray-500'

export default function AuditLogs() {
  const [auditTargetType, setAuditTargetType] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditPage, setAuditPage] = useState(1)

  const { data: auditData, isFetching: auditFetching } = useQuery({
    queryKey: ['audit-log', auditTargetType, auditAction, auditPage],
    queryFn: () => getAuditLog({
      target_type: auditTargetType || undefined,
      action: auditAction || undefined,
      page: auditPage,
      limit: 50,
    }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audit Logs</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track all changes made to candidates and evaluations</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={auditTargetType}
          onChange={(e) => { setAuditTargetType(e.target.value); setAuditPage(1) }}
          className={`${inputCls} pr-8`}
        >
          <option value="">All entity types</option>
          <option value="candidate">Candidate</option>
          <option value="evaluation">Evaluation</option>
        </select>
        <select
          value={auditAction}
          onChange={(e) => { setAuditAction(e.target.value); setAuditPage(1) }}
          className={`${inputCls} pr-8`}
        >
          <option value="">All actions</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="restore">Restore</option>
        </select>
        {(auditTargetType || auditAction) && (
          <button
            onClick={() => { setAuditTargetType(''); setAuditAction(''); setAuditPage(1) }}
            className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {auditFetching && !auditData && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex gap-3 animate-pulse">
                <div className="w-16 h-4 rounded bg-gray-100 dark:bg-gray-700" />
                <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-700" />
                <div className="w-24 h-4 rounded bg-gray-100 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        )}
        {auditData && auditData.items.length === 0 && (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">No audit entries found.</div>
        )}
        {auditData && auditData.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">When</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">User</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Action</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Entity</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {auditData.items.map((entry: AuditLogEntry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 max-w-[140px] truncate">
                        {entry.user_email ?? <span className="italic text-gray-400">system</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          entry.action === 'delete' ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                          entry.action === 'restore' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
                          'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {entry.target_type} #{entry.target_id}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-xs">
                        {(() => {
                          if (!entry.details) return <span className="italic text-gray-400">—</span>

                          let parsedDetails = entry.details
                          if (typeof parsedDetails === 'string') {
                            try {
                              parsedDetails = JSON.parse(parsedDetails)
                            } catch {
                              return <span className="text-gray-600 dark:text-gray-300">{String(parsedDetails)}</span>
                            }
                          }

                          if (typeof parsedDetails !== 'object' || parsedDetails === null) {
                            return <span className="text-gray-600 dark:text-gray-300">{String(parsedDetails)}</span>
                          }

                          if (Array.isArray(parsedDetails)) {
                            return <span className="text-gray-600 dark:text-gray-300">{JSON.stringify(parsedDetails)}</span>
                          }

                          try {
                            const entries = Object.entries(parsedDetails)
                            if (entries.length === 0) return <span className="italic text-gray-400">—</span>

                             return entries.map(([field, val]) => {
                              const isPair = Array.isArray(val) && val.length === 2
                              const oldVal = isPair ? val[0] : undefined
                              const newVal = isPair ? val[1] : val

                              const formatVal = (v: any) => {
                                if (v === undefined || v === null || v === '') return '—'
                                if ((field === 'tfidf_score' || field === 'tfidf_threshold') && typeof v === 'number') {
                                  return `${Math.round(v * 100)}%`
                                }
                                return String(v)
                              }

                              return (
                                <span key={field} className="mr-3 inline-block">
                                  <span className="font-semibold text-gray-700 dark:text-gray-300 capitalize">{field.replace(/_/g, ' ')}</span>
                                  {': '}
                                  {isPair ? (
                                    <>
                                      <span className="line-through text-gray-400">{formatVal(oldVal)}</span>
                                      {' → '}
                                    </>
                                  ) : null}
                                  <span className="text-gray-800 dark:text-gray-200 font-medium">{formatVal(newVal)}</span>
                                </span>
                              )
                            })
                          } catch {
                            return <span className="text-gray-600 dark:text-gray-300">{JSON.stringify(parsedDetails)}</span>
                          }
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auditData.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {auditData.total} entr{auditData.total !== 1 ? 'ies' : 'y'}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setAuditPage((p) => Math.max(1, p - 1))} disabled={auditPage === 1}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Previous
                  </button>
                  <button onClick={() => setAuditPage((p) => Math.min(auditData.pages, p + 1))} disabled={auditPage === auditData.pages}
                    className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
