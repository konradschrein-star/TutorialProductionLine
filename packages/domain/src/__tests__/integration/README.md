# Integration Tests

This directory contains end-to-end integration tests for full pipeline flows.

## Purpose

Integration tests verify that multiple system components work together correctly across the full video production pipeline.

Unlike unit tests (which test individual functions in isolation), integration tests:
- Test complete workflows (IDEA_GENERATION → RENDERING)
- Verify state machine transitions
- Test queue orchestration
- Validate multi-step business logic

## Test Structure

Each test file should:
1. Set up necessary infrastructure (test database, test queues)
2. Execute a complete workflow
3. Assert final state and side effects
4. Clean up resources

## Example Tests to Add

- `full-pipeline.test.ts` - Complete IDEA_GENERATION through RENDERING flow
- `state-machine.test.ts` - All valid state transitions
- `failure-recovery.test.ts` - How system handles failures at each stage
- `queue-retry.test.ts` - Queue retry behavior under transient failures
- `concurrent-jobs.test.ts` - Multiple jobs processing simultaneously

## Running Integration Tests

```bash
# Run all integration tests
pnpm test:integration

# Run specific integration test
pnpm vitest run packages/domain/src/__tests__/integration/full-pipeline.test.ts
```

## Best Practices

1. **Use test fixtures** - Create reusable test data factories
2. **Isolate tests** - Each test should be independent
3. **Clean up** - Always tear down test resources
4. **Use real dependencies** - Don't mock databases/queues (use test instances)
5. **Test happy path AND failures** - Both success and error cases

## Adding New Tests

When adding a new format or pipeline stage:
1. Add integration test covering the new path
2. Verify state transitions work correctly
3. Test error handling for the new stage
