import type { SVGProps } from "react";
import { APP_MARK_URL } from "../branding";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <image href={APP_MARK_URL} width="64" height="64" />
    </svg>
  );
}
