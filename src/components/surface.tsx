"use client";

import GlassSurface from "./GlassSurface";
import type { ReactNode } from "react";

export default function Surface({ children, className = "", radius = 24 }: { children: ReactNode; className?: string; radius?: number }) {
  return <GlassSurface width="100%" height="auto" borderRadius={radius} refraction={false} backgroundOpacity={0.05} saturation={1.05} className={`surface ${className}`}>{children}</GlassSurface>;
}

export function GlassControl({ children, stretch = false }: { children: ReactNode; stretch?: boolean }) {
  return <GlassSurface width={stretch ? "100%" : "auto"} height="auto" borderRadius={12} distortionScale={-85} displace={0.15} backgroundOpacity={0.025} saturation={1.1} className={`control-glass ${stretch ? "control-glass-wide" : ""}`}>{children}</GlassSurface>;
}
