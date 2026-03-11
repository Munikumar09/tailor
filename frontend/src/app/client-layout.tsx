"use client";

import React from "react";
import { 
  LayoutDashboard, 
  Target, 
  Sparkles, 
  TrendingUp, 
  FileText, 
  Download, 
  Bell, 
  User, 
  CreditCard, 
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SidebarItem = ({ icon: Icon, label, href, active, badge }: any) => (
  <Link href={href} className={cn(
    "flex items-center justify-between px-3 py-2 rounded-lg transition-colors group",
    active 
      ? "bg-indigo-500/15 border border-indigo-500/35 text-indigo-400" 
      : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
  )}>
    <div className="flex items-center gap-3">
      <Icon size={18} />
      <span className={cn("text-sm font-medium", active && "font-semibold")}>{label}</span>
    </div>
    {badge && (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-bold">
        {badge}
      </span>
    )}
  </Link>
);

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/landing" || pathname?.startsWith("/onboarding");
  
  if (isAuthPage) return <>{children}</>;

  return (
    <div className="flex h-screen bg-[#0F0F0F] text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[240px] bg-[#1A1A1A] border-r border-zinc-800 flex flex-col h-full shrink-0">
        <div className="p-5 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-lg">
            🚀
          </div>
          <div>
            <div className="text-sm font-extrabold">Job Commander</div>
            <div className="text-[10px] text-zinc-500">HITL MVP</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          <div className="px-3 py-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            Pipeline
          </div>
          <SidebarItem icon={LayoutDashboard} label="Dashboard" href="/" active={pathname === "/"} />
          <SidebarItem icon={Target} label="Job Pipeline" href="/jobs" active={pathname === "/jobs"} badge="4" />
          <SidebarItem icon={Sparkles} label="Tailor Resume" href="/tailor" active={pathname === "/tailor"} />
          <SidebarItem icon={TrendingUp} label="Analytics" href="/analytics" active={pathname === "/analytics"} />

          <div className="h-4" />
          <div className="px-3 py-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            Configure
          </div>
          <SidebarItem icon={FileText} label="Master Resume" href="/resume" active={pathname === "/resume"} />
          <SidebarItem icon={Download} label="Ingestion" href="/ingestion" active={pathname === "/ingestion"} badge="1" />
          <SidebarItem icon={Bell} label="Notifications" href="/notifications" active={pathname === "/notifications"} badge="2" />

          <div className="h-4" />
          <div className="px-3 py-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            Account
          </div>
          <SidebarItem icon={User} label="Profile" href="/profile" active={pathname === "/profile"} />
          <SidebarItem icon={CreditCard} label="Billing" href="/billing" active={pathname === "/billing"} />
          <SidebarItem icon={Settings} label="Settings" href="/settings" active={pathname === "/settings"} />
        </nav>

        <div className="p-3 border-t border-zinc-800">
          <div className="p-2 rounded-lg bg-zinc-900 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 shrink-0" />
            <div className="flex-1 overflow-hidden">
              <div className="text-xs font-semibold truncate">Alex Chen</div>
              <div className="text-[10px] text-zinc-500">Pro Plan</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
