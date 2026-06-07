export default function NavbarSkeleton() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-10 xl:px-12">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D9E75]">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-xl text-slate-900">RescueGo</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    </nav>
  )
}
