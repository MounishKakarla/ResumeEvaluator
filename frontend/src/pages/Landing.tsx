import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import LogoDark from '../assets/Tektalis_Logo_Dark.svg'
import LogoWhite from '../assets/Tektalis_Logo_White.svg'

const FEATURES = [
  {
    icon: '📄',
    title: 'JD Alignment Scoring',
    desc: 'Paste any job description and the AI scores each candidate against it using semantic similarity.',
  },
  {
    icon: '🎓',
    title: 'Education Filtering',
    desc: 'Set minimum degree requirements and preferred majors. Candidates who don\'t qualify are automatically penalised.',
  },
  {
    icon: '⚖️',
    title: 'Weighted Requirements',
    desc: 'Define custom requirements like "5+ years Python" with individual weights. The scorer finds evidence in the resume.',
  },
  {
    icon: '📬',
    title: 'Email Ingestion',
    desc: 'Connect your inbox and resumes that arrive as attachments are parsed and evaluated automatically.',
  },
  {
    icon: '🔗',
    title: 'LinkedIn & GitHub Enrichment',
    desc: 'Cross-validate claimed skills against real GitHub repos and LinkedIn profiles. Inconsistencies are flagged.',
  },
  {
    icon: '🤖',
    title: 'AI Reasoning Summary',
    desc: 'Every evaluation includes a plain-English paragraph explaining exactly why the candidate scored the way they did.',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const darkMode = useAppStore((s) => s.darkMode)
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
  const logo = darkMode ? LogoWhite : LogoDark

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav className="border-b border-gray-100 dark:border-gray-800 px-8 h-14 flex items-center justify-between">
        <div className="flex items-center">
          <img src={logo} alt="TekTalentScan" className="h-7 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {darkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.71.71M6.34 17.66l-.71.71M17.66 17.66l-.71-.71M6.34 6.34l-.71-.71M12 7a5 5 0 100 10A5 5 0 0012 7z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => navigate('/login')}
            className="bg-[#534AB7] hover:bg-[#3C3489] text-white font-semibold text-sm px-5 py-2 rounded-lg transition-colors"
          >
            Log In
          </button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-6 py-24 flex-1">
        <div className="inline-flex items-center gap-2 bg-[#EEEDFE] dark:bg-[#2d2a5a] text-[#534AB7] text-xs font-semibold px-3 py-1 rounded-full mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[#534AB7] inline-block" />
          AI-Powered Recruiting
        </div>

        <h1 className="text-5xl font-bold text-gray-900 dark:text-white leading-tight max-w-2xl mb-5">
          Evaluate every resume in{' '}
          <span className="text-[#534AB7]">seconds, not hours</span>
        </h1>

        <p className="text-lg text-gray-500 dark:text-gray-400 max-w-xl mb-10">
          TekTalentScan automatically scores, ranks, and explains candidates against your exact job requirements —
          so your team only interviews the best fits.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/login')}
            className="bg-[#534AB7] hover:bg-[#3C3489] text-white font-semibold px-7 py-3 rounded-xl text-base transition-colors shadow-lg shadow-[#534AB7]/20"
          >
            Get Started →
          </button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium px-7 py-3 rounded-xl text-base transition-colors"
          >
            See Features
          </button>
        </div>

        {/* Stat strip */}
        <div className="flex gap-10 mt-14 text-center">
          {[
            { value: '10×', label: 'faster screening' },
            { value: '6', label: 'AI evaluation signals' },
            { value: '100%', label: 'automated ingestion' },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-3xl font-bold text-[#534AB7]">{value}</p>
              <p className="text-sm text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="bg-gray-50 dark:bg-gray-900 px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-[#534AB7] uppercase tracking-widest text-center mb-2">
            What's included
          </p>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white text-center mb-12">
            Everything you need to hire smarter
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon, title, desc }) => (
              <div
                key={title}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-shadow"
              >
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1.5">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Footer ─────────────────────────────────────────── */}
      <section className="bg-[#534AB7] px-8 py-16 text-center">
        <h2 className="text-3xl font-bold text-white mb-3">Ready to cut screening time?</h2>
        <p className="text-[#C4BFFF] mb-8 text-base">Start evaluating resumes with AI today.</p>
        <button
          onClick={() => navigate('/login')}
          className="bg-white text-[#534AB7] font-bold px-8 py-3 rounded-xl text-base hover:bg-gray-100 transition-colors"
        >
          Log In to TekTalentScan
        </button>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 dark:border-gray-800 px-8 py-5 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} TekTalentScan · Built by Tektalis
      </footer>
    </div>
  )
}
