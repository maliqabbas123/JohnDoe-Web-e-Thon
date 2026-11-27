import type { Dispute } from '../types'

export function isEscalatedDispute(dispute: Dispute) {
  return (
    dispute.status === 'Escalated' ||
    dispute.revisions.some(
      (revision) =>
        revision.status === 'Escalated' ||
        revision.summary === 'Escalated to administrator' ||
        /^(?:Open|Under Review|Escalated|Resolved) → Escalated to administrator(?:\s|$)/.test(
          revision.summary,
        ) ||
        revision.summary.startsWith('Resolved by administrator:'),
    )
  )
}

export function candidateDisputeHistory(dispute: Dispute) {
  return dispute.revisions.flatMap(({ at, status, summary }) => {
    const update =
      status ??
      (summary === 'Submitted by candidate' ? 'Open' : undefined) ??
      (summary === 'Escalated to administrator' ? 'Escalated' : undefined) ??
      /^(?:Open|Under Review|Escalated|Resolved) → (Open|Under Review|Escalated|Resolved)(?:\s|$)/.exec(
        summary,
      )?.[1] ??
      (summary.startsWith('Resolved by administrator:')
        ? 'Resolved'
        : undefined)

    return update
      ? [{ at, type: update, message: 'Status changed to ' + update }]
      : []
  })
}
