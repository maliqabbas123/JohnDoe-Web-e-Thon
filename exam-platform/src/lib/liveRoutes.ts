// Dashboard routes whose pages are backed by the live API. Every other
// dashboard route shows "Coming soon" in live mode and is hidden from
// navigation. Add a route here only once its live implementation is merged.
const segment = '[^/]+'
const liveDashboardRoutes: RegExp[] = [
  // Administrator
  /^\/admin$/,
  new RegExp(`^/admin/users/${segment}$`),
  /^\/admin\/audit-logs$/,
  // Examiner question bank (question analytics remains demo-only)
  /^\/examiner$/,
  /^\/examiner\/questions$/,
  /^\/examiner\/questions\/new$/,
  new RegExp(`^/examiner/questions/${segment}/edit$`),
  // Examiner exam tools
  new RegExp(
    `^/examiner/exams/${segment}/(setup|blueprint|enrolment|grading)$`,
  ),
  new RegExp(`^/examiner/exams/${segment}/submissions/${segment}$`),
  // Candidate workspace, preferences and exam lobby
  /^\/candidate$/,
  new RegExp(`^/candidate/exam/${segment}/lobby$`),
]

export function isLiveDashboardRoute(pathname: string) {
  return liveDashboardRoutes.some((route) => route.test(pathname))
}

export function isDemoPublicRoute(pathname: string) {
  return /^\/(verify|invite|forgot-password|reset-password)(\/|$)/.test(pathname)
}
