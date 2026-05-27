import { useEffect, useState, useRef } from 'react'

interface ResumePreviewModalProps {
  resumeId: number | null
  candidateName: string
  onClose: () => void
}

type LoadState = 'loading' | 'loaded' | 'error'

export default function ResumePreviewModal({ resumeId, candidateName, onClose }: ResumePreviewModalProps) {
  const isOpen = resumeId !== null
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [isDocx, setIsDocx] = useState(false)
  const prevBlobUrl = useRef<string | null>(null)

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Fetch the file as a blob so we can create a same-origin object URL.
  // This bypasses the cross-origin iframe restriction that causes Chrome to
  // download PDFs instead of rendering them inline.
  useEffect(() => {
    if (!resumeId) {
      setBlobUrl(null)
      setLoadState('loading')
      setIsDocx(false)
      return
    }

    let cancelled = false
    setLoadState('loading')
    setBlobUrl(null)
    setIsDocx(false)

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const token = localStorage.getItem('token') ?? ''
    const url = `${baseUrl}/upload/${resumeId}/file?token=${encodeURIComponent(token)}`

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const contentType = res.headers.get('content-type') ?? ''
        const isWord = contentType.includes('wordprocessingml') || contentType.includes('msword') || contentType.includes('octet-stream')
        const blob = await res.blob()
        if (cancelled) return
        // Always create a blob with application/pdf to force browser PDF viewer
        const pdfBlob = isWord ? blob : new Blob([blob], { type: 'application/pdf' })
        const objectUrl = URL.createObjectURL(pdfBlob)
        // Revoke previous blob URL
        if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current)
        prevBlobUrl.current = objectUrl
        setBlobUrl(objectUrl)
        setIsDocx(isWord)
        setLoadState('loaded')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [resumeId])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current)
        prevBlobUrl.current = null
      }
    }
  }, [])

  function handleDownload() {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${candidateName.replace(/\s+/g, '_')}_resume${isDocx ? '.docx' : '.pdf'}`
    a.click()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#EEEDFE] dark:bg-[#2d2a5a] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-[#534AB7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{candidateName}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Resume Preview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Download button — explicit download only */}
            <button
              onClick={handleDownload}
              disabled={!blobUrl}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#534AB7]/30 text-[#534AB7] hover:bg-[#EEEDFE] dark:hover:bg-[#2d2a5a] transition-colors font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-800 relative">
          {loadState === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <svg className="animate-spin h-8 w-8 text-[#534AB7]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Loading resume…</p>
            </div>
          )}

          {loadState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Could not load resume</p>
              <p className="text-xs text-gray-400">The file may not exist on the server yet.</p>
            </div>
          )}

          {loadState === 'loaded' && isDocx && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 12h6v1H9v-1zm0 3h6v1H9v-1zm0-6h3v1H9V9z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Word Document</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Browser cannot preview Word files inline.
                </p>
              </div>
              <button
                onClick={handleDownload}
                className="px-5 py-2 rounded-xl bg-[#534AB7] text-white text-sm font-semibold hover:bg-[#3C3489] transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download to View
              </button>
            </div>
          )}

          {loadState === 'loaded' && !isDocx && blobUrl && (
            <object
              data={blobUrl}
              type="application/pdf"
              className="w-full h-full border-0"
              aria-label={`Resume — ${candidateName}`}
            >
              {/* Fallback for browsers that don't support <object> for PDF */}
              <embed
                src={blobUrl}
                type="application/pdf"
                className="w-full h-full"
              />
            </object>
          )}
        </div>
      </div>
    </div>
  )
}
