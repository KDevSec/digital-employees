export function installStatusLabel(t: (key: string) => string, status: string): string {
  switch (status) {
    case 'ONLINE':
      return t('terminals.online')
    case 'OFFLINE':
      return t('terminals.offline')
    case 'PENDING':
    case 'PENDING_REVIEW':
    case 'APPROVED':
      return t('terminals.pending')
    case 'REJECTED':
      return t('terminals.rejected')
    case 'NOT_INSTALLED':
      return t('terminals.notInstalledState')
    case 'ACTIVE':
      return t('terminals.online')
    case 'COMPLETED':
      return t('terminals.approved')
    default:
      return status
  }
}

export function installStatusClass(status: string): string {
  if (status === 'ONLINE' || status === 'ACTIVE' || status === 'COMPLETED' || status === 'APPROVED') {
    return 'success'
  }
  if (status === 'OFFLINE') return 'warning'
  if (status === 'REJECTED') return 'danger'
  if (status === 'NOT_INSTALLED') return 'muted'
  return 'warning'
}
