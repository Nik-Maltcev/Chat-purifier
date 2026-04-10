import { Link, useLocation } from "wouter";
import { ShieldAlert, Plus, LayoutDashboard, Settings, Users } from "lucide-react";
import { Button } from "./ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 mr-6 text-foreground font-semibold hover:text-primary/80 transition-colors">
            <ShieldAlert className="w-5 h-5 text-primary" />
            <span className="tracking-tight">TG Analyzer</span>
          </Link>
          
          <nav className="flex items-center gap-4 flex-1">
            <Link href="/">
              <div className={`text-sm font-medium transition-colors hover:text-primary flex items-center gap-1.5 ${location === "/" ? "text-primary" : "text-muted-foreground"}`}>
                <LayoutDashboard className="w-4 h-4" />
                Дашборд
              </div>
            </Link>
            <Link href="/accounts">
              <div className={`text-sm font-medium transition-colors hover:text-primary flex items-center gap-1.5 ${location === "/accounts" ? "text-primary" : "text-muted-foreground"}`}>
                <Users className="w-4 h-4" />
                Аккаунты
              </div>
            </Link>
            <Link href="/settings">
              <div className={`text-sm font-medium transition-colors hover:text-primary flex items-center gap-1.5 ${location === "/settings" ? "text-primary" : "text-muted-foreground"}`}>
                <Settings className="w-4 h-4" />
                Настройки
              </div>
            </Link>
          </nav>
          
          <div>
            <Link href="/sessions/new">
              <Button size="sm" variant="default" className="h-8 gap-1">
                <Plus className="w-4 h-4" />
                Новая сессия
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
