type StatusType =
  | 'shortlisted'
  | 'review'
  | 'rejected'
  | 'pending'
  | 'parsing'
  | 'scoring'
  | 'done'
  | 'error'

interface StatusBadgeProps {
  status: StatusType
}

const statusConfig: Record<StatusType, { label: string; classes: string }> = {
  shortlisted: {
    label: 'Shortlisted',
    classes: 'bg-[#E1F5EE] text-[#085041] border-[#5DCAA5]',
  },
  review: {
    label: 'Next Consideration',
    classes: 'bg-[#F5F3FF] text-[#5B21B6] border-[#7C3AED]',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]',
  },
  pending: {
    label: 'On Hold',
    classes: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
  },
  parsing: {
    label: 'Parsing',
    classes: 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]',
  },
  scoring: {
    label: 'Scoring',
    classes: 'bg-[#EEEDFE] text-[#534AB7] border-[#AFA9EC]',
  },
  done: {
    label: 'Done',
    classes: 'bg-gray-100 text-gray-600 border-gray-300',
  },
  error: {
    label: 'Error',
    classes: 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]',
  },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.done
  return (
    <span
      className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border ${config.classes}`}
    >
      {config.label}
    </span>
  )
}
