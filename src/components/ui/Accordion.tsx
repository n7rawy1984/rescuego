'use client'
import { useState } from 'react'

interface AccordionItem {
  question: string
  answer: string
}

export default function Accordion({ items }: { items: AccordionItem[] }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.question} className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-4 px-6 py-5 text-start"
            aria-expanded={open === i}
          >
            <span className="text-base font-semibold text-slate-950">{item.question}</span>
            <svg
              className={`w-5 h-5 shrink-0 text-[#1D9E75] transition-transform duration-200 ${open === i ? 'rotate-45' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {open === i && (
            <div className="px-6 pb-5">
              <p className="text-sm leading-6 text-slate-600">{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
