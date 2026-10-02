#!/usr/bin/env python3
from __future__ import annotations

import sys

from airport_turnaround_stability_runs import main as airport_main


def main() -> int:
    print(
        "DEPRECATED: gate_a_sim_runs.py has been replaced by "
        "airport_turnaround_stability_runs.py. Running airport stability workflow now."
    )
    return airport_main()


if __name__ == "__main__":
    sys.exit(main())
