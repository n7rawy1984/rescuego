import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: CardProps) {
  return <div className={cn('border-b border-slate-200 px-5 py-4 sm:px-6', className)}>{children}</div>
}

export function CardBody({ children, className }: CardProps) {
  return <div className={cn('px-5 py-4 sm:px-6', className)}>{children}</div>
}

export function CardFooter({ children, className }: CardProps) {
  return <div className={cn('rounded-b-2xl border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6', className)}>{children}</div>
}
