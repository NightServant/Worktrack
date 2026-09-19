'use client'

import { Button } from '@/components/ui/button'
import { Input, PasswordInput } from '@/components/ui/input'
import { StatusMarker, STATUSES } from '@/components/ui/status-marker'
import { AtsCheck, ATS_RESULTS } from '@/components/ui/ats-check'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { ThemeToggle } from '@/components/ui/theme-toggle'

/**
 * Every primitive, every variant.
 *
 * The Input's focus state is missing on purpose -- it is a DOM state, so the
 * way to review it is to tab into the field. Rendering a fake focused copy is
 * how the Figma frame ended up showing two at once.
 */
function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-border-subtle p-4">
      <div className="space-y-1">
        <h3 className="text-heading-s text-text-primary">{title}</h3>
        {note && <p className="text-body-s text-text-muted">{note}</p>}
      </div>
      {children}
    </div>
  )
}

export function Primitives() {
  return (
    <section className="space-y-4">
      <h2 className="text-heading-l">primitives</h2>

      <Row title="button" note="Three intents, two sizes. Radius never exceeds 4px.">
        <div className="flex flex-wrap items-center gap-3">
          {(['primary', 'secondary', 'ghost'] as const).map((v) =>
            (['m', 's'] as const).map((s) => (
              <Button key={`${v}-${s}`} variant={v} size={s}>
                {v} / {s}
              </Button>
            ))
          )}
          <Button disabled>disabled</Button>
        </div>
      </Row>

      <Row title="status marker" note="A 2px rule and a label. No fill, no dot, no radius.">
        <div className="flex flex-wrap gap-8">
          {STATUSES.map((s) => (
            <StatusMarker key={s} status={s} className="w-28" />
          ))}
        </div>
      </Row>

      <Row title="ATS check" note="The same vocabulary, three outcomes. Review is amber, not the accent.">
        <div className="flex flex-wrap gap-8">
          {ATS_RESULTS.map((r) => (
            <AtsCheck key={r} result={r} className="w-28" />
          ))}
        </div>
      </Row>

      <Row title="input" note="Default, Error and Disabled. Tab into the first field to review Focus.">
        <div className="grid max-w-sm gap-4">
          <Input id="g-default" placeholder="default" />
          <Input id="g-error" defaultValue="not-an-email" error="Enter a valid email" />
          <Input id="g-disabled" placeholder="disabled" disabled />
          <PasswordInput id="g-password" placeholder="password" />
        </div>
      </Row>

      <Row title="breadcrumb" note="The last crumb is the current page, so it is text rather than a link.">
        <Breadcrumb
          items={[{ label: 'Dashboard', href: '/overview' }, { label: 'Applications', href: '/applications' }, { label: 'Senior Engineer' }]}
        />
      </Row>

      <Row title="theme toggle" note="32px for a cursor, 44px for a finger. Both drive next-themes.">
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <ThemeToggle size={44} />
        </div>
      </Row>
    </section>
  )
}
