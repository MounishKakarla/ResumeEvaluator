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
    label: 'Needs Review',
    classes: 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]',
  },
  pending: {
    label: 'Pending',
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
