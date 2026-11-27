import { Button } from '@/components/shared'

export function Unavailable({ href }: { href: string }) {
  return (
    <section className="panel public-width">
      <h1>Coming soon</h1>
      <p>This feature is still being connected to the examination service.</p>
      <Button to={href}>Go back</Button>
    </section>
  )
}
