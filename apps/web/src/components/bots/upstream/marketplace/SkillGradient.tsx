/* oxlint-disable shadcn/no-unknown-classes -- Original SkillGradient selectors are supplied by source CSS. */
import { useEffect, useRef } from "react";
import type { ShaderMount } from "@paper-design/shaders";
import { articleGradient, articleGradientCss, articleGradientUniforms } from "./article-gradient";

function mountSkillGradientShader(element: HTMLDivElement, name: string) {
  if (!window.matchMedia || !window.IntersectionObserver) return;
  const profile = articleGradient(name);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let mount: ShaderMount | undefined;
  let visible = false;
  let disposed = false;
  let generation = 0;
  let failed = false;
  const stop = () => {
    generation++;
    mount?.dispose();
    mount = undefined;
  };
  const update = async () => {
    if (disposed || !visible || document.hidden || reducedMotion.matches) {
      stop();
      return;
    }
    if (mount || failed) return;
    const attempt = ++generation;
    try {
      const { ShaderMount, getShaderColorFromString, meshGradientFragmentShader } =
        await import("@paper-design/shaders");
      if (disposed || attempt !== generation) return;
      mount = new ShaderMount(
        element,
        meshGradientFragmentShader,
        articleGradientUniforms(profile, getShaderColorFromString),
        undefined,
        0.6,
        profile.frame,
      );
    } catch {
      failed = true;
      stop();
    }
  };
  const refresh = () => {
    void update();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    refresh();
  });
  observer.observe(element);
  reducedMotion.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", refresh);
  const contextLost = () => {
    failed = true;
    stop();
  };
  element.addEventListener("webglcontextlost", contextLost, true);
  return () => {
    disposed = true;
    stop();
    observer.disconnect();
    reducedMotion.removeEventListener("change", refresh);
    document.removeEventListener("visibilitychange", refresh);
    element.removeEventListener("webglcontextlost", contextLost, true);
  };
}

export function SkillGradient({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Original shader mounts only while visible, disposes for reduced motion or background windows, and retains its CSS fallback.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    return mountSkillGradientShader(element, name);
  }, [name]);
  return (
    <div
      ref={host}
      className="skill-preview-gradient"
      aria-hidden="true"
      style={{ background: articleGradientCss(articleGradient(name)) }}
    />
  );
}
