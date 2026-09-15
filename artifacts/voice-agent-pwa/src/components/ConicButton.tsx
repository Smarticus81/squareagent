import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `pill` hugs its label; `disc` is a fixed circle for an icon-only action. */
  shape?: "pill" | "disc";
  size?: "md" | "sm";
  /** Full-width pill. */
  block?: boolean;
  /** Keeps the ring spinning and the halo lit without hover (live states). */
  live?: boolean;
};

/**
 * Primary control: a black disc/pill with white content, wrapped in a
 * conic-gradient ring. On hover, press, or `live` the ring rotates and a
 * blurred halo of the same gradient fades in. Presentation only — every
 * button attribute (onClick, disabled, type, aria-*) passes straight through.
 */
export function ConicButton({
  shape = "pill",
  size = "md",
  block = false,
  live = false,
  className = "",
  children,
  ...rest
}: Props) {
  const cls = [
    "conic-btn",
    shape === "disc" ? "conic-disc" : "conic-pill",
    size === "sm" ? "conic-sm" : "",
    block ? "conic-block" : "",
    live ? "is-live" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type="button" {...rest} className={cls}>
      <span className="conic-halo" aria-hidden="true" />
      <span className="conic-ring" aria-hidden="true" />
      <span className="conic-disc-face">{children}</span>
    </button>
  );
}
