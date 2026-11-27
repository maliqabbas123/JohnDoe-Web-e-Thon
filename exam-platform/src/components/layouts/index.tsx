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
import { home, useStore } from '../../context/MockStoreContext'
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
  const { user } = useStore()
  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-width">
          <Brand />
          <nav aria-label="Public navigation">
            <Link href="/verify">
              <ScanLine size={17} /> Verify a result
            </Link>
            <Button secondary to={user ? home(user.role) : '/login'}>
              {user ? 'Dashboard' : 'Sign in'}
            </Button>
          </nav>
        </div>
      </header>
      {children}
      <footer>
        <div className="public-width">
          <Brand />
          <span>Secure Examination Management</span>
          <Link href="/verify">Public verification</Link>
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
  const { user, logout } = useStore(),
    [open, setOpen] = useState(false),
    [profile, setProfile] = useState(false),
    router = useRouter(),
    pathname = usePathname()
  if (!user) return null
  return (
    <div className="dashboard">
      <aside className={'sidebar ' + (open ? 'expanded' : '')}>
        <Brand />
        <small>WORKSPACE</small>
        <nav aria-label={user.role + ' navigation'}>
          {nav[user.role].map(([label, to, Icon]) => (
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
        <div className="sidebar-bottom">
          <Link href="/verify">
            <ScanLine size={17} /> Public verification
          </Link>
        </div>
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
                  onClick={() => {
                    logout()
                    router.replace('/')
                  }}
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  )
}
