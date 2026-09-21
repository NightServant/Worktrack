'use client'

import * as React from 'react'
import { detectUserCountry } from '@/services/userLocation'

/**
 * Where this person is, resolved after mount rather than during render.
 *
 * THE EFFECT IS THE WHOLE POINT. `detectUserCountry` reads `navigator` and
 * `Intl`, neither of which exists during a server render -- so a component
 * that called it while rendering would produce one country on the server and
 * another in the browser, and React would log a hydration mismatch on
 * whatever the value is shown in. `useCalendarExtras` already resolves the
 * holiday country this way for exactly this reason; this is the same pattern
 * with the duplication removed.
 *
 * IT OPENS ON THE FALLBACK AND CORRECTS ITSELF ONE FRAME LATER, which is
 * honest for what it is: a guess a reader can override. Callers pass whatever
 * they would rather show than nothing -- the phone input passes `PH`, being
 * this app's own author's country and a better bet than the library's `US`.
 *
 * IT DOES NOT PERSIST ANYTHING. The calendar remembers its country because a
 * reader corrects it once and means it; a phone number carries its own country
 * in the value, so there is nothing here worth storing.
 */
export function useUserCountry(fallback: string): string {
  const [country, setCountry] = React.useState(fallback)

  React.useEffect(() => {
    const detected = detectUserCountry()
    if (detected) setCountry(detected)
  }, [])

  return country
}
