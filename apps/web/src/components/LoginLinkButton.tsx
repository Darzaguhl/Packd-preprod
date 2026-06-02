'use client'

import { useState } from 'react'

interface Props {
  onGenerate: () => Promise<string>
  className?: string
}

/**
 * Generates a login link and copies it to clipboard.
 * Shows "Copied ✓" for 2 seconds then resets.
 */
export default function LoginLinkButton({ onGenerate, className }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied' | 'error'>('idle')

  async function handleClick() {
    setState('loading')
    try {
      const link = await onGenerate()
      await navigator.clipboard.writeText(link)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2000)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === 'loading'}
      className={className ?? 'text-[10px] text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50'}
    >
      {state === 'loading' ? 'Generating…' : state === 'copied' ? 'Copied ✓' : state === 'error' ? 'Failed' : 'Login link'}
    </button>
  )
}
