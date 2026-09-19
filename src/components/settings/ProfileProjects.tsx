'use client'

import * as React from 'react'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRow,
} from '@/components/ui/carousel'
import { AppDialog } from '@/components/ui/app-dialog'
import { ExternalIcon } from '@/components/icons'
import type { ProfileProject } from '@/services/profile'
import { Tag } from './profileChrome'

/**
 * The projects rail, and the dialog a card opens.
 *
 * WHY IT LEFT `ProfileGroup` (2026-09-19). Every other section on that screen
 * is a pure render of a slice of `UserProfile`; this one holds state -- which
 * project is open -- and that is the seam the file was split on the first time.
 * Keeping it there would have put the panel's only `useState` in the middle of
 * eight stateless sections.
 *
 * WHY A DIALOG AT ALL (Gabe, 2026-09-19: "each card from the carousel should
 * open a dialog that contains relevant information of a specific project.
 * Fetch the readme of every project and display only the relevant
 * information"). A card in a rail is one height and about 240px wide, so it
 * can hold a name and four clamped lines -- and a project's README now carries
 * the three or four sentences a CV entry is written from. There is nowhere on
 * the card to put them, and the alternative to a dialog is a card that grows
 * until the rail is a wall.
 *
 * THE CARD IS A BUTTON, not a link with a click handler. It opens something on
 * this page rather than going somewhere, so it has to be reachable by keyboard
 * and announced as a control -- and the repository link inside the dialog is
 * where "go somewhere" belongs.
 *
 * THE LINK CAME OFF THE CARD for the same reason: a card that is a button with
 * an anchor inside it is two targets in one rectangle, and the small one wins
 * the click by accident.
 */
export function ProfileProjects({ projects }: { projects: ProfileProject[] }) {
  const [open, setOpen] = React.useState<ProfileProject | null>(null)

  return (
    <>
      <Carousel
        opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }}
        className="flex flex-col gap-3"
      >
        <CarouselRow>
          <CarouselPrevious />
          <CarouselContent className="-ml-3">
            {projects.map((project) => (
              <CarouselItem key={project.title} className="basis-auto pl-3">
                {/* THE CARD KEEPS ITS FILL while the section loses its own --
                    Gabe's instruction, and the same arrangement the calendar's
                    roles rail arrived at: the fill is what makes one project
                    read as one object, and a second frame around all of them
                    made them look nested inside something. */}
                <button
                  type="button"
                  data-profile-project
                  onClick={() => setOpen(project)}
                  className="flex h-full w-64 flex-col gap-2 rounded-md border border-border-subtle bg-card p-3 text-left transition-colors hover:border-accent-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
                >
                  <p className="break-words text-body-m font-medium text-text-primary">
                    {project.title}
                  </p>
                  {project.description && (
                    // THREE LINES, then it stops. The rest is a click away
                    // now, which is what makes the clamp honest -- before the
                    // dialog it was the only copy of the text there was.
                    <p className="line-clamp-3 text-body-s leading-[1.55] text-text-secondary">
                      {project.description}
                    </p>
                  )}
                  {/* THE STACK, CAPPED AT THREE. A repository declares up to
                      twenty topics and a card is 256px wide; three is what
                      fits on one line, and the dialog has the rest. */}
                  {project.tech.length > 0 && (
                    <p className="mt-auto truncate pt-1 text-caption text-text-muted">
                      {project.tech.slice(0, 3).join(' · ')}
                    </p>
                  )}
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselNext />
        </CarouselRow>
      </Carousel>

      <AppDialog
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open?.title ?? ''}
        icon="Code"
        size="l"
      >
        {open && <ProjectBody project={open} />}
      </AppDialog>
    </>
  )
}

/**
 * What a project dialog actually shows, in the order a reader wants it.
 *
 * ONLY WHAT THE SOURCE HAD. Every block here is conditional, because a project
 * read off a LinkedIn profile has a paragraph and nothing else while one read
 * off a repository has a stack, a star count and its README's bullets. A
 * dialog of empty labelled rows would be worse than a short one.
 *
 * THE BULLETS ARE LABELLED AS THE README'S, and that label is doing real work:
 * they are what the CV writes this project's entry from, so a reader who
 * disagrees with a line needs to know the fix is in their own repository
 * rather than in this app.
 */
function ProjectBody({ project }: { project: ProfileProject }) {
  const facts = [
    project.language,
    project.stars !== null && project.stars > 0
      ? `${project.stars} star${project.stars === 1 ? '' : 's'}`
      : null,
    project.updatedAt ? `updated ${new Date(project.updatedAt).toLocaleDateString()}` : null,
  ].filter((fact): fact is string => !!fact)

  return (
    <div className="flex flex-col gap-5">
      {project.description && (
        <p className="max-w-prose text-body-m leading-[1.6] text-text-secondary">
          {project.description}
        </p>
      )}

      {facts.length > 0 && (
        <p className="text-body-s text-text-muted">{facts.join(' · ')}</p>
      )}

      {project.highlights.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label-caps uppercase text-text-secondary">from the readme</h4>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-text-muted">
            {project.highlights.map((line) => (
              <li key={line} className="pl-1 text-body-s leading-[1.6] text-text-primary">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-caption text-text-muted">
            These lines are what a CV writes this project&rsquo;s bullets from. Edit them in
            the repository&rsquo;s own README.
          </p>
        </section>
      )}

      {project.tech.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label-caps uppercase text-text-secondary">built with</h4>
          <div className="flex flex-wrap gap-1.5">
            {project.tech.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
        </section>
      )}

      {(project.url || project.homepage) && (
        <div className="flex flex-wrap gap-4">
          {project.url && <ProjectLink href={project.url}>repository</ProjectLink>}
          {project.homepage && <ProjectLink href={project.homepage}>live site</ProjectLink>}
        </div>
      )}
    </div>
  )
}

function ProjectLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-body-s text-accent-default underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default"
    >
      <ExternalIcon size={14} aria-hidden />
      {children}
    </a>
  )
}
