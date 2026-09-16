# Check-in delivery fix (2026-09-16)

The kiosk previously displayed completion and incremented its counter before the server acknowledged a save. Its outbox could automatically repeat a POST after a lost response, although the deployed Apps Script's durable scanId idempotency has not been verified.

This change:

- Shows completion and plays the chime only after an explicit successful server response.
- Displays totals returned by the server, without optimistic increments.
- Stores unsent work before POST, serializes delivery, and applies a 20-second timeout.
- Preserves uncertain requests after a timeout, interruption, reload, or legacy deduplication response. These requests require checking the original scan log before marking recorded or resending.
- Continues processing unrelated visitors while an uncertain request awaits reconciliation.
- Prevents overlapping submissions on the scanner test page; its local test mode remains the default.

## Validation

`node --test tests/checkin-delivery.test.js` passes 9 tests covering delayed acknowledgement, concurrent flushes, interrupted replies, reload recovery, offline delivery, legacy queue migration, duplicate responses, manual reconciliation, and unavailable storage. JavaScript syntax checks pass.

The tests use fake storage and responses. They do not write to production. Physical iPad camera/audio and the deployed Apps Script integration still need an operator smoke test before deployment.

## Operator procedure

1. A green completion screen means the server returned a successful save response.
2. An amber screen or “미확인” counter requires attention. Open “미확인” and match the QR suffix, timestamp and count against the original scan log.
3. If the record exists, choose “시트에서 기록 확인”. Only choose “미기록 확인 후 재전송” after verifying it is absent.
4. Do not clear browser storage while there are unresolved items. Do not open multiple kiosk tabs on one device.

## Scope and remaining work

This branch does not change the Apps Script backend, spreadsheet formulas, or historical attendance records. A successful response is evidence from the server; durable exactly-once delivery ultimately requires server-side scanId storage and lookup. Current dashboard totals may still count repeated QR scans. Existing dashboard aggregation must be reviewed against the event's intended counting rule before it can be changed safely.

Deployment must include index.html, kiosk.js and checkin-delivery.js together. To roll back, restore the previous versions of these frontend files. Retain unresolved outbox data for operator review.
