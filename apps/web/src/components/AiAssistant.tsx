'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  token: string
  studioId: string
  studioName?: string
}

// Extend window for browser speech API
declare global {
  interface Window {
    SpeechRecognition?: typeof SpeechRecognition
    webkitSpeechRecognition?: typeof SpeechRecognition
  }
}

export default function AiAssistant({ token, studioId, studioName }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)  // waiting for first token
  const [toolLabel, setToolLabel] = useState<string | null>(null) // e.g. "Checking schedule…"
  const [listening, setListening] = useState(false)
  const [dictationSupported, setDictationSupported] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)
  // Track committed (final) text separately from interim so they don't clobber each other
  const committedRef = useRef('')

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    setDictationSupported(!!SR)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      if (messages.length === 0) {
        setMessages([{
          role: 'assistant',
          content: `Hi! I'm your Packd assistant. I can help you check the schedule, view your credits, book or cancel classes${studioName ? ` at ${studioName}` : ''}, and more. What can I do for you?`,
        }])
      }
    } else {
      stopListening()
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  function toggleDictation() {
    if (listening) {
      stopListening()
      return
    }

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) return

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    committedRef.current = input // start from whatever is already in the box

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let newCommitted = committedRef.current

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          newCommitted += transcript
          committedRef.current = newCommitted
        } else {
          interim += transcript
        }
      }

      setInput(newCommitted + interim)
    }

    recognition.onerror = () => {
      stopListening()
    }

    recognition.onend = () => {
      // Only restart if we're still supposed to be listening
      // (browser auto-stops after silence; continuous = true re-opens it)
      if (recognitionRef.current) {
        try { recognition.start() } catch { stopListening() }
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    stopListening()
    committedRef.current = ''
    setInput('')

    const newMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)
    setToolLabel(null)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: newMessages, studioId, studioName }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Failed to get response')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let started = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6)) as {
            type: string; text?: string; label?: string; message?: string; refresh?: boolean
          }

          if (event.type === 'delta' && event.text) {
            if (!started) {
              // First text chunk — add the assistant message and stop the loading indicator
              setMessages(prev => [...prev, { role: 'assistant', content: event.text! }])
              setLoading(false)
              setToolLabel(null)
              started = true
            } else {
              setMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: last.content + event.text }]
                }
                return prev
              })
            }
          } else if (event.type === 'tool') {
            setToolLabel(event.label ?? 'Working…')
          } else if (event.type === 'done' && event.refresh) {
            window.dispatchEvent(new CustomEvent('ai:data-changed'))
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }

      if (!started) {
        // Response had no text (shouldn't happen but handle gracefully)
        setMessages(prev => [...prev, { role: 'assistant', content: '(No response)' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
      }])
    } finally {
      setLoading(false)
      setToolLabel(null)
    }
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[360px] max-h-[540px] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center">
                <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2a5 5 0 0 1 4.33 7.5L14 12l-2.5-1.67A5 5 0 1 1 8 2z" fill="currentColor"/>
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-900">Packd Assistant</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">AI</span>
              {listening && (
                <span className="flex items-center gap-1 text-[10px] text-red-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Listening
                </span>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] text-sm px-3 py-2 rounded-2xl whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-black text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {(loading || toolLabel) && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 text-sm px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-2">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                  </span>
                  {toolLabel && <span className="text-xs text-gray-400 italic">{toolLabel}</span>}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className={`border-t px-3 py-2 flex items-center gap-2 transition-colors ${listening ? 'border-red-100 bg-red-50/40' : 'border-gray-100'}`}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => {
                committedRef.current = e.target.value
                setInput(e.target.value)
              }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={listening ? 'Listening…' : 'Ask me anything…'}
              disabled={loading}
              className="flex-1 text-sm bg-transparent rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-black/10 placeholder-gray-400 disabled:opacity-50"
            />

            {/* Mic button — only shown when supported */}
            {dictationSupported && (
              <button
                onClick={toggleDictation}
                disabled={loading}
                title={listening ? 'Stop dictation' : 'Start dictation'}
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 ${
                  listening
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {listening ? (
                  /* Stop icon */
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                    <rect x="2" y="2" width="8" height="8" rx="1"/>
                  </svg>
                ) : (
                  /* Mic icon */
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                    <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M2 8a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            )}

            {/* Send button */}
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center shrink-0 disabled:opacity-30 hover:bg-gray-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open ? 'bg-gray-800' : 'bg-black hover:scale-110'
        }`}
      >
        {open ? (
          <svg className="w-5 h-5 text-white" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white" viewBox="0 0 16 16" fill="none">
            <path d="M8 2a5 5 0 0 1 4.33 7.5L14 12l-2.5-1.67A5 5 0 1 1 8 2z" fill="currentColor"/>
          </svg>
        )}
      </button>
    </>
  )
}
