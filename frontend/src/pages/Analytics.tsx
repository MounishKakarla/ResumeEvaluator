import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, ReferenceLine,
} from 'recharts'
import { getAnalytics, getCalibration } from '../api/client'
import type { SkillMatchRate, CalibrationBucket, StageFunnelItem } from '../api/client'
import { useAppStore } from '../store/useAppStore'

const STAGE_COLORS: Record<string, string> = {
  applied:   '#9CA3AF',
  screening: '#534AB7',
  coding:    '#3B82F6',
  interview: '#EF9F27',
  offer:     '#1D9E75',
  hired:     '#085041',
  rejected:  '#E24B4A',
}

const HISTOGRAM_FILL = [
  '#E24B4A', '#E24B4A', '#EF9F27', '#EF9F27', '#EF9F27',
  '#1D9E75', '#1D9E75', '#1D9E75', '#534AB7', '#534AB7',
]

export default function Analytics() {
  const navigate = useNavigate()
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)
  const [days, setDays] = useState(30)

  function drillDownToScore(range: string) {
    const [min, max] = range.split('-').map(Number)
    navigate(`/leaderboard?scoreMin=${min}&scoreMax=${max}`)
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', selectedJobRoleId, days],
    queryFn: () => getAnalytics(selectedJobRoleId ?? undefined, days),
  })

  const { data: calibration } = useQuery({
    queryKey: ['calibration', selectedJobRoleId],
    queryFn: () => getCalibration(selectedJobRoleId ?? undefined),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-gray-400">
        Loading analytics…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-[#791F1F]">
        Failed to load analytics data.
      </div>
    )
  }

  const { section_averages: sa, status_counts: sc } = data

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Analytics</h1>
        <select
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {data.total_evaluated === 0 && (
        <div className="bg-[#FAEEDA] border border-[#EF9F27]/30 rounded-xl p-6 text-center text-[#633806] text-sm">
          No evaluation data available. Run evaluations first.
        </div>
      )}

      {/* ── Summary Metric Cards ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'Total Evaluated', value: data.total_evaluated, color: '#534AB7', bg: '#EEEDFE' },
          { label: 'Avg Score', value: `${data.avg_score}`, color: '#1D9E75', bg: '#E1F5EE' },
          { label: 'Shortlisted', value: sc.shortlisted ?? 0, color: '#EF9F27', bg: '#FAEEDA' },
          { label: 'Needs Review', value: data.needs_review_count, color: '#E24B4A', bg: '#FCEBEB' },
          { label: 'Rejected', value: sc.rejected ?? 0, color: '#6B7280', bg: '#F3F4F6' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="rounded-xl border p-4" style={{ backgroundColor: bg, borderColor: color + '40' }}>
            <p className="text-xs font-medium mb-1" style={{ color }}>{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Section Averages ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Avg Projects Score', value: sa.projects, color: '#534AB7' },
          { label: 'Avg Skills Score', value: sa.skills, color: '#1D9E75' },
          { label: 'Avg Education Score', value: sa.education, color: '#EF9F27' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{label}</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-2 rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
              </div>
              <span className="text-sm font-bold" style={{ color }}>{value}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Score Distribution ───────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Score Distribution</h2>
          <p className="text-xs text-gray-400 italic">Click a bar to view candidates in that range</p>
        </div>
        <p className="text-xs text-gray-400 mb-4">Candidates per 10-point score bucket</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data.score_distribution}
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="range" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(val: number) => [val, 'Candidates']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              cursor={{ fill: 'rgba(83,74,183,0.08)' }}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              onClick={(entry: { range: string }) => { if (entry.range) drillDownToScore(entry.range) }}
            >
              {data.score_distribution.map((_, idx) => (
                <Cell key={idx} fill={HISTOGRAM_FILL[idx]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Evaluations Over Time ────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Evaluations Over Time</h2>
        <p className="text-xs text-gray-400 mb-4">Daily submission count for the selected period</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.evaluations_per_day} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)}
              interval={Math.floor(data.evaluations_per_day.length / 8)}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Line type="monotone" dataKey="count" stroke="#534AB7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Per-Skill Match Rates ────────────────────────────── */}
      {data.skill_match_rates.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Skill Match Rates</h2>
          <p className="text-xs text-gray-400 mb-4">
            % of candidates who matched each required skill (sorted by weakest first)
          </p>
          <div className="space-y-2">
            {data.skill_match_rates.map((row: SkillMatchRate) => {
              const pct = Math.round(row.match_rate)
              const color = pct >= 75 ? '#1D9E75' : pct >= 50 ? '#EF9F27' : '#E24B4A'
              return (
                <div key={row.skill_name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-40 truncate shrink-0">{row.skill_name}</span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right" style={{ color }}>{pct}%</span>
                  <span className="text-xs text-gray-400 w-16 text-right shrink-0">{row.matched_count}/{row.total}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Top Skill Gaps ───────────────────────────────────── */}
      {data.top_skill_gaps.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Top Skill Gaps</h2>
          <p className="text-xs text-gray-400 mb-3">Skills matched by fewer than 50% of candidates</p>
          <div className="flex flex-wrap gap-2">
            {data.top_skill_gaps.map((skill) => (
              <span key={skill} className="text-xs px-2.5 py-1 rounded-full border bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Hiring Stage Funnel ─────────────────────────────── */}
      {data.stage_funnel && data.stage_funnel.some((s: StageFunnelItem) => s.count > 0) && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Hiring Stage Funnel</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Candidate distribution across each stage of the pipeline
          </p>
          <div className="space-y-2.5">
            {(() => {
              const maxCount = Math.max(...data.stage_funnel.map((s: StageFunnelItem) => s.count), 1)
              return data.stage_funnel.map((item: StageFunnelItem) => (
                <div key={item.stage} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-24 shrink-0">{item.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-5 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{
                        width: item.count === 0 ? '0%' : `${Math.max(4, (item.count / maxCount) * 100)}%`,
                        backgroundColor: STAGE_COLORS[item.stage] ?? '#9CA3AF',
                      }}
                    >
                      {item.count > 0 && (
                        <span className="text-[10px] font-bold text-white leading-none">{item.count}</span>
                      )}
                    </div>
                  </div>
                  {item.count === 0 && (
                    <span className="text-xs text-gray-300 dark:text-gray-600 w-4">0</span>
                  )}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* ── Experience Level Diversity ──────────────────────── */}
      {data.experience_level_counts && Object.keys(data.experience_level_counts).length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Experience Level Breakdown</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Distribution of candidates by seniority and average score per level</p>
          <div className="space-y-2.5">
            {(['junior', 'mid', 'senior', 'executive', 'unknown'] as const).map((lvl) => {
              const count = (data.experience_level_counts as Record<string, number>)[lvl] ?? 0
              if (count === 0) return null
              const maxCount = Math.max(...Object.values(data.experience_level_counts as Record<string, number>), 1)
              const avgScore = (data.avg_score_by_level as Record<string, number>)[lvl]
              const levelColors: Record<string, string> = {
                junior: '#3B82F6', mid: '#534AB7', senior: '#1D9E75', executive: '#EF9F27', unknown: '#9CA3AF',
              }
              return (
                <div key={lvl} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-20 shrink-0 capitalize">{lvl}</span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                      style={{ width: `${Math.max(4, (count / maxCount) * 100)}%`, backgroundColor: levelColors[lvl] }}
                    >
                      <span className="text-[10px] font-bold text-white leading-none">{count}</span>
                    </div>
                  </div>
                  {avgScore != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-16 shrink-0 text-right">avg {avgScore}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Score Calibration ────────────────────────────────── */}
      {calibration && calibration.total_with_outcomes > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Score Calibration</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Hire rate per score bucket — based on {calibration.total_with_outcomes} candidates with recorded outcomes
                ({calibration.total_hired} hired, {calibration.total_rejected} rejected)
              </p>
            </div>
            {calibration.suggested_threshold != null && (
              <div className="shrink-0 ml-4 text-right">
                <p className="text-xs text-gray-400">Suggested threshold</p>
                <p className="text-2xl font-bold text-[#534AB7]">{calibration.suggested_threshold}</p>
                <p className="text-xs text-gray-400">maximises F1 score</p>
              </div>
            )}
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={calibration.buckets}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
                label={{ value: 'Hire rate %', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10, fill: '#9ca3af' } }}
              />
              <Tooltip
                formatter={(val: number, _name: string, props: { payload?: CalibrationBucket }) => {
                  const b = props.payload
                  if (!b) return [`${val}%`, 'Hire rate']
                  return [`${val}% (${b.hired}/${b.total} with outcomes)`, 'Hire rate']
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              {calibration.suggested_threshold != null && (
                <ReferenceLine
                  x={`${calibration.suggested_threshold}-${calibration.suggested_threshold + 10}`}
                  stroke="#534AB7"
                  strokeDasharray="4 3"
                  label={{ value: 'Threshold', position: 'top', fontSize: 10, fill: '#534AB7' }}
                />
              )}
              <Bar dataKey="hire_rate" radius={[4, 4, 0, 0]}>
                {calibration.buckets.map((b) => (
                  <Cell
                    key={b.range}
                    fill={b.hire_rate >= 75 ? '#1D9E75' : b.hire_rate >= 50 ? '#EF9F27' : '#E24B4A'}
                    fillOpacity={b.total === 0 ? 0.2 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Threshold comparison table */}
          {calibration.threshold_options.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="pb-1 pr-4 font-medium">Threshold</th>
                    <th className="pb-1 pr-4 font-medium">Candidates above</th>
                    <th className="pb-1 pr-4 font-medium">Precision</th>
                    <th className="pb-1 pr-4 font-medium">Recall</th>
                    <th className="pb-1 font-medium">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.threshold_options.map((opt) => {
                    const isBest = opt.threshold === calibration.suggested_threshold
                    return (
                      <tr
                        key={opt.threshold}
                        className={`border-b border-gray-50 dark:border-gray-800 ${isBest ? 'bg-[#EEEDFE] dark:bg-[#1e1a3f]' : ''}`}
                      >
                        <td className={`py-1 pr-4 font-semibold ${isBest ? 'text-[#534AB7]' : 'text-gray-700 dark:text-gray-300'}`}>
                          ≥ {opt.threshold}
                          {isBest && <span className="ml-1 text-[10px] bg-[#534AB7] text-white px-1 rounded">best</span>}
                        </td>
                        <td className="py-1 pr-4 text-gray-600 dark:text-gray-400">{opt.candidates_above}</td>
                        <td className="py-1 pr-4 text-gray-600 dark:text-gray-400">{opt.precision}%</td>
                        <td className="py-1 pr-4 text-gray-600 dark:text-gray-400">{opt.recall}%</td>
                        <td className={`py-1 font-semibold ${opt.f1 >= 70 ? 'text-[#1D9E75]' : opt.f1 >= 50 ? 'text-[#EF9F27]' : 'text-gray-500'}`}>
                          {opt.f1}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty calibration nudge */}
      {calibration && calibration.total_with_outcomes === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Score Calibration</h2>
          <p className="text-xs text-gray-400">
            No outcome data yet. Record hiring outcomes (hired / rejected / withdrew) on candidate profiles to see which score thresholds best predict a successful hire.
          </p>
        </div>
      )}
    </div>
  )
}
