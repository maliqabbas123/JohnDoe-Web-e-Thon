'use client'
import {
  Activity,
  BookOpen,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Scale,
  ScanLine,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { home } from '../../context/MockStoreContext'
import { useAuth } from '@/context/AuthContext'
import { isLive } from '@/lib/api'
import { isDemoPublicRoute, isLiveDashboardRoute } from '@/lib/liveRoutes'
import { Unavailable } from '../auth/Unavailable'
import { Button } from '../shared'
export function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-icon">
        <ShieldCheck size={23} />
      </span>
      <span>Proctorate</span>
    </Link>
  )
}
export function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-width">
          <Brand />
          <nav aria-label="Public navigation">
            {!isLive && (
              <Link href="/verify"><ScanLine size={17} /> Verify a result</Link>
            )}
            <Button secondary to={user ? home(user.role) : '/login'}>
              {user ? 'Dashboard' : 'Sign in'}
            </Button>
          </nav>
        </div>
      </header>
      {isLive && isDemoPublicRoute(pathname) ? <Unavailable href="/" /> : children}
      <footer>
        <div className="public-width">
          <Brand />
          <span>Secure Examination Management</span>
          {!isLive && <Link href="/verify">Public verification</Link>}
        </div>
      </footer>
    </div>
  )
}
const nav = {
  Administrator: [
    ['Overview', '/admin', LayoutDashboard],
    ['Exam oversight', '/admin/oversight', Activity],
    ['Outage management', '/admin/outages', Radio],
    ['Escalated disputes', '/admin/disputes', Scale],
    ['Platform settings', '/admin/settings', Settings],
  ],
  Examiner: [
    ['Examinations', '/examiner', LayoutDashboard],
    ['Question bank', '/examiner/questions', BookOpen],
  ],
  Candidate: [
    ['My workspace', '/candidate', LayoutDashboard],
    ['My disputes', '/candidate/disputes', Scale],
  ],
} as const
export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(),
    [open, setOpen] = useState(false),
    [profile, setProfile] = useState(false),
    [signingOut, setSigningOut] = useState(false),
    [error, setError] = useState(''),
    router = useRouter(),
    pathname = usePathname()
  if (!user) return null
  async function signOut() {
    setSigningOut(true)
    setError('')
    try {
      await logout()
      router.replace('/')
    } catch {
      setError('Could not sign out. Try again.')
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <div className="dashboard">
      <aside className={'sidebar ' + (open ? 'expanded' : '')}>
        <Brand />
        <small>WORKSPACE</small>
        <nav aria-label={user.role + ' navigation'}>
          {nav[user.role].filter(([, to]) => !isLive || isLiveDashboardRoute(to)).map(([label, to, Icon]) => (
            <Link
              key={to}
              href={to}
              aria-current={
                pathname === to ||
                (to !== home(user.role) && pathname.startsWith(to + '/'))
                  ? 'page'
                  : undefined
              }
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        {!isLive && <div className="sidebar-bottom">
          <Link href="/verify">
            <ScanLine size={17} /> Public verification
          </Link>
        </div>}
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-top">
          <div className="actions">
            <button
              className="icon mobile-menu"
              onClick={() => setOpen(!open)}
              aria-label="Toggle navigation"
            >
              <Menu size={20} />
            </button>
            <span className="crumb">{user.role} portal</span>
          </div>
          <div className="profile-wrap">
            <button
              className="profile"
              onClick={() => setProfile(!profile)}
              aria-expanded={profile}
            >
              <span className="avatar">
                {user.name
                  .split(' ')
                  .slice(-2)
                  .map((x) => x[0])
                  .join('')}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {profile && (
              <div className="profile-menu">
                <button
                  className="button secondary"
                  disabled={signingOut}
                  onClick={signOut}
                >
                  <LogOut size={16} /> Sign out
                </button>
                {error && <p role="alert" className="danger">{error}</p>}
              </div>
            )}
          </div>
        </header>
        <main className="dashboard-content">
          {isLive && !isLiveDashboardRoute(pathname) ? <Unavailable href={home(user.role)} /> : children}
        </main>
      </div>
    </div>
  )
}
