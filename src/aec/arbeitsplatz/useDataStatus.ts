/** Wie viele der vier Datenquellen eines Projekts belegt sind (fuer Kopfzeile und PDF-Seite). */
import { useEffect, useState } from "react";
import { loadDataInputs } from "../api/data";
import { computeDataStatus, EMPTY_INPUTS, type DataStatus } from "../model/dataStatus";
import type { Project } from "../types";

export function useDataStatus(project: Project | null): DataStatus | null {
  const [status, setStatus] = useState<DataStatus | null>(null);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    loadDataInputs(project)
      .catch(() => EMPTY_INPUTS)
      .then((inputs) => alive && setStatus(computeDataStatus(inputs)));
    return () => {
      alive = false;
    };
  }, [project]);
  return status;
}
