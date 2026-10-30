"use client";

import GlassSurface from "./GlassSurface";
import type { ReactNode } from "react";

export default function Surface({ children, className = "", radius = 24 }: { children: ReactNode; className?: string; radius?: number }) {
  return <GlassSurface width="100%" height="auto" borderRadius={radius} distortionScale={-140} displace={0.45} backgroundOpacity={0.05} saturation={1.15} className={`surface ${className}`}>{children}</GlassSurface>;
}
