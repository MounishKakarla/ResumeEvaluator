import NavBar from './NavBar'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <NavBar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
