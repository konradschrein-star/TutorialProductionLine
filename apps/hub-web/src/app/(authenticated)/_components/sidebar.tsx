"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRegisterKeybind } from "../_lib/keybinds";
import { logoutAction } from "@/app/actions/auth";
import type { JWTPayload } from "@/lib/auth/jwt";
import { hasPermission } from "@/lib/auth/rbac";
import { activeWorkspaceHref, getWorkspaceNavigation } from "./workspace-navigation";
import { requestWorkspaceNavigation } from "@/lib/workspace-navigation-guard";

export function AppSidebar({ session }: { session: JWTPayload }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const items = getWorkspaceNavigation(session);
  const active = activeWorkspaceHref(pathname, searchParams.get("tab"), hasPermission(session, "view:production"));
  function navigate(href: string) { if (requestWorkspaceNavigation()) router.push(href); }
  useRegisterKeybind({ key: "g+d", description: "Go to My work", category: "Navigation" }, () => navigate("/tutorial-studio?tab=dashboard"), []);
  useRegisterKeybind({ key: "g+p", description: "Go to All tutorials", category: "Navigation" }, () => navigate("/tutorial-studio?tab=library"), []);
  useRegisterKeybind({ key: "g+u", description: "Go to Delivery", category: "Navigation" }, () => navigate("/tutorial-studio?tab=uploads"), []);

  return <aside className="studio-sidebar" aria-label="Workspace navigation" onClickCapture={event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const link = (event.target as HTMLElement).closest("a[href]");
    if (link && !requestWorkspaceNavigation()) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <Link href={hasPermission(session, "view:production") ? "/tutorial-studio" : "/tutorial-studio?tab=uploads"} className="studio-wordmark">
      <span className="studio-brand-icon material-symbols-outlined" aria-hidden="true">video_library</span>
      <span>Tutorial Studio<span className="studio-wordmark-caption">Production workspace</span></span>
    </Link>
    <nav className="studio-desktop-nav">
      {["Workspace", "Production", "Management"].map(group => {
        const entries = items.filter(item => item.group === group);
        return entries.length > 0 && <div className="studio-nav-group" key={group}>
          <p className="studio-nav-label">{group}</p>
          {entries.map(item => <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined} className="studio-nav-link">
            <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>{item.label}
          </Link>)}
        </div>;
      })}
    </nav>
    <label className="studio-mobile-nav">Workspace
      <select value={items.some(item => item.href === active) ? active : ""} onChange={event => navigate(event.target.value)} className="v2-select">
        {!items.some(item => item.href === active) && <option value="" disabled>Choose a section</option>}
        {items.map(item => <option key={item.href} value={item.href}>{item.label}</option>)}
      </select>
    </label>
    <div className="studio-account">
      <div className="studio-account-avatar" aria-hidden="true">{session.email[0].toUpperCase()}</div>
      <div className="studio-account-name"><span title={session.email}>{session.email}</span><small>{session.role.replace(/_/g, " ")}</small></div>
      <form action={logoutAction as unknown as string} onSubmit={event => { if (!requestWorkspaceNavigation()) event.preventDefault(); }}><button type="submit" className="studio-logout" aria-label="Logout" title="Logout"><span className="material-symbols-outlined" aria-hidden="true">logout</span></button></form>
    </div>
  </aside>;
}
