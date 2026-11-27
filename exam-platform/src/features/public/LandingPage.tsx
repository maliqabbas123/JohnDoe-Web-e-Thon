'use client'

import { FileCheck2, ScanLine, ShieldCheck } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Badge, Button, Heading } from '../../components/shared'
import { home, useStore } from '../../context/MockStoreContext'

import { Lookup, demos, features } from './shared'

export function LandingPage() {
  const { login, state } = useStore()
  const router = useRouter()
  return (
    <main>
      <section className="hero">
        <div className="public-width hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <ShieldCheck size={17} /> Secure examination management
            </div>
            <h1>
              Run online exams <em>with confidence.</em>
            </h1>
            <p>
              Build assessments, manage timed sittings, and publish results that
              anyone can verify.
            </p>
            <div className="actions">
              <Button to="/login">Sign in to workspace</Button>
              <a className="button secondary" href="#demo">
                Explore demo roles
              </a>
            </div>
          </div>
          <div className="hero-art">
            <Image
              src="/assessment-hero.webp"
              alt="University student working on a laptop at a desk"
              width={768}
              height={512}
              priority
            />
            <div className="art-card">
              <span className="art-icon">
                <FileCheck2 size={23} />
              </span>
              <span>
                <strong>Data Literacy Fundamentals</strong>
                <small>Published examination result</small>
              </span>
              <Badge>Verified</Badge>
            </div>
          </div>
        </div>
      </section>
      <div className="public-width landing-body">
        <section className="verify-strip" aria-labelledby="verify-title">
          <span className="feature-icon">
            <ScanLine size={24} />
          </span>
          <div>
            <h2 id="verify-title">Verify an examination result</h2>
            <p>Check a certificate ID against the public register.</p>
          </div>
          <Lookup />
        </section>
        <section id="demo" className="demo">
          <Heading
            title="Explore the workspaces"
            subtitle="Choose a role to try the platform with sample data."
          />
          <div className="demo-grid">
            {demos.map(({ role, label, id, Icon, body, color }) => (
              <article className="demo-card" key={role}>
                <span className={'feature-icon ' + color}>
                  <Icon size={24} />
                </span>
                <h2>{role}</h2>
                <p>{body}</p>
                <button
                  disabled={
                    !state.users.some(
                      (u) => u.id === id && u.active && u.role === role,
                    )
                  }
                  onClick={() => {
                    login(id)
                    router.push(home(role))
                  }}
                >
                  Login as {label}
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="feature-section">
        <div className="public-width">
          <Heading title="From question bank to scorecard" />
          <div className="demo-grid">
            {features.map(({ Icon, title, description }) => (
              <article key={title}>
                <Icon size={24} />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
