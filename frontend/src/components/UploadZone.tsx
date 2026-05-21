import { useDropzone } from 'react-dropzone'

interface UploadZoneProps {
  onFiles: (files: File[]) => void
}

const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB
const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
}

export default function UploadZone({ onFiles }: UploadZoneProps) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop: (accepted) => {
      if (accepted.length > 0) onFiles(accepted)
    },
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE_BYTES,
    multiple: true,
  })

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors
          ${
            isDragActive
              ? 'border-[#534AB7] bg-[#EEEDFE] dark:bg-[#2d2a5a]'
              : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:border-[#534AB7] hover:bg-[#EEEDFE]/30 dark:hover:bg-[#2d2a5a]/30'
          }`}
      >
        <input {...getInputProps()} />

        {/* Upload Icon */}
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
            isDragActive ? 'bg-[#534AB7]' : 'bg-[#EEEDFE]'
          }`}
        >
          <svg
            className={`w-6 h-6 ${isDragActive ? 'text-white' : 'text-[#534AB7]'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          {isDragActive ? 'Drop files here' : 'Drop PDFs or DOCX here'}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">or click to browse &mdash; PDF / DOCX, max 20 MB each</p>
      </div>

      {fileRejections.length > 0 && (
        <ul className="text-xs text-[#791F1F] space-y-0.5">
          {fileRejections.map(({ file, errors }) => (
            <li key={file.name}>
              {file.name}: {errors.map((e) => e.message).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
