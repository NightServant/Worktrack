import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Our type scale is named `text-body-m`, `text-heading-l`, `text-data-xl` and so
 * on, which collides with `text-*` as a colour utility.
 *
 * tailwind-merge only knows Tailwind's stock font sizes, so it read every one of
 * these as a text COLOUR and dropped whichever colour came before it. The
 * primary button was the visible casualty: `text-accent-on-accent text-body-m`
 * merged down to just `text-body-m`, and white-on-orange silently became
 * near-black-on-orange -- inherited from the body, and well under AA.
 *
 * Naming the scale here puts each one back in the font-size group, where a size
 * displaces a size and leaves the colour alone.
 */
const FONT_SIZES = [
  'display-xl', 'display-l', 'display-m',
  'heading-l', 'heading-m', 'heading-s',
  'body-l', 'body-m', 'body-s',
  'label-m', 'label-caps', 'caption',
  'data-xl', 'data-l', 'data-m', 'data-s',
]

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: FONT_SIZES }] } },
})

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * Plain `clsx` would leave `px-4 px-6` both in the string and let CSS source
 * order decide, which makes a variant's override depend on where Tailwind
 * happened to emit the rule. `twMerge` resolves the conflict by keyword.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Whether Escape belongs to the field being typed in rather than to the view.
 *
 * THE OTHER WAY THE POSTING VIEW COULD BE LEFT BY ACCIDENT (2026-10-01).
 * Escape means `back to application` there, which is right from anywhere
 * except a section somebody is editing: pressing Escape to get out of a text
 * box took them out of the whole posting, mid-edit.
 */
export function escapeBelongsToField(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  return active.matches('textarea, input, [contenteditable="true"]')
}
