'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Badge,
  Button,
  DataTable,
  Heading,
  ImportModal,
  Panel,
  Stats,
} from '../../components/shared'
import { id, serverNow, useStore } from '../../context/MockStoreContext'
import type { Role, User } from '../../types'

import { roles, UserEditor } from './shared'

export function AdminDashboardPage() {
  const { state, update, toast } = useStore(),
    [edit, setEdit] = useState<User | null | undefined>(),
    [importing, setImport] = useState(false)
  return (
    <>
      <Heading
        title="Administration overview"
        subtitle="Manage access and monitor examination activity across the platform."
        actions={
          <>
            <Button secondary onClick={() => setImport(true)}>
              Import users
            </Button>
            <Button onClick={() => setEdit(null)}>Create user</Button>
          </>
        }
      />
      <Stats
        items={[
          ...roles.map(
            (r) =>
              [r + 's', state.users.filter((u) => u.role === r).length] as [
                string,
                number,
              ],
          ),
          [
            'Active exams',
            state.exams.filter((e) => e.status === 'Ongoing').length,
          ],
          [
            'Completed exams',
            state.exams.filter((e) => e.status === 'Completed').length,
          ],
          [
            'Open escalations',
            state.disputes.filter((d) => d.status === 'Escalated').length,
          ],
        ]}
      />
      <Panel title="User management directory">
        <DataTable
          columns={['Name', 'Email', 'Role', 'Status', 'Actions']}
          filters={{ Role: roles, Status: ['Active', 'Inactive'] }}
          rows={state.users.map((u) => ({
            key: u.id,
            search: [u.name, u.email, u.role].join(' '),
            filters: { Role: u.role, Status: u.active ? 'Active' : 'Inactive' },
            cells: [
              <Link href={'/admin/users/' + u.id}>{u.name}</Link>,
              u.email,
              u.role,
              <Badge>{u.active ? 'Active' : 'Inactive'}</Badge>,
              <Button secondary onClick={() => setEdit(u)}>
                Edit
              </Button>,
            ],
          }))}
        />
      </Panel>
      {edit !== undefined && (
        <UserEditor user={edit ?? undefined} close={() => setEdit(undefined)} />
      )}{' '}
      {importing && (
        <ImportModal
          title="Bulk user import"
          close={() => setImport(false)}
          limit={state.policy.importLimit}
          fields="name, email, role"
          parse={(row) => {
            const name = String(row.name ?? '').trim(),
              email = String(row.email ?? '')
                .trim()
                .toLowerCase(),
              role = row.role as Role
            if (!name || !/^\S+@\S+\.\S+$/.test(email) || !roles.includes(role))
              throw Error('Name, valid email and supported role are required.')
            if (state.users.some((u) => u.email.toLowerCase() === email))
              throw Error('Email already exists.')
            return { name, email, role }
          }}
          save={(rows) => {
            if (new Set(rows.map((r) => r.email)).size !== rows.length)
              throw Error('The file contains duplicate email addresses.')
            update((s) => {
              for (const row of rows) {
                const uid = id()
                s.users.push({
                  ...row,
                  id: uid,
                  active: false,
                  password: '',
                  history: [row.role + ' assigned at import'],
                  logins: [],
                })
                s.tokens[id()] = { user: uid, purpose: 'invite' }
              }
              s.audit.unshift({
                type: 'Access',
                at: serverNow(),
                message: 'Imported ' + rows.length + ' users',
              })
            })
            toast('Users imported. Invitation links are on their profiles.')
          }}
        />
      )}
    </>
  )
}
