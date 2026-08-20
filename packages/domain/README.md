# @repo/domain

Pure business logic for the content job state machine. This package contains zero side effects—no IO, no database calls, no HTTP requests, no filesystem access.

## Purpose

Implement core business rules for:
- State transition validation (legal moves only)
- Available transitions query (UI dropdown support)
- Pause/resume logic
- Terminal state detection
- Failure state categorization

## Public API

### State Transition Functions

```typescript
import { transitionJob, getAvailableTransitions } from "@repo/domain";

// Validate a transition
const result = transitionJob(
  "SCRIPTING",           // current status
  "TRANSLATING",         // target status
  null                   // paused_from_status (only needed when resuming from PAUSED)
);

if (result.success) {
  console.log("Transition allowed:", result.value);
} else {
  console.error("Transition denied:", result.error.message);
}

// Get available next states
const availableStates = getAvailableTransitions(
  "SCRIPTING",
  null
);
// Returns: ["TRANSLATING", "PAUSED", "FAILED_GENERAL", "MARKED_FOR_DELETION"]
```

### Transition Rules (Read-Only)

```typescript
import { TRANSITION_MAP, TERMINAL_STATES, FAILURE_STATES, PAUSABLE_STATES } from "@repo/domain";

// Check if a state is terminal
if (TERMINAL_STATES.includes(job.status)) {
  console.log("Job is in terminal state, no further processing");
}

// Check if a state is a failure state
if (FAILURE_STATES.includes(job.status)) {
  console.log("Job failed, requires manual intervention");
}

// Check if a state can be paused
if (PAUSABLE_STATES.includes(job.status)) {
  console.log("Job can be paused");
}
```

### State Queries

```typescript
import { isTerminalState, isFailureState, isPausableState } from "@repo/domain";

if (isTerminalState("PUBLISHED")) {
  // true
}

if (isFailureState("FAILED_RENDER")) {
  // true
}

if (isPausableState("SCRIPTING")) {
  // true
}
```

## Directory Structure

```
src/
  state-machine/
    transition-rules.ts   # TRANSITION_MAP and state category constants
    transitions.ts        # Pure transition validation logic
    state-queries.ts      # Helper functions for state inspection

  errors/
    transition-error.ts   # TransitionError class
    index.ts              # Barrel export for all errors

  index.ts                # Public API surface (barrel export)
```

## Dependencies

None (zero dependencies by design)

## Design Philosophy

### Functional Core, Imperative Shell

This package is the **functional core**:
- Pure functions only
- No side effects
- Deterministic (same inputs → same outputs)
- Easy to test (no mocking needed)
- Easy to reason about

The **imperative shell** lives in apps:
- Database reads/writes
- Queue dispatch
- External API calls
- Logging

### Result<T, E> Pattern

Instead of throwing exceptions, functions return `Result<T, E>`:

```typescript
type Result<T, E> =
  | { success: true; value: T }
  | { success: false; error: E };
```

**Benefits:**
- Explicit error handling (compiler enforces checks)
- No hidden control flow (no try/catch needed)
- Easier to test error paths
- Better composability

## State Machine Rules

### Forward Progress

The state machine is designed for forward progress through the pipeline:

```
IDEA_GENERATION → SCRIPTING → TRANSLATING → ASSET_COLLECTION
→ AWAITING_PRODUCTION_VA → QMS_VALIDATING → ROUTING_RENDER
→ (RENDERING_FFMPEG | RENDERING_REMOTION) → AWAITING_QC
→ AWAITING_UPLOADER → UPLOADING → PUBLISHED
```

### Rejection Loops

Quality gates allow backward transitions:

- `AWAITING_PRODUCTION_VA` → `SCRIPTING` (VA rejects script)
- `AWAITING_PRODUCTION_VA` → `ASSET_COLLECTION` (VA rejects assets)
- `AWAITING_QC` → `ROUTING_RENDER` (QC rejects video, re-render)
- `AWAITING_UPLOADER` → `AWAITING_QC` (Uploader finds issue before upload)

### Failure Recovery

All failure states support recovery paths:

- `FAILED_QMS` → `QMS_VALIDATING` (retry validation)
- `FAILED_QMS` → `ASSET_COLLECTION` (regenerate assets)
- `FAILED_RENDER` → `ROUTING_RENDER` (retry render)
- `FAILED_UPLOAD` → `UPLOADING` (retry upload)
- `FAILED_GENERAL` → `IDEA_GENERATION` (restart pipeline)

All failure states also allow:
- `FAILED_*` → `MARKED_FOR_DELETION` (give up, clean up assets)

### Pause/Resume

Jobs can be paused from most states (see `PAUSABLE_STATES`):

```typescript
// Pause from SCRIPTING
transitionJob("SCRIPTING", "PAUSED", null);
// Stores: status = "PAUSED", paused_from_status = "SCRIPTING"

// Resume to SCRIPTING
transitionJob("PAUSED", "SCRIPTING", "SCRIPTING");
// Validates: targetStatus matches paused_from_status
```

**Not pausable:**
- Terminal states: `PUBLISHED`, `DELETED`, `CANCELLED`
- Failure states: `FAILED_QMS`, `FAILED_RENDER`, `FAILED_UPLOAD`, `FAILED_GENERAL`
- Already paused: `PAUSED`

### Terminal States

Three terminal states (no further transitions allowed):

- `PUBLISHED` — Job successfully completed and published to YouTube
- `DELETED` — Job permanently deleted (R2 assets cleaned up)
- `CANCELLED` — Job manually cancelled by operator

**Exception:** `PUBLISHED` and `CANCELLED` can transition to `MARKED_FOR_DELETION` for cleanup.

## Usage Examples

### Validate Transition Before Database Update

```typescript
import { transitionJob } from "@repo/domain";
import { updateJobStatus } from "./utils/update-job-status.js";

// Validate transition first
const result = transitionJob(job.status, "TRANSLATING", job.paused_from_status);

if (!result.success) {
  console.error("Invalid transition:", result.error.message);
  throw result.error;
}

// Only update database if transition is legal
await updateJobStatus(db, job.id, result.value);
```

### UI Dropdown for Next States

```typescript
import { getAvailableTransitions } from "@repo/domain";

// In Hub UI server function
const availableStates = getAvailableTransitions(
  job.status,
  job.paused_from_status
);

// Render dropdown
return (
  <select>
    {availableStates.map(state => (
      <option key={state} value={state}>{state}</option>
    ))}
  </select>
);
```

### Check if Job is in Terminal State

```typescript
import { isTerminalState } from "@repo/domain";

if (isTerminalState(job.status)) {
  console.log("Job is complete, no further processing needed");
  return;
}

// Continue processing
```

## Testing

Pure functions are trivial to test:

```typescript
import { transitionJob } from "@repo/domain";

describe("transitionJob", () => {
  it("allows SCRIPTING → TRANSLATING", () => {
    const result = transitionJob("SCRIPTING", "TRANSLATING", null);
    expect(result.success).toBe(true);
    expect(result.value).toBe("TRANSLATING");
  });

  it("denies SCRIPTING → PUBLISHED", () => {
    const result = transitionJob("SCRIPTING", "PUBLISHED", null);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain("Transition not allowed");
  });

  it("allows pausing from SCRIPTING", () => {
    const result = transitionJob("SCRIPTING", "PAUSED", null);
    expect(result.success).toBe(true);
  });

  it("requires paused_from_status when resuming from PAUSED", () => {
    const result = transitionJob("PAUSED", "SCRIPTING", null);
    expect(result.success).toBe(false);
    expect(result.error.message).toContain("Cannot resume without paused_from_status");
  });
});
```

No mocking needed. No database. No Redis. Just pure logic.

## Design Decisions

**Why no database access?**
- Keeps business logic testable
- Prevents tight coupling to persistence layer
- Makes logic reusable across different data stores
- Faster tests (no database setup)

**Why Result<T, E> instead of exceptions?**
- Explicit error handling (compiler enforces)
- No hidden control flow
- Better composability
- Easier to test error paths

**Why a map-based TRANSITION_MAP instead of switch statements?**
- Declarative (easier to read and understand)
- O(1) lookups
- Single source of truth for all transition rules
- Easy to audit completeness
