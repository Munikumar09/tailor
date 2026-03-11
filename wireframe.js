import { useState } from "react";

// ─── WIREFRAME DESIGN TOKENS ───────────────────────────────────────────────
const W = {
  bg: "#0F0F0F",
  surface: "#1A1A1A",
  surfaceHover: "#222222",
  border: "#2A2A2A",
  borderLight: "#333333",
  accent: "#6B6BFF",
  accentDim: "rgba(107,107,255,0.15)",
  accentBorder: "rgba(107,107,255,0.35)",
  text: "#E8E8E8",
  textMid: "#999999",
  textDim: "#555555",
  success: "#3ECF8E",
  successDim: "rgba(62,207,142,0.12)",
  warn: "#F59E0B",
  warnDim: "rgba(245,158,11,0.12)",
  danger: "#EF4444",
  dangerDim: "rgba(239,68,68,0.1)",
  purple: "#A855F7",
  purpleDim: "rgba(168,85,247,0.12)",
  cyan: "#22D3EE",
};

const ALL_SCREENS = [
  { id: "landing", label: "Landing Page", icon: "🏠", group: "Public" },
  { id: "login", label: "Sign In", icon: "🔐", group: "Auth" },
  { id: "register", label: "Create Account", icon: "📝", group: "Auth" },
  { id: "forgot", label: "Forgot Password", icon: "🔑", group: "Auth" },
  { id: "onboarding1", label: "Onboarding – Profile", icon: "👤", group: "Onboarding" },
  { id: "onboarding2", label: "Onboarding – Resume", icon: "📄", group: "Onboarding" },
  { id: "onboarding3", label: "Onboarding – Preferences", icon: "⚙️", group: "Onboarding" },
  { id: "dashboard", label: "Dashboard / Overview", icon: "📊", group: "Core App" },
  { id: "jobs", label: "Job Pipeline", icon: "🎯", group: "Core App" },
  { id: "jobdetail", label: "Job Detail & Analysis", icon: "🔍", group: "Core App" },
  { id: "tailor", label: "Resume Tailoring Agent", icon: "✨", group: "Core App" },
  { id: "resume", label: "Master Resume Editor", icon: "📋", group: "Core App" },
  { id: "ingestion", label: "Ingestion Control", icon: "📥", group: "Core App" },
  { id: "analytics", label: "Analytics & Insights", icon: "📈", group: "Core App" },
  { id: "settings", label: "Settings", icon: "⚙️", group: "Settings" },
  { id: "profile", label: "User Profile", icon: "👤", group: "Settings" },
  { id: "billing", label: "Billing & Plan", icon: "💳", group: "Settings" },
  { id: "notifications", label: "Notifications", icon: "🔔", group: "Settings" },
  { id: "empty", label: "Empty State", icon: "📭", group: "States" },
  { id: "error", label: "Error / 404", icon: "⚠️", group: "States" },
];

// ─── WIREFRAME PRIMITIVES ─────────────────────────────────────────────────

const Box = ({ w, h, label, style, children, onClick, color }) => (
  <div onClick={onClick} style={{
    width: w, height: h, minHeight: h,
    background: color ? `rgba(${color},0.08)` : W.surface,
    border: `1px solid ${color ? `rgba(${color},0.25)` : W.border}`,
    borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
    color: color ? `rgb(${color})` : W.textDim, fontSize: 11, fontWeight: 500,
    flexShrink: 0, position: "relative", overflow: "hidden",
    ...style
  }}>
    {children || <span style={{ color: W.textDim, fontSize: 10.5, textAlign: "center", padding: "0 8px" }}>{label}</span>}
  </div>
);

const Label = ({ children, size = 10, color, weight = 500, style }) => (
  <div style={{ fontSize: size, color: color || W.textDim, fontWeight: weight, letterSpacing: "0.05em", textTransform: "uppercase", ...style }}>{children}</div>
);

const Title = ({ children, size = 18, style }) => (
  <div style={{ fontSize: size, fontWeight: 700, color: W.text, letterSpacing: "-0.02em", lineHeight: 1.2, ...style }}>{children}</div>
);

const Subtitle = ({ children, style }) => (
  <div style={{ fontSize: 12, color: W.textMid, lineHeight: 1.5, ...style }}>{children}</div>
);

const Pill = ({ label, color, size = 10 }) => {
  const c = color || W.textDim;
  return <span style={{ fontSize: size, padding: "2px 8px", borderRadius: 20, background: `${c}18`, color: c, border: `1px solid ${c}30`, fontWeight: 600 }}>{label}</span>;
};

const Btn = ({ label, primary, small, icon, style }) => (
  <div style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: small ? "5px 12px" : "9px 18px",
    borderRadius: 9, fontSize: small ? 11 : 13, fontWeight: 600,
    background: primary ? W.accent : W.surface,
    border: `1px solid ${primary ? W.accent : W.borderLight}`,
    color: primary ? "#fff" : W.textMid, cursor: "pointer",
    flexShrink: 0, ...style,
  }}>
    {icon && <span style={{ fontSize: small ? 11 : 13 }}>{icon}</span>}
    {label}
  </div>
);

const Input = ({ placeholder, icon, style }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: W.bg, border: `1px solid ${W.borderLight}`, borderRadius: 9, ...style }}>
    {icon && <span style={{ fontSize: 13, opacity: 0.5 }}>{icon}</span>}
    <span style={{ fontSize: 12, color: W.textDim }}>{placeholder}</span>
  </div>
);

const Divider = ({ style }) => <div style={{ height: 1, background: W.border, width: "100%", ...style }} />;

const WFCard = ({ children, style }) => (
  <div style={{ background: W.surface, border: `1px solid ${W.border}`, borderRadius: 12, padding: "16px 18px", ...style }}>
    {children}
  </div>
);

const Tag = ({ label }) => (
  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: W.bg, color: W.textDim, border: `1px solid ${W.border}` }}>{label}</span>
);

const ScoreCircle = ({ score, size = 40 }) => {
  const color = score >= 90 ? W.success : score >= 80 ? W.accent : W.warn;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", border: `3px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: size * 0.28, fontWeight: 800, color }}>{score}</span>
    </div>
  );
};

const SidebarItem = ({ icon, label, active, badge }) => (
  <div style={{ padding: "8px 12px", borderRadius: 9, background: active ? W.accentDim : "none", border: active ? `1px solid ${W.accentBorder}` : "1px solid transparent", display: "flex", alignItems: "center", gap: 9, cursor: "pointer", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? W.accent : W.textMid }}>{label}</span>
    </div>
    {badge && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: W.warn + "22", color: W.warn, fontWeight: 700 }}>{badge}</span>}
  </div>
);

const Sidebar = ({ active }) => (
  <div style={{ width: 210, background: W.surface, borderRight: `1px solid ${W.border}`, height: "100%", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
    <div style={{ padding: "0 16px 20px", borderBottom: `1px solid ${W.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${W.accent},${W.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚀</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: W.text }}>Job Commander</div>
          <div style={{ fontSize: 10, color: W.textDim }}>HITL MVP</div>
        </div>
      </div>
    </div>
    <div style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
      <Label style={{ padding: "6px 10px 4px" }}>Pipeline</Label>
      <SidebarItem icon="📊" label="Dashboard" active={active === "dashboard"} />
      <SidebarItem icon="🎯" label="Job Pipeline" active={active === "jobs"} badge="4" />
      <SidebarItem icon="✨" label="Tailor Resume" active={active === "tailor"} />
      <SidebarItem icon="📈" label="Analytics" active={active === "analytics"} />
      <div style={{ height: 8 }} />
      <Label style={{ padding: "6px 10px 4px" }}>Configure</Label>
      <SidebarItem icon="📄" label="Master Resume" active={active === "resume"} />
      <SidebarItem icon="📥" label="Ingestion" active={active === "ingestion"} />
      <SidebarItem icon="🔔" label="Notifications" active={active === "notifications"} badge="2" />
      <div style={{ height: 8 }} />
      <Label style={{ padding: "6px 10px 4px" }}>Account</Label>
      <SidebarItem icon="👤" label="Profile" active={active === "profile"} />
      <SidebarItem icon="💳" label="Billing" active={active === "billing"} />
      <SidebarItem icon="⚙️" label="Settings" active={active === "settings"} />
    </div>
    <div style={{ padding: "12px 10px", borderTop: `1px solid ${W.border}` }}>
      <div style={{ padding: "8px 12px", borderRadius: 9, background: W.bg, display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${W.accent},${W.purple})` }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>Alex Chen</div>
          <div style={{ fontSize: 10, color: W.textDim }}>Pro Plan</div>
        </div>
      </div>
    </div>
  </div>
);

const AppShell = ({ active, children, title, subtitle, actions }) => (
  <div style={{ display: "flex", height: "100%", background: W.bg }}>
    <Sidebar active={active} />
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: W.surface, flexShrink: 0 }}>
        <div>
          <Title size={16}>{title}</Title>
          {subtitle && <Subtitle style={{ marginTop: 2, fontSize: 11 }}>{subtitle}</Subtitle>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {actions}
          <div style={{ width: 28, height: 28, borderRadius: 8, background: W.bg, border: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🔔</div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>{children}</div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// SCREEN RENDERERS
// ═══════════════════════════════════════════════════════════════════

const screens = {

  // ── 1. LANDING PAGE ──────────────────────────────────────────────
  landing: () => (
    <div style={{ background: W.bg, height: "100%", overflow: "auto" }}>
      {/* Nav */}
      <div style={{ padding: "16px 40px", borderBottom: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(15,15,15,0.95)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${W.accent},${W.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚀</div>
          <Title size={15} style={{ color: W.text }}>Job Commander</Title>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn label="Sign In" />
          <Btn label="Get Started Free" primary />
        </div>
      </div>
      {/* Hero */}
      <div style={{ padding: "80px 40px 60px", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <Pill label="✦ AI-Powered · HITL Pipeline" color={W.accent} size={11} />
        <div style={{ fontSize: 44, fontWeight: 900, color: W.text, letterSpacing: "-0.04em", lineHeight: 1.1, marginTop: 20 }}>
          Apply smarter.<br />
          <span style={{ color: W.accent }}>Not harder.</span>
        </div>
        <div style={{ fontSize: 15, color: W.textMid, marginTop: 20, lineHeight: 1.6, maxWidth: 560, margin: "20px auto 0" }}>
          Automatically discover relevant jobs, filter by AI fit score, and get your resume tailored with exact JD keywords — all without hallucinating skills you don't have.
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 36 }}>
          <Btn label="Start Free Trial" primary style={{ padding: "12px 28px", fontSize: 14 }} />
          <Btn label="Watch Demo →" style={{ padding: "12px 28px", fontSize: 14 }} />
        </div>
        {/* Hero Mockup */}
        <div style={{ marginTop: 56, background: W.surface, border: `1px solid ${W.border}`, borderRadius: 16, padding: 20, textAlign: "left" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["#FF5F57","#FEBC2E","#28C840"].map(c=><div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[{v:"47",l:"Jobs Ingested",c:W.accent},{v:"18",l:"Passed Filter",c:W.success},{v:"94",l:"Best Match Score",c:W.warn}].map(s=>(
              <div key={s.l} style={{ background: W.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${W.border}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.c }}>{s.v}</div>
                <div style={{ fontSize: 11, color: W.textDim, marginTop: 2 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Features */}
      <div style={{ padding: "40px 40px 60px", borderTop: `1px solid ${W.border}` }}>
        <Label style={{ textAlign: "center", marginBottom: 32, fontSize: 11 }}>How It Works</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, maxWidth: 900, margin: "0 auto" }}>
          {[
            { icon: "📥", title: "Ingest", desc: "API-powered job discovery every 6h. Zero brittle scrapers." },
            { icon: "⚡", title: "Filter", desc: "LLM scores fit against your resume. Only ≥75 passes." },
            { icon: "✨", title: "Tailor", desc: "LangGraph agent injects JD keywords. No hallucinations." },
            { icon: "🎯", title: "Apply", desc: "You click Apply. You beat the bots. You get hired." },
          ].map((f, i) => (
            <WFCard key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: W.text, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 11, color: W.textMid, lineHeight: 1.6 }}>{f.desc}</div>
            </WFCard>
          ))}
        </div>
      </div>
      {/* CTA */}
      <div style={{ padding: "40px", textAlign: "center", background: `linear-gradient(180deg,${W.bg} 0%,rgba(107,107,255,0.05) 100%)`, borderTop: `1px solid ${W.border}` }}>
        <Title size={24}>Ready to command your job search?</Title>
        <Subtitle style={{ marginTop: 10 }}>Start free. No credit card required.</Subtitle>
        <div style={{ marginTop: 24 }}><Btn label="Create Free Account →" primary style={{ padding: "13px 32px", fontSize: 14 }} /></div>
      </div>
    </div>
  ),

  // ── 2. SIGN IN ────────────────────────────────────────────────────
  login: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: 380 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${W.accent},${W.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚀</div>
            <Title size={15}>Job Commander</Title>
          </div>
          <Title size={24} style={{ marginBottom: 8 }}>Welcome back</Title>
          <Subtitle style={{ marginBottom: 32 }}>Sign in to your pipeline dashboard</Subtitle>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[["G","Google"],["GH","GitHub"]].map(([ic,lab])=>(
              <div key={lab} style={{ flex: 1, padding: "10px", borderRadius: 9, background: W.surface, border: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: W.bg, width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: W.textMid }}>{ic}</span>
                <span style={{ fontSize: 12, color: W.textMid }}>Continue with {lab}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <Divider /><span style={{ fontSize: 11, color: W.textDim, flexShrink: 0 }}>or email</span><Divider />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Label style={{ marginBottom: 6 }}>Email address</Label>
              <Input placeholder="alex@company.com" icon="✉️" style={{ borderRadius: 9 }} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <Label>Password</Label>
                <span style={{ fontSize: 10, color: W.accent, cursor: "pointer" }}>Forgot password?</span>
              </div>
              <Input placeholder="••••••••" icon="🔒" style={{ borderRadius: 9 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${W.border}`, background: W.accentDim }} />
              <span style={{ fontSize: 11, color: W.textMid }}>Remember me for 30 days</span>
            </div>
            <Btn label="Sign In" primary style={{ width: "100%", justifyContent: "center", marginTop: 4, padding: "11px" }} />
          </div>
          <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: W.textMid }}>
            Don't have an account? <span style={{ color: W.accent, cursor: "pointer" }}>Create one free →</span>
          </div>
        </div>
      </div>
      <div style={{ width: 420, background: W.surface, borderLeft: `1px solid ${W.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, gap: 16 }}>
        <Label style={{ fontSize: 11, textAlign: "center", marginBottom: 8 }}>Your pipeline today</Label>
        {[{v:"12",l:"New matches found",c:W.accent},{v:"3",l:"Ready to tailor",c:W.purple},{v:"1",l:"Applied today",c:W.success}].map(s=>(
          <WFCard key={s.l} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c, minWidth: 36 }}>{s.v}</div>
            <span style={{ fontSize: 12, color: W.textMid }}>{s.l}</span>
          </WFCard>
        ))}
      </div>
    </div>
  ),

  // ── 3. REGISTER ───────────────────────────────────────────────────
  register: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: `linear-gradient(135deg,${W.accent},${W.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, margin: "0 auto 16px" }}>🚀</div>
          <Title size={22}>Create your account</Title>
          <Subtitle style={{ marginTop: 6 }}>Start your AI-powered job search today</Subtitle>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["G","Google"],["GH","GitHub"]].map(([ic,lab])=>(
            <div key={lab} style={{ flex: 1, padding: "10px", borderRadius: 9, background: W.surface, border: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
              <span style={{ fontSize: 11, fontWeight: 700, background: W.bg, width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: W.textMid }}>{ic}</span>
              <span style={{ fontSize: 12, color: W.textMid }}>{lab}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Divider /><span style={{ fontSize: 11, color: W.textDim, flexShrink: 0 }}>or</span><Divider />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Label style={{ marginBottom: 5 }}>First name</Label><Input placeholder="Alex" /></div>
            <div style={{ flex: 1 }}><Label style={{ marginBottom: 5 }}>Last name</Label><Input placeholder="Chen" /></div>
          </div>
          <div><Label style={{ marginBottom: 5 }}>Work email</Label><Input placeholder="alex@company.com" icon="✉️" /></div>
          <div><Label style={{ marginBottom: 5 }}>Password</Label><Input placeholder="Min. 8 characters" icon="🔒" /></div>
          <div><Label style={{ marginBottom: 5 }}>Confirm password</Label><Input placeholder="Repeat password" icon="🔒" /></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${W.border}`, flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11, color: W.textMid, lineHeight: 1.5 }}>I agree to the <span style={{ color: W.accent }}>Terms of Service</span> and <span style={{ color: W.accent }}>Privacy Policy</span></span>
          </div>
          <Btn label="Create Account →" primary style={{ justifyContent: "center", padding: "11px", marginTop: 4 }} />
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: W.textMid }}>
          Already have an account? <span style={{ color: W.accent }}>Sign in</span>
        </div>
      </div>
    </div>
  ),

  // ── 4. FORGOT PASSWORD ────────────────────────────────────────────
  forgot: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: W.accentDim, border: `1px solid ${W.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 24px" }}>🔑</div>
        <Title size={22} style={{ marginBottom: 8 }}>Reset your password</Title>
        <Subtitle style={{ marginBottom: 32 }}>Enter your email and we'll send a reset link</Subtitle>
        <Input placeholder="your@email.com" icon="✉️" style={{ marginBottom: 16 }} />
        <Btn label="Send Reset Link" primary style={{ width: "100%", justifyContent: "center", padding: "11px" }} />
        <div style={{ marginTop: 24, fontSize: 12, color: W.textMid }}><span style={{ color: W.accent, cursor: "pointer" }}>← Back to sign in</span></div>
        {/* Success state hint */}
        <WFCard style={{ marginTop: 24, background: W.successDim, borderColor: W.success + "30", textAlign: "left" }}>
          <div style={{ fontSize: 11, color: W.success, fontWeight: 600, marginBottom: 4 }}>✓ Email sent (success state)</div>
          <div style={{ fontSize: 11, color: W.textMid }}>Check your inbox for the reset link. Valid for 15 minutes.</div>
        </WFCard>
      </div>
    </div>
  ),

  // ── 5. ONBOARDING STEP 1 ──────────────────────────────────────────
  onboarding1: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex" }}>
      <div style={{ width: 280, background: W.surface, borderRight: `1px solid ${W.border}`, padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 40 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg,${W.accent},${W.purple})`, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🚀</div>
          <Title size={13}>Setup Wizard</Title>
        </div>
        {[
          ["1","👤","Your Profile",true,false],
          ["2","📄","Upload Resume",false,false],
          ["3","⚙️","Job Preferences",false,false],
          ["4","🎉","You're all set!",false,false],
        ].map(([num,icon,lab,active,done])=>(
          <div key={lab} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", opacity: active ? 1 : 0.4 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: active ? W.accent : W.bg, border: `2px solid ${active ? W.accent : W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: active ? "#fff" : W.textDim, flexShrink: 0 }}>{num}</div>
            <span style={{ fontSize: 13, color: active ? W.text : W.textMid, fontWeight: active ? 600 : 400 }}>{lab}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "48px 40px", overflow: "auto" }}>
        <Label style={{ marginBottom: 8 }}>Step 1 of 4</Label>
        <Title size={26} style={{ marginBottom: 8 }}>Tell us about yourself</Title>
        <Subtitle style={{ marginBottom: 36 }}>This helps us find jobs that actually match your background</Subtitle>
        <div style={{ maxWidth: 540, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ flex: 1 }}><Label style={{ marginBottom: 6 }}>Full Name</Label><Input placeholder="Alex Chen" /></div>
            <div style={{ flex: 1 }}><Label style={{ marginBottom: 6 }}>Current Title</Label><Input placeholder="Senior Frontend Engineer" /></div>
          </div>
          <div><Label style={{ marginBottom: 6 }}>Years of Experience</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {["0–2 yrs","3–5 yrs","6–10 yrs","10+ yrs"].map(y=>(
                <div key={y} style={{ padding: "7px 14px", borderRadius: 8, background: y==="6–10 yrs" ? W.accentDim : W.surface, border: `1px solid ${y==="6–10 yrs" ? W.accent : W.border}`, fontSize: 12, color: y==="6–10 yrs" ? W.accent : W.textMid, cursor: "pointer" }}>{y}</div>
              ))}
            </div>
          </div>
          <div><Label style={{ marginBottom: 6 }}>Primary Skills (top 5)</Label><Input placeholder="React, TypeScript, Node.js, Python, AWS" /></div>
          <div><Label style={{ marginBottom: 6 }}>LinkedIn URL</Label><Input placeholder="linkedin.com/in/alexchen" icon="🔗" /></div>
          <div><Label style={{ marginBottom: 6 }}>Preferred Work Mode</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {["Remote","Hybrid","On-site","Flexible"].map(m=>(
                <div key={m} style={{ padding: "7px 14px", borderRadius: 8, background: m==="Remote"||m==="Hybrid" ? W.accentDim : W.surface, border: `1px solid ${m==="Remote"||m==="Hybrid" ? W.accent : W.border}`, fontSize: 12, color: m==="Remote"||m==="Hybrid" ? W.accent : W.textMid, cursor: "pointer" }}>{m}</div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn label="Continue →" primary style={{ padding: "11px 28px" }} />
          </div>
        </div>
      </div>
    </div>
  ),

  // ── 6. ONBOARDING STEP 2 ──────────────────────────────────────────
  onboarding2: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex" }}>
      <div style={{ width: 280, background: W.surface, borderRight: `1px solid ${W.border}`, padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 40 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg,${W.accent},${W.purple})`, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🚀</div>
          <Title size={13}>Setup Wizard</Title>
        </div>
        {[["1","✓","Your Profile",false,true],["2","📄","Upload Resume",true,false],["3","⚙️","Job Preferences",false,false],["4","🎉","You're all set!",false,false]].map(([num,icon,lab,active,done])=>(
          <div key={lab} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", opacity: active||done ? 1 : 0.4 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: done ? W.success : active ? W.accent : W.bg, border: `2px solid ${done ? W.success : active ? W.accent : W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{done?"✓":num}</div>
            <span style={{ fontSize: 13, color: active ? W.text : done ? W.success : W.textMid, fontWeight: active||done ? 600 : 400 }}>{lab}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "48px 40px", overflow: "auto" }}>
        <Label style={{ marginBottom: 8 }}>Step 2 of 4</Label>
        <Title size={26} style={{ marginBottom: 8 }}>Upload your master resume</Title>
        <Subtitle style={{ marginBottom: 36 }}>This becomes the base for all tailored versions. Upload a .docx for best results.</Subtitle>
        <div style={{ maxWidth: 540 }}>
          <div style={{ border: `2px dashed ${W.accentBorder}`, borderRadius: 14, padding: "48px 24px", textAlign: "center", background: W.accentDim, marginBottom: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: W.text, marginBottom: 6 }}>Drop your resume here</div>
            <div style={{ fontSize: 12, color: W.textMid, marginBottom: 16 }}>Supports .docx, .pdf — max 5MB</div>
            <Btn label="Browse Files" />
          </div>
          <WFCard style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 20 }}>📄</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: W.text }}>Alex_Chen_Resume_2025.docx</div>
              <div style={{ fontSize: 11, color: W.textDim }}>245 KB · Uploaded just now</div>
            </div>
            <Pill label="✓ Parsed" color={W.success} />
          </WFCard>
          <WFCard style={{ background: W.successDim, borderColor: W.success + "30" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: W.success, marginBottom: 8 }}>✓ Resume parsed successfully</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[["8","Work bullets"],["12","Skills detected"],["4","Projects found"]].map(([v,l])=>(
                <div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800, color: W.text }}>{v}</div><div style={{ fontSize: 10, color: W.textDim }}>{l}</div></div>
              ))}
            </div>
          </WFCard>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
            <Btn label="← Back" />
            <Btn label="Continue →" primary style={{ padding: "11px 28px" }} />
          </div>
        </div>
      </div>
    </div>
  ),

  // ── 7. ONBOARDING STEP 3 ──────────────────────────────────────────
  onboarding3: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex" }}>
      <div style={{ width: 280, background: W.surface, borderRight: `1px solid ${W.border}`, padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 40 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg,${W.accent},${W.purple})`, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>🚀</div>
          <Title size={13}>Setup Wizard</Title>
        </div>
        {[["1","✓","Your Profile",false,true],["2","✓","Upload Resume",false,true],["3","⚙️","Job Preferences",true,false],["4","🎉","You're all set!",false,false]].map(([num,icon,lab,active,done])=>(
          <div key={lab} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", opacity: active||done ? 1 : 0.4 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: done ? W.success : active ? W.accent : W.bg, border: `2px solid ${done ? W.success : active ? W.accent : W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{done?"✓":num}</div>
            <span style={{ fontSize: 13, color: active ? W.text : done ? W.success : W.textMid, fontWeight: active||done ? 600 : 400 }}>{lab}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "48px 40px", overflow: "auto" }}>
        <Label style={{ marginBottom: 8 }}>Step 3 of 4</Label>
        <Title size={26} style={{ marginBottom: 8 }}>Set your job preferences</Title>
        <Subtitle style={{ marginBottom: 36 }}>These filters shape every ingestion run and filter pass</Subtitle>
        <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 18 }}>
          <div><Label style={{ marginBottom: 8 }}>Target Job Titles</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {["Senior Frontend Engineer","Staff Engineer","Frontend Architect"].map(t=>(
                <div key={t} style={{ padding: "5px 12px", borderRadius: 8, background: W.accentDim, border: `1px solid ${W.accentBorder}`, fontSize: 12, color: W.accent, display: "flex", gap: 6, alignItems: "center" }}>{t} <span style={{ opacity: 0.5, cursor: "pointer" }}>✕</span></div>
              ))}
            </div>
            <Input placeholder="+ Add title..." />
          </div>
          <div><Label style={{ marginBottom: 8 }}>Minimum Salary (USD/yr)</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {["$80k","$100k","$130k","$150k+","$200k+"].map(s=>(
                <div key={s} style={{ padding: "7px 12px", borderRadius: 8, background: s==="$130k" ? W.accentDim : W.surface, border: `1px solid ${s==="$130k" ? W.accent : W.border}`, fontSize: 12, color: s==="$130k" ? W.accent : W.textMid, cursor: "pointer" }}>{s}</div>
              ))}
            </div>
          </div>
          <div><Label style={{ marginBottom: 8 }}>Minimum AI Fit Score</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {["60","70","75","80","85","90"].map(s=>(
                <div key={s} style={{ padding: "7px 14px", borderRadius: 8, background: s==="75" ? W.accentDim : W.surface, border: `1px solid ${s==="75" ? W.accent : W.border}`, fontSize: 12, color: s==="75" ? W.accent : W.textMid, cursor: "pointer" }}>{s}</div>
              ))}
            </div>
          </div>
          <div><Label style={{ marginBottom: 8 }}>Preferred Locations</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Remote","San Francisco","New York","Austin","Seattle"].map(l=>(
                <div key={l} style={{ padding: "5px 12px", borderRadius: 8, background: ["Remote","San Francisco"].includes(l) ? W.accentDim : W.surface, border: `1px solid ${["Remote","San Francisco"].includes(l) ? W.accent : W.border}`, fontSize: 12, color: ["Remote","San Francisco"].includes(l) ? W.accent : W.textMid, cursor: "pointer" }}>{l}</div>
              ))}
            </div>
          </div>
          <div><Label style={{ marginBottom: 8 }}>Ingestion Frequency</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {["Every 3h","Every 6h","Every 12h","Daily"].map(f=>(
                <div key={f} style={{ padding: "7px 14px", borderRadius: 8, background: f==="Every 6h" ? W.accentDim : W.surface, border: `1px solid ${f==="Every 6h" ? W.accent : W.border}`, fontSize: 12, color: f==="Every 6h" ? W.accent : W.textMid, cursor: "pointer" }}>{f}</div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <Btn label="← Back" />
            <Btn label="Finish Setup 🎉" primary style={{ padding: "11px 28px" }} />
          </div>
        </div>
      </div>
    </div>
  ),

  // ── 8. DASHBOARD ──────────────────────────────────────────────────
  dashboard: () => (
    <AppShell active="dashboard" title="Dashboard" subtitle="Saturday, Feb 28 · Pipeline is active"
      actions={<><Btn label="⚡ Run Ingestion" primary small /><Btn label="View All Jobs" small /></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[{v:"47",l:"Ingested",d:"↑12 today",c:W.accent},{v:"18",l:"Passed Filter",d:"≥75 score",c:W.purple},{v:"4",l:"Pending Review",d:"Action needed",c:W.warn},{v:"3",l:"Applied",d:"This week",c:W.success}].map(s=>(
          <WFCard key={s.l}>
            <Label style={{ marginBottom: 8 }}>{s.l}</Label>
            <div style={{ fontSize: 32, fontWeight: 800, color: s.c, letterSpacing: "-0.03em" }}>{s.v}</div>
            <div style={{ fontSize: 11, color: W.textMid, marginTop: 4 }}>{s.d}</div>
          </WFCard>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Pipeline Funnel</Label>
          {[["Ingested","47",W.textDim,100],["Filtered ≥75","18",W.accent,38],["Reviewed","12",W.purple,26],["Tailored","5",W.warn,11],["Applied","3",W.success,6]].map(([l,v,c,pct])=>(
            <div key={l} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: W.textMid }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</span>
              </div>
              <div style={{ height: 4, background: W.bg, borderRadius: 2 }}>
                <div style={{ height: 4, width: `${pct}%`, background: c, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </WFCard>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Recent Activity</Label>
          {[
            { t: "New job matched", d: "Staff Eng @ Anthropic · score 88", time: "2h ago", c: W.accent, icon: "✨" },
            { t: "Resume tailored", d: "Senior FE @ Vercel · 8 bullets rewritten", time: "5h ago", c: W.purple, icon: "📄" },
            { t: "Applied", d: "Full Stack Eng @ Linear", time: "1d ago", c: W.success, icon: "✅" },
            { t: "Ingestion run", d: "47 jobs fetched · 12 new matches", time: "2h ago", c: W.textDim, icon: "📥" },
          ].map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < 3 ? `1px solid ${W.border}` : "none" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: W.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{a.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>{a.t}</div>
                <div style={{ fontSize: 11, color: W.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.d}</div>
              </div>
              <div style={{ fontSize: 10, color: W.textDim, flexShrink: 0 }}>{a.time}</div>
            </div>
          ))}
        </WFCard>
      </div>
      <WFCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <Label>Pending Action</Label>
          <Btn label="View All →" small />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[{t:"Senior Frontend Engineer",c:"Vercel",s:94,status:"Pending"},{t:"Staff Engineer – AI Platform",c:"Anthropic",s:88,status:"Tailored"},{t:"Frontend Architect",c:"Figma",s:79,status:"Pending"}].map((j,i)=>(
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: W.bg, borderRadius: 10, border: `1px solid ${W.border}` }}>
              <ScoreCircle score={j.s} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: W.text }}>{j.t}</div>
                <div style={{ fontSize: 11, color: W.textDim }}>{j.c}</div>
              </div>
              <Pill label={j.status} color={j.status==="Pending" ? W.warn : W.purple} />
              {j.status==="Pending" ? <Btn label="Tailor" primary small /> : <Btn label="Download" small />}
            </div>
          ))}
        </div>
      </WFCard>
    </AppShell>
  ),

  // ── 9. JOB PIPELINE ───────────────────────────────────────────────
  jobs: () => (
    <AppShell active="jobs" title="Job Pipeline" subtitle="18 jobs passed filter · 4 pending review"
      actions={<><Btn label="⚡ Run Ingestion" primary small /><Btn label="Filter ▾" small /></>}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["All (18)","Pending (4)","Tailored (2)","Applied (3)","Skipped (9)"].map((f,i)=>(
          <div key={f} style={{ padding: "7px 14px", borderRadius: 9, background: i===0 ? W.accentDim : W.surface, border: `1px solid ${i===0 ? W.accent : W.border}`, fontSize: 12, color: i===0 ? W.accent : W.textMid, cursor: "pointer", fontWeight: i===0 ? 600 : 400 }}>{f}</div>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <Input placeholder="🔍  Search jobs..." style={{ width: 220, padding: "7px 12px", fontSize: 12 }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          {t:"Senior Frontend Engineer",c:"Vercel",loc:"Remote",sal:"$160k–$200k",s:94,status:"Pending",tags:["Next.js","TypeScript","React"],logo:"V",posted:"2h ago"},
          {t:"Staff Engineer – AI Platform",c:"Anthropic",loc:"San Francisco",sal:"$220k–$280k",s:88,status:"Tailored",tags:["Python","LangGraph","FastAPI"],logo:"A",posted:"5h ago"},
          {t:"Full Stack Engineer",c:"Linear",loc:"Remote",sal:"$130k–$170k",s:81,status:"Applied",tags:["React","Node.js","PostgreSQL"],logo:"L",posted:"1d ago"},
          {t:"Frontend Architect",c:"Figma",loc:"New York",sal:"$180k–$230k",s:79,status:"Pending",tags:["WebGL","Canvas","TypeScript"],logo:"F",posted:"1d ago"},
          {t:"Senior Engineer – Infra",c:"PlanetScale",loc:"Remote",sal:"$150k–$190k",s:76,status:"Skipped",tags:["Kubernetes","Go","MySQL"],logo:"P",posted:"2d ago"},
        ].map((j,i)=>(
          <div key={i} style={{ background: W.surface, border: `1px solid ${W.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, opacity: j.status==="Skipped" ? 0.55 : 1 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: W.bg, border: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: W.textMid, flexShrink: 0 }}>{j.logo}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: W.text }}>{j.t}</span>
                <Pill label={j.status} color={j.status==="Pending"?W.warn:j.status==="Tailored"?W.purple:j.status==="Applied"?W.success:W.textDim} />
              </div>
              <div style={{ fontSize: 12, color: W.textDim, marginBottom: 8 }}>{j.c} · {j.loc} · {j.sal} · {j.posted}</div>
              <div style={{ display: "flex", gap: 5 }}>{j.tags.map(t=><Tag key={t} label={t} />)}</div>
            </div>
            <ScoreCircle score={j.s} size={42} />
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {j.status==="Pending" && <Btn label="✨ Tailor" primary small />}
              {j.status==="Tailored" && <Btn label="⬇ Download" small />}
              {j.status==="Applied" && <Pill label="✓ Applied" color={W.success} />}
              <Btn label="View" small />
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  ),

  // ── 10. JOB DETAIL ────────────────────────────────────────────────
  jobdetail: () => (
    <AppShell active="jobs" title="Job Detail" subtitle="← Back to Pipeline"
      actions={<><Btn label="✨ Tailor Resume" primary /><Btn label="View JD ↗" /></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: 13, background: W.bg, border: `1px solid ${W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 20, color: W.textMid }}>V</div>
              <div>
                <Title size={20}>Senior Frontend Engineer</Title>
                <Subtitle>Vercel · San Francisco (Remote OK) · $160k–$200k</Subtitle>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>{["Next.js","TypeScript","Edge Runtime","Core Web Vitals","React"].map(t=><Tag key={t} label={t} />)}</div>
              </div>
            </div>
            <Divider style={{ marginBottom: 16 }} />
            <Label style={{ marginBottom: 10 }}>Job Description</Label>
            {["We're looking for a Senior Frontend Engineer to join our Core DX team...","You'll work on the Vercel deployment pipeline, optimize Core Web Vitals tooling, and build edge-first UI primitives...","Requirements: 5+ years React/TypeScript. Deep knowledge of Edge Runtime. Experience with Web Performance APIs..."].map((p,i)=>(
              <div key={i} style={{ height: 10, background: W.border, borderRadius: 4, marginBottom: 8, width: i===2 ? "75%" : "100%", opacity: 0.6 }} />
            ))}
            {Array(6).fill(0).map((_,i)=><div key={i} style={{ height: 8, background: W.bg, borderRadius: 3, marginBottom: 7, width: i%3===0 ? "90%" : i%3===1 ? "70%" : "80%" }} />)}
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 14 }}>Extracted Keywords (by LLM)</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                {kw:"Edge Runtime",present:false,weight:"Critical"},
                {kw:"Core Web Vitals",present:false,weight:"Critical"},
                {kw:"Next.js",present:true,weight:"High"},
                {kw:"TypeScript",present:true,weight:"High"},
                {kw:"React Server Components",present:false,weight:"Medium"},
                {kw:"Performance Optimization",present:true,weight:"Medium"},
                {kw:"CI/CD Pipelines",present:true,weight:"Low"},
                {kw:"Monorepo Management",present:false,weight:"Low"},
              ].map(k=>(
                <div key={k.kw} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: W.bg, borderRadius: 8, border: `1px solid ${W.border}` }}>
                  <span style={{ fontSize: 12 }}>{k.present ? "✅" : "⚠️"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>{k.kw}</div>
                    <div style={{ fontSize: 10, color: W.textDim }}>{k.weight}</div>
                  </div>
                </div>
              ))}
            </div>
          </WFCard>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>AI Match Score</Label>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", border: `5px solid ${W.success}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: W.success }}>94</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: W.textMid, lineHeight: 1.6 }}>Strong TypeScript + Next.js alignment. 'Edge Runtime' and 'Core Web Vitals' are high-priority missing keywords. Tailoring will inject these into 3 existing bullets.</div>
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Quick Stats</Label>
            {[["Posted","2 hours ago"],["Company Size","500–1000"],["Funding","Series C"],["ATS System","Greenhouse"],["Apply Before","Mar 15, 2026"]].map(([l,v])=>(
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${W.border}` }}>
                <span style={{ fontSize: 11, color: W.textDim }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: W.text }}>{v}</span>
              </div>
            ))}
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Status</Label>
            {["Pending","Tailoring","Applied","Skipped"].map(s=>(
              <div key={s} style={{ padding: "8px 12px", borderRadius: 8, background: s==="Pending" ? W.warnDim : W.bg, border: `1px solid ${s==="Pending" ? W.warn+"44" : W.border}`, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: s==="Pending" ? W.warn : W.textDim }} />
                <span style={{ fontSize: 12, color: s==="Pending" ? W.warn : W.textMid, fontWeight: s==="Pending" ? 600 : 400 }}>{s}</span>
              </div>
            ))}
          </WFCard>
        </div>
      </div>
    </AppShell>
  ),

  // ── 11. TAILORING AGENT ───────────────────────────────────────────
  tailor: () => (
    <AppShell active="tailor" title="Resume Tailoring Agent" subtitle="LangGraph · Claude 3.7 Sonnet">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, height: "calc(100% - 20px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Current Job Target</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px", background: W.bg, borderRadius: 10, border: `1px solid ${W.border}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: W.surface, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, color: W.textMid }}>V</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: W.text }}>Senior Frontend Engineer — Vercel</div><div style={{ fontSize: 11, color: W.textDim }}>Score: 94 · Remote · $160k–$200k</div></div>
              <Btn label="Change" small />
            </div>
          </WFCard>
          <WFCard style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <Label>Agent Steps</Label>
              <Pill label="Completed" color={W.success} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                {icon:"🔍",title:"Analyze JD Keywords",desc:"Extracted 18 required and 6 preferred keywords","done":true},
                {icon:"🗺️",title:"Map to Master Resume",desc:"Found 12/18 required keywords already present","done":true},
                {icon:"✍️",title:"Rewrite Bullet Points",desc:"Rewrote 8 bullets · injected 6 missing keywords","done":true},
                {icon:"🧪",title:"Validate Accuracy",desc:"0 hallucinated skills detected · ATS score: 91","done":true},
                {icon:"📄",title:"Generate Document",desc:".docx generated · ATS-compatible formatting","done":true},
              ].map((step,i)=>(
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px", background: W.bg, borderRadius: 10, border: `1px solid ${W.border}` }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: W.successDim, border: `1px solid ${W.success}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{step.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: W.text }}>{step.title} <span style={{ color: W.success, fontSize: 11 }}>✓</span></div>
                    <div style={{ fontSize: 11, color: W.textDim }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </WFCard>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard style={{ background: W.successDim, borderColor: W.success + "30" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: W.success, marginBottom: 8 }}>✓ Tailoring Complete</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[["8","Bullets rewritten"],["6","Keywords injected"],["0","Hallucinations"],["91","ATS Score"]].map(([v,l])=>(
                <div key={l} style={{ textAlign: "center", padding: "8px", background: "rgba(62,207,142,0.08)", borderRadius: 8 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: W.success }}>{v}</div>
                  <div style={{ fontSize: 10, color: W.textDim }}>{l}</div>
                </div>
              ))}
            </div>
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Download Resume</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[["📄",".docx","ATS-Optimized","Recommended"],["📋",".pdf","Visual Format",""]].map(([ic,fmt,sub,rec])=>(
                <div key={fmt} style={{ padding: "12px", borderRadius: 10, background: W.bg, border: `1px solid ${rec ? W.accent : W.border}`, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <span style={{ fontSize: 18 }}>{ic}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>Alex_Chen_Vercel_{fmt}</div>
                    <div style={{ fontSize: 10, color: W.textDim }}>{sub}</div>
                  </div>
                  {rec && <Pill label={rec} color={W.accent} />}
                </div>
              ))}
            </div>
            <Btn label="⬇ Download .docx" primary style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: "10px" }} />
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Diff Preview</Label>
            <div style={{ fontSize: 11, color: W.textDim, marginBottom: 10 }}>Changed bullets highlighted</div>
            {[
              { old: "Built fast React components for e-commerce", new: "Built Edge Runtime-optimized React components achieving 98/100 Core Web Vitals score" },
              { old: "Worked on performance improvements", new: "Led TypeScript migration and performance optimization reducing bundle size by 40%" },
            ].map((d, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px 6px 0 0", fontSize: 10.5, color: "#EF4444" }}>− {d.old}</div>
                <div style={{ padding: "6px 10px", background: "rgba(62,207,142,0.08)", border: "1px solid rgba(62,207,142,0.2)", borderRadius: "0 0 6px 6px", fontSize: 10.5, color: W.success }}>+ {d.new}</div>
              </div>
            ))}
          </WFCard>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn label="Mark Applied ✓" primary style={{ flex: 1, justifyContent: "center" }} />
            <Btn label="Re-run Agent" style={{ flex: 1, justifyContent: "center" }} />
          </div>
        </div>
      </div>
    </AppShell>
  ),

  // ── 12. MASTER RESUME ─────────────────────────────────────────────
  resume: () => (
    <AppShell active="resume" title="Master Resume" subtitle="Base document for all tailored versions"
      actions={<><Btn label="📤 Replace File" small /><Btn label="✓ Save Changes" primary small /></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
        <WFCard style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <Title size={16}>Alex Chen</Title>
            <Btn label="Edit Section" small />
          </div>
          <Subtitle style={{ marginBottom: 20 }}>Senior Frontend Engineer · San Francisco · alex@email.com · linkedin.com/in/alexchen</Subtitle>
          {[
            { section: "Summary", content: "Senior engineer with 7 years building high-performance web applications..." },
            { section: "Experience" },
            { section: "Skills" },
            { section: "Education" },
          ].map((s, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: W.accent }}>{s.section}</div>
                <Btn label="✏️ Edit" small />
              </div>
              {s.content
                ? <div style={{ fontSize: 11, color: W.textMid, lineHeight: 1.7 }}>{s.content}</div>
                : Array(i === 1 ? 4 : i === 2 ? 2 : 1).fill(0).map((_, j) => (
                  <div key={j} style={{ display: "flex", gap: 8, marginBottom: 8, padding: "10px 12px", background: W.bg, borderRadius: 8, border: `1px solid ${W.border}` }}>
                    <div style={{ width: 4, background: W.accent, borderRadius: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 8, background: W.borderLight, borderRadius: 3, marginBottom: 5, width: "60%" }} />
                      <div style={{ height: 7, background: W.border, borderRadius: 3, width: "90%" }} />
                    </div>
                  </div>
                ))
              }
              <Divider style={{ marginTop: 8 }} />
            </div>
          ))}
        </WFCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Resume Health</Label>
            {[["ATS Score","87/100",W.success],["Keyword Density","Medium",W.warn],["Bullet Strength","High",W.success],["Length","1.8 pages",W.accent]].map(([l,v,c])=>(
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${W.border}` }}>
                <span style={{ fontSize: 11, color: W.textDim }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{v}</span>
              </div>
            ))}
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 12 }}>Version History</Label>
            {[["v4","Current","Feb 28"],["v3","Pre-Anthropic","Feb 24"],["v2","Q4 Update","Jan 15"]].map(([v,l,d])=>(
              <div key={v} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${W.border}`, alignItems: "center" }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: v==="v4" ? W.accentDim : W.bg, border: `1px solid ${v==="v4" ? W.accent : W.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: v==="v4" ? W.accent : W.textDim }}>{v}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 600, color: W.text }}>{l}</div><div style={{ fontSize: 10, color: W.textDim }}>{d}</div></div>
                <Btn label="Restore" small />
              </div>
            ))}
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 10 }}>Tailored Copies (5)</Label>
            {["Vercel","Anthropic","Linear","Figma","Stripe"].map(c=>(
              <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${W.border}`, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: W.textMid }}>{c}</span>
                <Btn label="⬇" small />
              </div>
            ))}
          </WFCard>
        </div>
      </div>
    </AppShell>
  ),

  // ── 13. INGESTION CONTROL ─────────────────────────────────────────
  ingestion: () => (
    <AppShell active="ingestion" title="Ingestion Control" subtitle="Configure & monitor job discovery"
      actions={<Btn label="⚡ Run Now" primary />}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Ingestion Schedule</Label>
          {["Every 3h","Every 6h ✓","Every 12h","Daily"].map(f=>(
            <div key={f} style={{ padding: "9px 12px", borderRadius: 9, background: f.includes("✓") ? W.accentDim : W.bg, border: `1px solid ${f.includes("✓") ? W.accent : W.border}`, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${f.includes("✓") ? W.accent : W.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {f.includes("✓") && <div style={{ width: 6, height: 6, borderRadius: "50%", background: W.accent }} />}
              </div>
              <span style={{ fontSize: 12, color: f.includes("✓") ? W.accent : W.textMid }}>{f.replace(" ✓","")}</span>
            </div>
          ))}
        </WFCard>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Data Sources</Label>
          {[["JSearch API","Active","Primary",true],["Apify Actor","Paused","Fallback",false],["LinkedIn API","Not configured","—",false]].map(([n,s,r,a])=>(
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${W.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: a ? W.success : W.textDim, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>{n}</div>
                <div style={{ fontSize: 10, color: W.textDim }}>{s} · {r}</div>
              </div>
              <Btn label={a ? "Config" : "Connect"} small />
            </div>
          ))}
        </WFCard>
      </div>
      <WFCard style={{ marginBottom: 16 }}>
        <Label style={{ marginBottom: 14 }}>Ingestion Run History</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            {time:"Today 14:00",fetched:47,passed:18,new:12,status:"success"},
            {time:"Today 08:00",fetched:52,passed:21,new:7,status:"success"},
            {time:"Yesterday 20:00",fetched:38,passed:14,new:5,status:"success"},
            {time:"Yesterday 14:00",fetched:0,passed:0,new:0,status:"error"},
            {time:"Yesterday 08:00",fetched:61,passed:24,new:9,status:"success"},
          ].map((r,i)=>(
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: W.bg, borderRadius: 9, border: `1px solid ${W.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.status==="success" ? W.success : W.danger, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: W.textMid, minWidth: 130 }}>{r.time}</span>
              {r.status==="success" ? <>
                <Pill label={`${r.fetched} fetched`} color={W.textDim} />
                <Pill label={`${r.passed} passed`} color={W.accent} />
                <Pill label={`+${r.new} new`} color={W.success} />
              </> : <Pill label="API Error — timeout" color={W.danger} />}
              <Btn label="Details" small style={{ marginLeft: "auto" }} />
            </div>
          ))}
        </div>
      </WFCard>
      <WFCard>
        <Label style={{ marginBottom: 14 }}>Filter Configuration</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div><Label style={{ marginBottom: 8 }}>Minimum Score Threshold</Label>
            <Input placeholder="75" style={{ fontFamily: "monospace" }} />
          </div>
          <div><Label style={{ marginBottom: 8 }}>Max Jobs per Run</Label>
            <Input placeholder="50" style={{ fontFamily: "monospace" }} />
          </div>
          <div><Label style={{ marginBottom: 8 }}>Dedup Window</Label>
            <Input placeholder="30 days" style={{ fontFamily: "monospace" }} />
          </div>
        </div>
      </WFCard>
    </AppShell>
  ),

  // ── 14. ANALYTICS ─────────────────────────────────────────────────
  analytics: () => (
    <AppShell active="analytics" title="Analytics & Insights" subtitle="Last 30 days · Feb 2026">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        {[{v:"247",l:"Total Discovered",c:W.accent},{v:"89",l:"Passed Filter",c:W.purple},{v:"34",l:"Resumes Tailored",c:W.warn},{v:"12",l:"Applications Sent",c:W.success}].map(s=>(
          <WFCard key={s.l}><Label style={{ marginBottom: 8 }}>{s.l}</Label><div style={{ fontSize: 32, fontWeight: 800, color: s.c }}>{s.v}</div></WFCard>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Applications Over Time</Label>
          <div style={{ height: 140, display: "flex", alignItems: "flex-end", gap: 4, paddingTop: 10 }}>
            {[30,45,20,60,80,50,70,90,40,55,75,85,30,65,95,45,70,50,80,60,75,55,90,65,80,45,70,85,60,95].map((h,i)=>(
              <div key={i} style={{ flex: 1, height: `${h}%`, background: i > 25 ? W.accent : W.border, borderRadius: "3px 3px 0 0", opacity: 0.8 }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: W.textDim }}>Feb 1</span>
            <span style={{ fontSize: 10, color: W.textDim }}>Feb 28</span>
          </div>
        </WFCard>
        <WFCard>
          <Label style={{ marginBottom: 14 }}>Score Distribution</Label>
          {[["90–100","8 jobs",W.success,30],["80–89","24 jobs",W.accent,60],["75–79","57 jobs",W.warn,100]].map(([r,v,c,w])=>(
            <div key={r} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: W.textMid }}>{r}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{v}</span>
              </div>
              <div style={{ height: 5, background: W.bg, borderRadius: 3 }}>
                <div style={{ height: 5, width: `${w}%`, background: c, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </WFCard>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <WFCard>
          <Label style={{ marginBottom: 12 }}>Top Companies Matched</Label>
          {[["Vercel","8"],["Anthropic","6"],["Stripe","5"],["Linear","4"],["Figma","4"]].map(([c,n])=>(
            <div key={c} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${W.border}` }}>
              <span style={{ fontSize: 12, color: W.textMid }}>{c}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: W.text }}>{n}</span>
            </div>
          ))}
        </WFCard>
        <WFCard>
          <Label style={{ marginBottom: 12 }}>Keyword Gap Analysis</Label>
          {[["Edge Runtime","Injected 12×",W.warn],["RLHF","Injected 5×",W.warn],["Kubernetes","Skipped",W.textDim],["WebGL","Injected 3×",W.accent],["GraphQL","Injected 8×",W.accent]].map(([k,v,c])=>(
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${W.border}` }}>
              <span style={{ fontSize: 11, color: W.textMid }}>{k}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: c }}>{v}</span>
            </div>
          ))}
        </WFCard>
        <WFCard>
          <Label style={{ marginBottom: 12 }}>Pipeline Conversion</Label>
          {[["Ingested → Filtered","36%",W.accent],["Filtered → Reviewed","78%",W.purple],["Reviewed → Tailored","62%",W.warn],["Tailored → Applied","35%",W.success]].map(([l,v,c])=>(
            <div key={l} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 10.5, color: W.textDim }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{v}</span>
              </div>
              <div style={{ height: 4, background: W.bg, borderRadius: 2 }}>
                <div style={{ height: 4, width: v, background: c, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </WFCard>
      </div>
    </AppShell>
  ),

  // ── 15. SETTINGS ─────────────────────────────────────────────────
  settings: () => (
    <AppShell active="settings" title="Settings" subtitle="Manage your account and pipeline configuration">
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[["⚙️","General",true],["🤖","AI Models",false],["🔑","API Keys",false],["📧","Email Alerts",false],["🔒","Security",false],["🗑️","Data & Privacy",false]].map(([ic,l,a])=>(
            <div key={l} style={{ padding: "9px 12px", borderRadius: 9, background: a ? W.accentDim : "none", border: a ? `1px solid ${W.accentBorder}` : "1px solid transparent", cursor: "pointer", display: "flex", gap: 9, alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>{ic}</span>
              <span style={{ fontSize: 13, fontWeight: a ? 600 : 400, color: a ? W.accent : W.textMid }}>{l}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <Title size={14} style={{ marginBottom: 16 }}>General Settings</Title>
            {[["Default LLM Model (Filtering)","Gemini 1.5 Flash"],["Default LLM Model (Tailoring)","Claude 3.7 Sonnet"],["Output Format","DOCX (Recommended)"],["Timezone","America/Los_Angeles"],["Language","English (US)"]].map(([l,v])=>(
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${W.border}` }}>
                <span style={{ fontSize: 13, color: W.text }}>{l}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: W.textMid }}>{v}</span>
                  <Btn label="Change" small />
                </div>
              </div>
            ))}
          </WFCard>
          <WFCard>
            <Title size={14} style={{ marginBottom: 16 }}>Notifications</Title>
            {[["New high-scoring job (≥85)",true],["Ingestion run complete",true],["Resume tailoring done",true],["Weekly pipeline summary",false],["Application reminders",false]].map(([l,on])=>(
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${W.border}` }}>
                <span style={{ fontSize: 13, color: W.text }}>{l}</span>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: on ? W.accent : W.bg, border: `1px solid ${on ? W.accent : W.border}`, position: "relative" }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: on ? 19 : 3, transition: "left 0.2s" }} />
                </div>
              </div>
            ))}
          </WFCard>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn label="Save Changes" primary />
            <Btn label="Reset Defaults" />
          </div>
        </div>
      </div>
    </AppShell>
  ),

  // ── 16. PROFILE ──────────────────────────────────────────────────
  profile: () => (
    <AppShell active="profile" title="User Profile" subtitle="Personal details & preferences">
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard style={{ textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: `linear-gradient(135deg,${W.accent},${W.purple})`, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>AC</div>
            <Title size={16} style={{ marginBottom: 4 }}>Alex Chen</Title>
            <Subtitle>Senior Frontend Engineer</Subtitle>
            <Divider style={{ margin: "14px 0" }} />
            <Btn label="Upload Photo" style={{ width: "100%", justifyContent: "center" }} />
          </WFCard>
          <WFCard>
            <Label style={{ marginBottom: 10 }}>Quick Stats</Label>
            {[["Jobs Applied","12"],["Resumes Tailored","34"],["Avg Match Score","83"],["Member Since","Jan 2026"]].map(([l,v])=>(
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${W.border}` }}>
                <span style={{ fontSize: 11, color: W.textDim }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: W.text }}>{v}</span>
              </div>
            ))}
          </WFCard>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WFCard>
            <Title size={14} style={{ marginBottom: 16 }}>Personal Information</Title>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[["First Name","Alex"],["Last Name","Chen"],["Email","alex@email.com"],["Phone","+1 415 555 0101"],["Current Title","Senior Frontend Engineer"],["Location","San Francisco, CA"]].map(([l,v])=>(
                <div key={l}><Label style={{ marginBottom: 5 }}>{l}</Label><Input placeholder={v} /></div>
              ))}
            </div>
          </WFCard>
          <WFCard>
            <Title size={14} style={{ marginBottom: 16 }}>Job Search Preferences</Title>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><Label style={{ marginBottom: 6 }}>Target Roles</Label><Input placeholder="Senior Frontend, Staff Engineer, Frontend Architect" /></div>
              <div><Label style={{ marginBottom: 6 }}>Target Companies (optional)</Label><Input placeholder="Vercel, Anthropic, Linear, Stripe..." /></div>
              <div><Label style={{ marginBottom: 6 }}>Blocklist (skip these companies)</Label><Input placeholder="ExampleCorp, OtherCo..." /></div>
            </div>
          </WFCard>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn label="Save Profile" primary />
            <Btn label="Cancel" />
          </div>
        </div>
      </div>
    </AppShell>
  ),

  // ── 17. BILLING ──────────────────────────────────────────────────
  billing: () => (
    <AppShell active="billing" title="Billing & Plan" subtitle="Manage your subscription">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[
          {plan:"Free",price:"$0",features:["10 jobs/month","Basic filtering","Manual tailoring"],current:false,cta:"Current Plan"},
          {plan:"Pro",price:"$19/mo",features:["Unlimited jobs","AI filtering","Auto tailoring","Priority support"],current:true,cta:"Current Plan"},
          {plan:"Team",price:"$49/mo",features:["5 users","Shared pipelines","API access","Custom models"],current:false,cta:"Upgrade"},
        ].map(p=>(
          <WFCard key={p.plan} style={{ border: p.current ? `2px solid ${W.accent}` : `1px solid ${W.border}`, position: "relative" }}>
            {p.current && <div style={{ position: "absolute", top: -1, right: 16, background: W.accent, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: "0 0 8px 8px" }}>CURRENT</div>}
            <Title size={18} style={{ marginBottom: 4 }}>{p.plan}</Title>
            <div style={{ fontSize: 24, fontWeight: 900, color: p.current ? W.accent : W.text, marginBottom: 16 }}>{p.price}</div>
            {p.features.map(f=>(
              <div key={f} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <span style={{ color: W.success, fontSize: 12 }}>✓</span>
                <span style={{ fontSize: 12, color: W.textMid }}>{f}</span>
              </div>
            ))}
            <Btn label={p.cta} primary={!p.current} style={{ width: "100%", justifyContent: "center", marginTop: 16, opacity: p.current ? 0.5 : 1 }} />
          </WFCard>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <WFCard>
          <Title size={14} style={{ marginBottom: 14 }}>Payment Method</Title>
          <div style={{ padding: "12px 16px", background: W.bg, borderRadius: 10, border: `1px solid ${W.border}`, display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div style={{ width: 40, height: 26, background: "#1A1FE8", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 800 }}>VISA</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: W.text }}>•••• •••• •••• 4242</div>
              <div style={{ fontSize: 10, color: W.textDim }}>Expires 12/27</div>
            </div>
            <Btn label="Change" small style={{ marginLeft: "auto" }} />
          </div>
          <Btn label="+ Add Payment Method" style={{ width: "100%", justifyContent: "center" }} />
        </WFCard>
        <WFCard>
          <Title size={14} style={{ marginBottom: 14 }}>Usage This Month</Title>
          {[["Jobs Ingested","247 / ∞"],["Tailoring Runs","34 / ∞"],["LLM Tokens Used","1.2M / ∞"],["API Calls","892 / ∞"]].map(([l,v])=>(
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${W.border}` }}>
              <span style={{ fontSize: 12, color: W.textMid }}>{l}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: W.text }}>{v}</span>
            </div>
          ))}
        </WFCard>
      </div>
    </AppShell>
  ),

  // ── 18. NOTIFICATIONS ─────────────────────────────────────────────
  notifications: () => (
    <AppShell active="notifications" title="Notifications" subtitle="2 unread"
      actions={<Btn label="Mark All Read" small />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
        {[
          {icon:"✨",title:"Resume tailored for Vercel",desc:"8 bullets rewritten, 6 keywords injected. Ready to download.",time:"2h ago",read:false,color:W.accent},
          {icon:"🎯",title:"New high match: Staff Eng @ Anthropic",desc:"Score: 88/100 — 'LangGraph' and 'FastAPI' match your resume directly.",time:"5h ago",read:false,color:W.success},
          {icon:"📥",title:"Ingestion complete",desc:"47 jobs fetched · 18 passed filter · 12 new this run.",time:"6h ago",read:true,color:W.textDim},
          {icon:"✅",title:"Application marked: Full Stack @ Linear",desc:"You applied manually. Status updated to Applied.",time:"1d ago",read:true,color:W.success},
          {icon:"⚠️",title:"Ingestion run failed",desc:"JSearch API timeout. Will retry in 30 minutes.",time:"2d ago",read:true,color:W.warn},
          {icon:"📊",title:"Weekly summary: Feb 22–28",desc:"12 jobs reviewed · 5 tailored · 2 applied. Avg score: 83.",time:"3d ago",read:true,color:W.purple},
        ].map((n,i)=>(
          <WFCard key={i} style={{ display: "flex", gap: 14, opacity: n.read ? 0.65 : 1, borderColor: !n.read ? n.color + "30" : W.border, background: !n.read ? n.color + "08" : W.surface }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: n.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{n.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: W.text }}>{n.title} {!n.read && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: n.color, marginLeft: 5 }} />}</div>
                <span style={{ fontSize: 10, color: W.textDim }}>{n.time}</span>
              </div>
              <div style={{ fontSize: 12, color: W.textMid }}>{n.desc}</div>
            </div>
          </WFCard>
        ))}
      </div>
    </AppShell>
  ),

  // ── 19. EMPTY STATE ───────────────────────────────────────────────
  empty: () => (
    <AppShell active="jobs" title="Job Pipeline" subtitle="No jobs yet">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70%", textAlign: "center" }}>
        <div style={{ width: 80, height: 80, borderRadius: 20, background: W.accentDim, border: `1px solid ${W.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 24 }}>📭</div>
        <Title size={22} style={{ marginBottom: 10 }}>No jobs in your pipeline yet</Title>
        <Subtitle style={{ maxWidth: 380, marginBottom: 32 }}>Run your first ingestion to discover matching jobs. Your preferences are configured and ready to go.</Subtitle>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn label="⚡ Run First Ingestion" primary style={{ padding: "12px 24px", fontSize: 14 }} />
          <Btn label="Configure Preferences" style={{ padding: "12px 24px", fontSize: 14 }} />
        </div>
        <div style={{ marginTop: 40, display: "flex", gap: 8 }}>
          <WFCard style={{ width: 160, textAlign: "center" }}><div style={{ fontSize: 20, marginBottom: 6 }}>⚙️</div><div style={{ fontSize: 11, color: W.textMid }}>Preferences configured</div></WFCard>
          <WFCard style={{ width: 160, textAlign: "center" }}><div style={{ fontSize: 20, marginBottom: 6 }}>📄</div><div style={{ fontSize: 11, color: W.textMid }}>Master resume uploaded</div></WFCard>
          <WFCard style={{ width: 160, textAlign: "center", borderColor: W.accentBorder, background: W.accentDim }}><div style={{ fontSize: 20, marginBottom: 6 }}>⚡</div><div style={{ fontSize: 11, color: W.accent }}>Ready to ingest!</div></WFCard>
        </div>
      </div>
    </AppShell>
  ),

  // ── 20. ERROR / 404 ───────────────────────────────────────────────
  error: () => (
    <div style={{ background: W.bg, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 72, marginBottom: 20, opacity: 0.3 }}>404</div>
      <Title size={28} style={{ marginBottom: 10 }}>Page not found</Title>
      <Subtitle style={{ maxWidth: 360, marginBottom: 32 }}>The page you're looking for doesn't exist or has been moved. Let's get you back on track.</Subtitle>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn label="← Go Back" />
        <Btn label="Go to Dashboard" primary style={{ padding: "10px 24px" }} />
      </div>
      <WFCard style={{ marginTop: 48, padding: "20px 28px" }}>
        <Label style={{ marginBottom: 12 }}>Helpful links</Label>
        <div style={{ display: "flex", gap: 20 }}>
          {["Dashboard","Job Pipeline","Ingestion","Settings"].map(l=>(
            <span key={l} style={{ fontSize: 13, color: W.accent, cursor: "pointer" }}>{l}</span>
          ))}
        </div>
      </WFCard>
    </div>
  ),
};

// ═══════════════════════════════════════════════════════════════════
// MAIN WIREFRAME VIEWER
// ═══════════════════════════════════════════════════════════════════

export default function WireframeViewer() {
  const [active, setActive] = useState("landing");
  const [sideOpen, setSideOpen] = useState(true);

  const groups = [...new Set(ALL_SCREENS.map(s => s.group))];
  const current = ALL_SCREENS.find(s => s.id === active);
  const ScreenComponent = screens[active];

  return (
    <div style={{ display: "flex", height: "100vh", background: "#050505", fontFamily: "'DM Sans', system-ui, sans-serif", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      {/* Screen Navigator */}
      {sideOpen && (
        <div style={{ width: 240, background: "#0A0A0A", borderRight: "1px solid #1A1A1A", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #1A1A1A" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#666", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Wireframe System</div>
            <div style={{ fontSize: 10, color: "#444" }}>AI Job Commander · {ALL_SCREENS.length} Screens</div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "8px 8px" }}>
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 4 }}>
                <div style={{ padding: "6px 8px 4px", fontSize: 9, fontWeight: 700, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase" }}>{group}</div>
                {ALL_SCREENS.filter(s => s.group === group).map(screen => (
                  <button key={screen.id} onClick={() => setActive(screen.id)} style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8,
                    background: active === screen.id ? "rgba(107,107,255,0.15)" : "none",
                    border: active === screen.id ? "1px solid rgba(107,107,255,0.3)" : "1px solid transparent",
                    cursor: "pointer", textAlign: "left",
                  }}>
                    <span style={{ fontSize: 13 }}>{screen.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: active === screen.id ? 600 : 400, color: active === screen.id ? "#6B6BFF" : "#666" }}>{screen.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid #1A1A1A" }}>
            <div style={{ fontSize: 10, color: "#333" }}>Click any screen to preview</div>
          </div>
        </div>
      )}

      {/* Main Preview */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ height: 44, background: "#0A0A0A", borderBottom: "1px solid #1A1A1A", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", flexShrink: 0 }}>
          <button onClick={() => setSideOpen(!sideOpen)} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 6, color: "#666", cursor: "pointer", padding: "4px 8px", fontSize: 12 }}>{sideOpen ? "◀" : "▶"}</button>
          <div style={{ width: 1, height: 20, background: "#1A1A1A" }} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#555" }}>{current?.group}</span>
            <span style={{ fontSize: 13, color: "#333" }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#aaa" }}>{current?.label}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {(() => {
              const idx = ALL_SCREENS.findIndex(s => s.id === active);
              return <>
                <button onClick={() => idx > 0 && setActive(ALL_SCREENS[idx-1].id)} disabled={idx === 0} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 6, color: "#666", cursor: "pointer", padding: "4px 10px", fontSize: 12, opacity: idx === 0 ? 0.3 : 1 }}>←</button>
                <span style={{ fontSize: 11, color: "#333", padding: "4px 6px", lineHeight: "20px" }}>{idx+1} / {ALL_SCREENS.length}</span>
                <button onClick={() => idx < ALL_SCREENS.length-1 && setActive(ALL_SCREENS[idx+1].id)} disabled={idx === ALL_SCREENS.length-1} style={{ background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 6, color: "#666", cursor: "pointer", padding: "4px 10px", fontSize: 12, opacity: idx === ALL_SCREENS.length-1 ? 0.3 : 1 }}>→</button>
              </>;
            })()}
          </div>
        </div>

        {/* Screen Frame */}
        <div style={{ flex: 1, overflow: "auto", padding: 20, background: "#050505" }}>
          <div style={{ width: "100%", height: "100%", minHeight: 600, background: W.bg, borderRadius: 12, border: "1px solid #1A1A1A", overflow: "hidden", boxShadow: "0 0 0 1px #111, 0 24px 80px rgba(0,0,0,0.8)" }}>
            {ScreenComponent ? <ScreenComponent /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444" }}>Screen not found</div>}
          </div>
        </div>
      </div>
    </div>
  );
}