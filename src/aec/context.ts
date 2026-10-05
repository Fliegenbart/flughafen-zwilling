import { createContext, useContext } from "react";
import type { Route } from "./routes";

export type Nav = {
  basePath: string;
  route: Route;
  navigate: (route: Route, options?: { replace?: boolean }) => void;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("NavContext fehlt");
  return nav;
}
