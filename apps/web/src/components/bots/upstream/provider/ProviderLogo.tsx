import { isAgentProvider } from "./identity";
import { providerLogoShape } from "./provider-logo-shape";
/** Exact upstream geometry; a newer host's provider uses the neutral mark. */
export function ProviderLogo({ provider, className }: { provider: string; className?: string }) {
  const shape = providerLogoShape(isAgentProvider(provider) ? provider : "unknown");
  return (
    <svg viewBox={shape.viewBox} className={className} aria-hidden="true" fill="currentColor">
      {shape.paths.map((path) => (
        <path
          key={path.d}
          d={path.d}
          opacity={path.opacity}
          fillRule={path.evenOdd ? "evenodd" : undefined}
          clipRule={path.evenOdd ? "evenodd" : undefined}
        />
      ))}
    </svg>
  );
}
