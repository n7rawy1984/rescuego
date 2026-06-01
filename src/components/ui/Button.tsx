import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
    const variants = {
      primary: 'bg-[#1D9E75] text-white shadow-sm hover:bg-[#0F6E56] focus:ring-[#1D9E75]',
      secondary: 'bg-slate-900 text-white shadow-sm hover:bg-slate-800 focus:ring-slate-500',
      outline: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus:ring-[#1D9E75]',
      ghost: 'text-slate-700 hover:bg-slate-100 focus:ring-slate-300',
      destructive: 'bg-red-500 text-white shadow-sm hover:bg-red-600 focus:ring-red-500',
    }
    const sizes = {
      sm: 'min-h-9 px-3 py-1.5 text-sm',
      md: 'min-h-10 px-4 py-2 text-sm',
      lg: 'min-h-12 px-6 py-3 text-base',
    }
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
export default Button
