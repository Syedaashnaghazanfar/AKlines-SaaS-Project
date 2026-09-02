const COLOR_MAP = {
  PENDING: 'warning',
  IN_LAB: 'info',
  READY: 'primary',
  DELIVERED: 'success',
  CANCELLED: 'secondary',
  DRAFT: 'secondary',
  RECEIVED: 'success',
  COMPLETED: 'success',
  REVERSED: 'danger',
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'danger',
};

export default function StatusBadge({ status }) {
  const color = COLOR_MAP[status] || 'secondary';
  return <span className={`badge text-bg-${color}`}>{status?.replace('_', ' ')}</span>;
}
