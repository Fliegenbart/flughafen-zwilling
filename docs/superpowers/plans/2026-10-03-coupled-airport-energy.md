# Coupled Airport Energy Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. Tests first;
> keep the full product goal in `docs/PRODUCT_READINESS.md` open after this milestone.

**Goal:** Implement the requested causal flight-plan/vehicle/energy coupling,
with technical evidence and a usable German decision cockpit. This milestone
does not redefine commercial readiness as a successful simulation.

**Architecture:** Add `airport_coupled_v1` next to existing domains. Generate
immutable missions from a manually selected schedule and explicit fleet assumptions.
A one-minute SIL engine shares vehicle states, charger ports and campus energy
balance, so charging actually changes subsequent mission readiness. Two policies
run through the existing serial recovery-safe worker with the same world hash.

**Tech Stack:** Existing Python/Pydantic/FastAPI, React/TypeScript/Recharts,
local JSON worker, pytest/Vitest, Docker; no new cloud/hardware infrastructure.

## Locked modelling decisions

- Bus, baggage tractor, pushback tug and mobile GPU are configurable hypothetical
  fleets, not claimed FMG assets. Coverage, duration, consumption, start SOC,
  reserves, chargers and efficiency are explicit and bounded.
- No guessed aircraft rotations, passenger counts, gate geometry or actual TOBT.
  Published entry times anchor service windows, not real take-off predictions.
- Unresolved shared-flight groups require explicit independent-entry assumption;
  otherwise reject coupling. Source entry/page/hash survives to mission evidence.
- Horizon includes explicit warmup and drain; initial SOC refers to model start.
  Local/UTC mapping respects service-day length and DST. No hidden midnight reset.
- Baseline: immediate charging/proportional sharing. Demand priority: same
  mission dispatcher, chargers/power prioritize upcoming mission deadlines over
  parking. This is a documented heuristic, not global optimization.
- Ground load and parking share grid/PV/CHP/storage budget. Feeder kVA, assumed
  power factor and transformer efficiencies constrain upstream power. No AC
  load flow, protection, voltage or safe-black-start claim.
- Missions consume battery energy and make vehicles unavailable until return.
  Charging is impossible while occupied; reserve must cover the full mission.
- Delayed and uncompleted tasks count explicitly. Unfinished delays are lower
  bounds, not invented completion times. Model readiness is not flight OTP.
- Timed grid caps and charger outages stress the same coupled world.
- Recommendation/read-only SIL only; live adapters and old Turnaround planner
  reject this domain. No artificial model-day telemetry in live Influx.

## Tasks and checks

### 1. Domain, world and missions
Files: `backend/app/munich/coupled_models.py`, `coupled_world.py`,
`backend/tests/test_coupled_world.py`.
- [x] Tests: `build_world(plan, config, seed)` reproducible; real minute/UTC
  columns, per-kind coverage, shared-group acknowledgement, impossible battery
  mission/reserve, unknown keys, nonfinite numbers, horizon and DST.
- [x] Strict models and bounded defaults; frozen missions/parking jobs and hash.
- [x] Run `pytest tests/test_coupled_world.py -q`; preserve all v1 tests.

### 2. Power balance and dynamic fleet
Files: `coupled_power.py`, `coupled_simulator.py`, `coupled_evidence.py`,
`backend/tests/test_coupled_simulator.py`.
- [x] Hand-calculated tests: one vehicle/two missions, depleted SOC blocks
  dispatch, charging enables later work, resource shortage versus energy wait.
- [x] Conservation tests for vehicles/storage/transformers; no simultaneous
  mission/charge or overlapping assignments, physical limits for both policies.
- [x] Controlled counterexample: absent energy worsens deadlines; sufficient
  energy never creates a fake resource bottleneck; unserved work stays visible.
- [x] Typed per-mission/entry evidence, aggregate series, five-minute fleet trace,
  checksummed JSON/CSV result bundle. No huge fleet trace in summary payload.
- [x] Run all coupled tests and existing Munich simulator tests.

### 3. Worker/API/report integration
Files: `backend/app/models.py`, `deterministic.py`, `run_service.py`,
`reporting.py`, `main.py`, `munich/coupled_router.py`, `coupled_integration.py`.
- [x] Failing API tests before new route: reference defaults, create pair,
  completed runs, frozen world and source, CSV/JSON/PDF, mutation rejection.
- [x] Strict validation on queue and execution; domain whitelist and SIL guard.
- [x] Existing RunWorker, restart recovery, explicit artifact whitelist/hashes;
  failures remain failed, no hardware or Influx writes.
- [x] Default model criteria cover energy balance, reserves and unfinished/
  late tasks, not fabricated nominal electricity fields or real OTP.
- [x] Run full backend suite, Ruff and archive verifier.

### 4. Coupled decision cockpit
Files: `src/munich/CoupledPanel.tsx`, `.css`, `coupledTypes.ts`,
`CoupledPanel.test.tsx`, `MunichPilot.tsx`.
- [x] UI tests first: requires selected plan and acknowledgement, explicit
  fleet/power parameters, two-run polling, baseline/priority/deltas, causes,
  model-readiness labels, evidence/downloads and error states.
- [x] Additive panel driven by selected immutable plan; no change to old runs.
- [x] Causal chain, power/SOC/queues and task table linked to source flight;
  mobile sizing and reduced motion follow existing design.
- [x] Lint/typecheck/Vitest/root and `/airport/` builds. Browser manual selection/compare,
  selected flight trace, HTML download/content and 1440/390px smoke. Local
  file preview is blocked by browser policy, not claimed as visually tested.

### 5. Release and still-open product gates
Files: `docs/MUNICH_COUPLED.md`, `docs/PRODUCT_READINESS.md`, existing pilot
docs, `scripts/smoke_coupled.py`.
- [x] Evidence ledger: technical proof, assumptions, empirical gaps and scope.
- [x] Actual imported day smoke, isolated no-hardware tests, existing 8 Airport,
  Munich-v1 and FlexLab regressions. Commit/push and verify remote SHA/CI.
- [x] Deploy only verified release to protected demo after own-volume backup;
  verify HTTPS pipeline, UI bundle, access guard and existing apps untouched.
- [x] Keep overarching goal active: real-data validation, customer acceptance,
  economic decision contract and enterprise operation still need proof.
