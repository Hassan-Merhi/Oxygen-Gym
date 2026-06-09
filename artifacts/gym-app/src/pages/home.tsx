import { Link } from "wouter";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="px-6 h-16 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="GymPro" className="w-8 h-8" />
          <span className="font-bold text-xl tracking-tight">GYMPRO</span>
        </div>
        <div className="flex gap-4">
          <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-9 px-4">
            Sign In
          </Link>
          <Link href="/sign-up" className="bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium inline-flex items-center justify-center h-9 px-4 rounded-md">
            Sign Up
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl">
          The command center for serious gyms.
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl">
          Manage members, staff, payments, and stock from a single, high-performance dashboard. Built for speed and reliability.
        </p>
        <Link href="/sign-up" className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg font-medium inline-flex items-center justify-center h-12 px-8 rounded-md shadow-lg shadow-primary/20 transition-all">
          Get Started
        </Link>
      </main>
    </div>
  );
}