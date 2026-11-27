const liveDashboardRoutes: RegExp[] = []

export function isLiveDashboardRoute(pathname: string) {
  return liveDashboardRoutes.some((route) => route.test(pathname))
}

export function isDemoPublicRoute(pathname: string) {
  return /^\/(verify|invite|forgot-password|reset-password)(\/|$)/.test(pathname)
}
