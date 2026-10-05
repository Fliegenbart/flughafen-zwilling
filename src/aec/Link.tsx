import type { MouseEvent, ReactNode } from "react";
import { useNav } from "./context";
import { href, type Route } from "./routes";

/** Echter Link (neuer Tab, Kopieren) mit clientseitiger Navigation. */
export default function Link({
  to,
  children,
  className,
  current,
  label,
}: {
  to: Route;
  children: ReactNode;
  className?: string;
  current?: "page" | "step";
  label?: string;
}) {
  const nav = useNav();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    nav.navigate(to);
  };
  return (
    <a
      href={href(nav.basePath, to)}
      onClick={onClick}
      className={className}
      aria-current={current}
      aria-label={label}
    >
      {children}
    </a>
  );
}
