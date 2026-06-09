'use client'
import { createContext, useCallback, useContext, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'warning' | 'info'

type Toast = {
  id: string
  message: string
  type: ToastType
}

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const t = useTranslations('components.toast')

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl px-4 py-3 shadow-lg ring-1 transition-all animate-in slide-in-from-bottom-4 ${
              toast.type === 'success'
                ? 'bg-green-50 text-green-800 ring-green-200'
                : toast.type === 'warning'
                  ? 'bg-amber-50 text-amber-800 ring-amber-200'
                  : 'bg-white text-slate-800 ring-slate-200'
            }`}
            role="status"
          >
            {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />}
            {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />}
            {toast.type === 'info' && <Info className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />}
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-md p-1 opacity-60 hover:opacity-100"
              aria-label={t('dismiss')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
