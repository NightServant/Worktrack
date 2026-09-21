'use client'

import * as React from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { AccountGroup } from './AccountGroup'
import { PreferencesGroup } from './PreferencesGroup'
import { DangerZone } from './DangerZone'
import { ProfileGroup, type ProfileState } from './ProfileGroup'
import type { ProfileDetails } from './ProfileDetailsDialog'
import { resolveDefaultCurrency, type SupportedCurrency, type UserPreferences } from '@/services/userPreferences'
import { useUserCountry } from '@/hooks/useUserCountry'

/**
 * The Settings screen's body, over plain props -- the same split as
 * `Dashboard`, `ApplicationsPage` and `DocumentsPage`, so it renders without
 * Next routing or react-query. `src/app/(app)/settings/page.tsx` owns the
 * reads and the writes.
 *
 * TWO TABS: PROFILE AND GENERAL (Gabe, Worktrack Revisions item 8 --
 * reinstating the split that came out on 2026-09-06).
 *
 * The argument for one column was that three of the four groups are a handful
 * of rows each, so a tab bar hid half a short page behind a click. What
 * settles it the other way is the profile itself: it is now a fetch with its
 * own address field, its own instructions and, once it lands, several hundred
 * pixels of work history -- which is a screen, not a group. Everything else
 * (account, preferences, danger zone) is short precisely because it is
 * housekeeping, and housekeeping is what `general` means.
 *
 * The danger zone staying last inside `general` is load-bearing rather than
 * habit.
 *
 * BOTH PANELS STAY MOUNTED is NOT what happens here: `TabsContent` unmounts
 * the hidden one, which is what keeps a second copy of every settings control
 * out of the accessibility tree and out of a test's `getByRole`.
 *
 * NO APPEARANCE GROUP. The theme control lives in the app shell, so a second
 * one here would be a second source of truth over the same `next-themes`
 * state. No export group either -- `/applications` already owns CSV import and
 * export in its own toolbar.
 *
 * `prefs` is the only required prop: `resolveDefaultCurrency` already knows
 * how to read a `null` row (no preferences saved yet) as PHP, so a caller
 * mid-fetch can pass `null` and get the same fallback the rest of the app
 * uses rather than a loading state blocking the two groups that do not
 * depend on it.
 */
export interface SettingsPageProps {
  /**
   * Saves the person's own two profile details. Absent means no edit control
   * is drawn -- see `ProfileGroup`.
   */
  onSaveDetails?: (details: ProfileDetails) => Promise<void> | void
  prefs: UserPreferences | null
  email?: string | null
  onDefaultCurrencyChange?: (code: SupportedCurrency) => void
  savingCurrency?: boolean
  onSignOut?: () => void
  signingOut?: boolean
  onDeleteAccount?: () => void
  deletingAccount?: boolean
  /**
   * The profile panel's state. Defaults to empty so the demo and any caller
   * that does not fetch one still render a complete, honest screen rather
   * than a spinner that never resolves.
   */
  profile?: ProfileState
  /** The import control, rendered inside the Profile panel in every state. */
  profileSource?: React.ReactNode
  /** How to get an export. Shown only when there is no profile yet. */
  profileSteps?: React.ReactNode
}


export function SettingsPage({
  onSaveDetails,
  prefs,
  email = null,
  onDefaultCurrencyChange,
  savingCurrency = false,
  onSignOut,
  signingOut = false,
  onDeleteAccount,
  deletingAccount = false,
  profile = { status: 'empty', message: 'No profile imported yet.' },
  profileSource,
  profileSteps,
}: SettingsPageProps) {
  /*
    THE OPENING CURRENCY FOLLOWS THE READER, for anybody who has never set one
    -- the preferences row is created lazily, so most people have none and
    every one of them used to get PHP. Detected after mount; see
    `useUserCountry` for why not during render.
  */
  const country = useUserCountry('PH')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="settings"
        description="your profile, your account, how figures are displayed, and what happens to your data."
      />

      <Tabs defaultValue="profile">
        {/* The applications screen's tab treatment, unchanged: `line`
            variant, no pill, no capsule, and a 2px accent rule under whichever
            is active -- the same vocabulary the status marker and the active
            nav item use. Two tabs need no horizontal scroll, which is the one
            thing StatusTabs has that this does not. */}
        <TabsList
          aria-label="Settings sections"
          variant="line"
          activateOnFocus
          className={cn(
            'w-full justify-start gap-1 rounded-none border-b border-border-subtle bg-transparent p-0',
            'group-data-[orientation=horizontal]/tabs:h-auto'
          )}
        >
          {(
            [
              ['profile', 'profile'],
              ['general', 'general'],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger
              key={value}
              id={`settings-tab-${value}`}
              value={value}
              className={cn(
                'relative h-9 shrink-0 items-center justify-start rounded-none border-0 px-3 py-0',
                'text-label-caps uppercase transition-colors duration-(--duration-fast)',
                'text-text-muted hover:text-text-primary',
                'data-active:bg-transparent data-active:text-text-primary data-active:shadow-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
                'after:hidden',
                // The active rule, drawn on the trigger rather than by the
                // variant, so it sits on the same hairline the list carries.
                'data-active:after:absolute data-active:after:inset-x-0 data-active:after:bottom-0',
                'data-active:after:block data-active:after:h-[2px] data-active:after:bg-accent-default'
              )}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="profile" className="pt-8">
          <ProfileGroup
            state={profile}
            source={profileSource}
            steps={profileSteps}
            onSaveDetails={onSaveDetails}
          />
        </TabsContent>

        <TabsContent value="general" className="flex flex-col gap-8 pt-8">
          <AccountGroup email={email} onSignOut={onSignOut} signingOut={signingOut} />
          <PreferencesGroup
            defaultCurrency={resolveDefaultCurrency(prefs, country)}
            onDefaultCurrencyChange={onDefaultCurrencyChange}
            saving={savingCurrency}
          />
          <DangerZone onDeleteAccount={onDeleteAccount} deleting={deletingAccount} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
