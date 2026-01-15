# HandScript Comprehensive Test Plan

## Document Overview

This test plan defines all tests required to verify HandScript functionality before and after production deployment. Tests are organized by category, priority, and environment (local/staging/production).

**Test Notation:**

- 🔴 **Critical** - Must pass before deployment
- 🟡 **Important** - Should pass, may deploy with known issues
- 🟢 **Nice-to-have** - Enhances confidence but not blocking

**Environment Tags:**

- `[LOCAL]` - Run on local development
- `[STAGING]` - Run on staging/preview deployment
- `[PROD]` - Safe to run on production
- `[DESTRUCTIVE]` - Modifies data, use caution

---

## Table of Contents

1. [Environment & Configuration Tests](#1-environment--configuration-tests)
2. [Unit Tests](#2-unit-tests)
3. [API Route Integration Tests](#3-api-route-integration-tests)
4. [External Service Integration Tests](#4-external-service-integration-tests)
5. [End-to-End Workflow Tests](#5-end-to-end-workflow-tests)
6. [Error Handling & Recovery Tests](#6-error-handling--recovery-tests)
7. [Edge Cases & Boundary Tests](#7-edge-cases--boundary-tests)
8. [Performance & Load Tests](#8-performance--load-tests)
9. [Security Tests](#9-security-tests)
10. [Production Smoke Tests](#10-production-smoke-tests)
11. [Chaos Engineering Tests](#11-chaos-engineering-tests)
12. [Regression Tests](#12-regression-tests)

---


## 3. API Route Integration Tests

### 3.1 POST /api/get-upload-url

| ID          | Test Name                    | Priority  | Environment       | Description                               |
| ----------- | ---------------------------- | --------- | ----------------- | ----------------------------------------- |
| API-UPL-001 | 🔴 Returns upload URL        | Critical  | [LOCAL] [STAGING] | Valid request returns uploadUrl           |
| API-UPL-002 | 🔴 Missing key rejected      | Critical  | [LOCAL]           | Request without key returns 400           |
| API-UPL-003 | 🔴 Invalid key type rejected | Critical  | [LOCAL]           | Non-string key returns 400                |
| API-UPL-004 | 🟡 URL is usable for PUT     | Important | [LOCAL] [STAGING] | Returned URL accepts PUT with file        |
| API-UPL-005 | 🟡 Content-Type respected    | Important | [LOCAL]           | Different contentType creates correct URL |
| API-UPL-006 | 🟡 URL expires after 1 hour  | Important | [LOCAL]           | URL becomes invalid after 3600s           |
| API-UPL-007 | 🔴 B2 credentials error      | Critical  | [LOCAL]           | Invalid B2 creds return 500               |

**Test Procedures:**

**API-UPL-001: Returns upload URL**

```
Request: POST /api/get-upload-url
Body: { "key": "test/file.png", "contentType": "image/png" }
Expected: 200 OK, body contains { uploadUrl: "https://..." }
Validation: uploadUrl starts with B2 endpoint domain
```

**API-UPL-004: URL is usable for PUT**

```
Steps:
1. POST /api/get-upload-url with key and contentType
2. PUT to returned uploadUrl with test file content
3. Verify PUT returns 200
4. Cleanup: DELETE the uploaded file
```

### 3.2 POST /api/jobs

| ID          | Test Name                        | Priority  | Environment       | Description                               |
| ----------- | -------------------------------- | --------- | ----------------- | ----------------------------------------- |
| API-JOB-001 | 🔴 Creates job successfully      | Critical  | [LOCAL] [STAGING] | Valid request creates job, returns jobId  |
| API-JOB-002 | 🔴 Job stored in Redis           | Critical  | [LOCAL] [STAGING] | Created job retrievable from Redis        |
| API-JOB-003 | 🔴 QStash triggered              | Critical  | [STAGING]         | QStash publish called for process-batch   |
| API-JOB-004 | 🔴 Page count mismatch rejected  | Critical  | [LOCAL]           | pageCount !== manifest.length returns 400 |
| API-JOB-005 | 🔴 Zero pages rejected           | Critical  | [LOCAL]           | pageCount: 0 returns 400                  |
| API-JOB-006 | 🔴 Exceeds 200 pages rejected    | Critical  | [LOCAL]           | pageCount > 200 returns 400               |
| API-JOB-007 | 🟡 Email stored in job           | Important | [LOCAL]           | Email field saved to Redis job            |
| API-JOB-008 | 🟡 Missing email accepted        | Important | [LOCAL]           | Job created without email field           |
| API-JOB-009 | 🟡 Invalid email format rejected | Important | [LOCAL]           | Malformed email returns 400               |
| API-JOB-010 | 🔴 Estimated time returned       | Critical  | [LOCAL]           | Response includes estimatedTime           |
| API-JOB-011 | 🟡 Job has 30-day expiry         | Important | [LOCAL]           | Redis TTL set correctly                   |
| API-JOB-012 | 🔴 Invalid JSON body             | Critical  | [LOCAL]           | Malformed JSON returns 400                |
| API-JOB-013 | 🟡 Empty manifest rejected       | Important | [LOCAL]           | Empty pageManifest array returns 400      |

**Test Procedures:**

**API-JOB-001: Creates job successfully**

```
Preconditions: 5 test images uploaded to B2
Request: POST /api/jobs
Body: { "pageCount": 5, "pageManifest": ["key1", "key2", ...], "email": "test@example.com" }
Expected: 200 OK
Body: { "jobId": "string", "status": "processing", "estimatedTime": number }
Validation: jobId is non-empty string
```

**API-JOB-003: QStash triggered**

```
Preconditions: Mock QStash or check logs
Steps:
1. POST /api/jobs with valid data
2. Verify QStash.publishJSON was called
3. Verify URL contains /api/internal/process-batch
4. Verify body contains jobId, batchIndex: 0, manifest
```

### 3.3 GET /api/jobs/[jobId]/status

| ID          | Test Name                             | Priority  | Environment              | Description                                    |
| ----------- | ------------------------------------- | --------- | ------------------------ | ---------------------------------------------- |
| API-STS-001 | 🔴 Returns job status                 | Critical  | [LOCAL] [STAGING] [PROD] | Existing job returns status object             |
| API-STS-002 | 🔴 Non-existent job returns 404       | Critical  | [LOCAL] [STAGING]        | Invalid jobId returns 404                      |
| API-STS-003 | 🔴 Progress object included           | Critical  | [LOCAL]                  | Response has progress.total, completed, failed |
| API-STS-004 | 🔴 Complete job has finalPdfUrl       | Critical  | [LOCAL] [STAGING]        | Completed job includes download URL            |
| API-STS-005 | 🟡 Failed job has error               | Important | [LOCAL]                  | Failed job includes error message              |
| API-STS-006 | 🟡 Logs array included                | Important | [LOCAL]                  | Response includes logs array                   |
| API-STS-007 | 🟡 Cache headers set                  | Important | [STAGING]                | Response has Cache-Control header              |
| API-STS-008 | 🔴 Progress updates during processing | Critical  | [LOCAL] [STAGING]        | completedPages increases over time             |

**Test Procedures:**

**API-STS-001: Returns job status**

```
Preconditions: Job exists in Redis with known jobId
Request: GET /api/jobs/{jobId}/status
Expected: 200 OK
Body: {
  "status": "processing|complete|failed",
  "progress": { "total": n, "completed": m, "failed": f },
  "logs": [...],
  "finalPdfUrl": "..." (if complete)
}
```

### 3.4 POST /api/internal/process-batch

| ID          | Test Name                           | Priority  | Environment       | Description                                 |
| ----------- | ----------------------------------- | --------- | ----------------- | ------------------------------------------- |
| API-BAT-001 | 🔴 Processes batch successfully     | Critical  | [LOCAL] [STAGING] | Valid batch returns success                 |
| API-BAT-002 | 🔴 QStash signature verified (prod) | Critical  | [STAGING] [PROD]  | Unsigned request rejected in production     |
| API-BAT-003 | 🔴 Stores results in Redis          | Critical  | [LOCAL]           | Page HTML stored at job:id:page:n keys      |
| API-BAT-004 | 🔴 Increments completed counter     | Critical  | [LOCAL]           | job:id:completed incremented                |
| API-BAT-005 | 🔴 Triggers next batch              | Critical  | [LOCAL] [STAGING] | QStash called with batchIndex + 1           |
| API-BAT-006 | 🔴 Final batch triggers finalize    | Critical  | [LOCAL] [STAGING] | Last batch publishes to finalize endpoint   |
| API-BAT-007 | 🔴 Empty keys triggers finalize     | Critical  | [LOCAL]           | batchIndex beyond manifest goes to finalize |
| API-BAT-008 | 🟡 Logs written to Redis            | Important | [LOCAL]           | job:id:logs updated                         |
| API-BAT-009 | 🔴 Gemini failure returns 500       | Critical  | [LOCAL]           | Gemini error causes retry via 500           |
| API-BAT-010 | 🟡 Max retries sends error email    | Important | [STAGING]         | After 3 retries, error email queued         |
| API-BAT-011 | 🔴 Signed URLs generated correctly  | Critical  | [LOCAL]           | B2 signed URLs are valid for Gemini         |
| API-BAT-012 | 🟡 BATCH_SIZE of 5 respected        | Important | [LOCAL]           | Only 5 images processed per call            |

**Test Procedures:**

**API-BAT-001: Processes batch successfully**

```
Preconditions: Job exists, 5 test images uploaded, QStash verification bypassed (local)
Request: POST /api/internal/process-batch
Body: { "jobId": "...", "batchIndex": 0, "manifest": ["key1", ..., "key5"] }
Expected: 200 OK, { "success": true, "processed": 5 }
Validation: Redis has keys job:{id}:page:0 through job:{id}:page:4
```

### 3.5 POST /api/jobs/[jobId]/finalize

| ID          | Test Name                            | Priority  | Environment       | Description                               |
| ----------- | ------------------------------------ | --------- | ----------------- | ----------------------------------------- |
| API-FIN-001 | 🔴 Generates merged PDF              | Critical  | [LOCAL] [STAGING] | Complete job produces valid PDF           |
| API-FIN-002 | 🔴 PDF uploaded to B2                | Critical  | [LOCAL] [STAGING] | outputs/{jobId}.pdf exists in B2          |
| API-FIN-003 | 🔴 Job status updated to complete    | Critical  | [LOCAL]           | Redis job.status = 'complete'             |
| API-FIN-004 | 🔴 Download URL returned             | Critical  | [LOCAL] [STAGING] | Response includes pdfUrl                  |
| API-FIN-005 | 🔴 Email queued if provided          | Critical  | [STAGING]         | QStash called for send-email              |
| API-FIN-006 | 🔴 Non-existent job returns 404      | Critical  | [LOCAL]           | Invalid jobId returns 404                 |
| API-FIN-007 | 🟡 Missing pages handled             | Important | [LOCAL]           | Null pages get placeholder HTML           |
| API-FIN-008 | 🟡 Modal failure fallback            | Important | [LOCAL]           | Failed Modal render uses pdf-lib fallback |
| API-FIN-009 | 🟡 Input images cleaned up           | Important | [LOCAL] [STAGING] | pageManifest files deleted after success  |
| API-FIN-010 | 🔴 Failed finalize sends error email | Critical  | [STAGING]         | Error triggers queueErrorEmail            |
| API-FIN-011 | 🟡 Logs completion time              | Important | [LOCAL]           | durationMs logged                         |
| API-FIN-012 | 🔴 All pages fetched atomically      | Critical  | [LOCAL]           | Single MGET for all pages                 |

### 3.6 POST /api/send-email

| ID          | Test Name                           | Priority  | Environment      | Description                        |
| ----------- | ----------------------------------- | --------- | ---------------- | ---------------------------------- |
| API-EML-001 | 🔴 Sends email successfully         | Critical  | [STAGING]        | Valid payload sends via Resend     |
| API-EML-002 | 🔴 QStash signature verified (prod) | Critical  | [STAGING] [PROD] | Unsigned rejected                  |
| API-EML-003 | 🔴 Missing fields rejected          | Critical  | [LOCAL]          | Missing jobId/email returns 400    |
| API-EML-004 | 🟡 Fresh PDF URL generated          | Important | [LOCAL]          | Uses pdfKey to regenerate URL      |
| API-EML-005 | 🟡 Job emailStatus updated          | Important | [LOCAL]          | Redis job has emailStatus: 'sent'  |
| API-EML-006 | 🟡 emailSentAt timestamp set        | Important | [LOCAL]          | Timestamp recorded                 |
| API-EML-007 | 🟡 Mock mode works                  | Important | [LOCAL]          | Missing RESEND_API_KEY logs mock   |
| API-EML-008 | 🔴 Resend error returns 500         | Critical  | [STAGING]        | API error returns 500 with message |

### 3.7 POST /api/send-error-email

| ID          | Test Name                    | Priority  | Environment      | Description                        |
| ----------- | ---------------------------- | --------- | ---------------- | ---------------------------------- |
| API-ERR-001 | 🔴 Sends error email         | Critical  | [STAGING]        | Error notification sent to user    |
| API-ERR-002 | 🔴 Error message included    | Critical  | [LOCAL]          | Custom error message in email body |
| API-ERR-003 | 🟡 Job error status recorded | Important | [LOCAL]          | errorEmailSent: true in Redis      |
| API-ERR-004 | 🔴 QStash signature verified | Critical  | [STAGING] [PROD] | Unsigned rejected                  |

### 3.8 GET /api/cron/cleanup

| ID          | Test Name                      | Priority  | Environment              | Description                           |
| ----------- | ------------------------------ | --------- | ------------------------ | ------------------------------------- |
| API-CRN-001 | 🔴 Unauthorized without secret | Critical  | [LOCAL] [STAGING] [PROD] | Missing/wrong auth returns 401        |
| API-CRN-002 | 🔴 Deletes old input files     | Critical  | [STAGING] [DESTRUCTIVE]  | inputs/ files > 1hr deleted           |
| API-CRN-003 | 🔴 Deletes old output files    | Critical  | [STAGING] [DESTRUCTIVE]  | outputs/ files > 1hr deleted          |
| API-CRN-004 | 🟡 Returns deletion count      | Important | [LOCAL]                  | Response includes deletedCount        |
| API-CRN-005 | 🟡 Ignores recent files        | Important | [LOCAL]                  | Files < 1hr old not deleted           |
| API-CRN-006 | 🟡 Handles empty bucket        | Important | [LOCAL]                  | No files returns success with count 0 |

---

## 4. External Service Integration Tests

### 4.1 Gemini AI Integration

| ID          | Test Name                     | Priority  | Environment       | Description                                |
| ----------- | ----------------------------- | --------- | ----------------- | ------------------------------------------ |
| EXT-GEM-001 | 🔴 Simple image transcription | Critical  | [LOCAL] [STAGING] | Single clear handwriting image transcribed |
| EXT-GEM-002 | 🔴 Math content extraction    | Critical  | [LOCAL]           | Image with equations produces math blocks  |
| EXT-GEM-003 | 🔴 Multi-page batch           | Critical  | [LOCAL]           | 5 images processed in single call          |
| EXT-GEM-004 | 🟡 Complex diagram handling   | Important | [LOCAL]           | Diagram described correctly                |
| EXT-GEM-005 | 🟡 Illegible text handling    | Important | [LOCAL]           | [UNCLEAR] markers used appropriately       |
| EXT-GEM-006 | 🟡 Empty/blank page           | Important | [LOCAL]           | Blank page produces minimal content        |
| EXT-GEM-007 | 🔴 Model availability         | Critical  | [STAGING] [PROD]  | gemini-2.5-flash model accessible          |
| EXT-GEM-008 | 🟡 Rate limit recovery        | Important | [LOCAL]           | 429 response handled gracefully            |
| EXT-GEM-009 | 🔴 Signed URL fetch           | Critical  | [STAGING]         | Gemini can fetch B2 signed URLs            |
| EXT-GEM-010 | 🟡 Response size limits       | Important | [LOCAL]           | Large content doesn't exceed limits        |

### 4.2 Backblaze B2 Integration

| ID         | Test Name                  | Priority  | Environment       | Description                       |
| ---------- | -------------------------- | --------- | ----------------- | --------------------------------- |
| EXT-B2-001 | 🔴 Upload file             | Critical  | [LOCAL] [STAGING] | File uploads successfully         |
| EXT-B2-002 | 🔴 Download file           | Critical  | [LOCAL] [STAGING] | Uploaded file downloadable        |
| EXT-B2-003 | 🔴 Delete file             | Critical  | [LOCAL] [STAGING] | File deleted successfully         |
| EXT-B2-004 | 🔴 Pre-signed upload URL   | Critical  | [LOCAL] [STAGING] | Generated URL works for PUT       |
| EXT-B2-005 | 🔴 Pre-signed download URL | Critical  | [LOCAL] [STAGING] | Generated URL works for GET       |
| EXT-B2-006 | 🟡 URL expiration          | Important | [LOCAL]           | URLs expire after specified time  |
| EXT-B2-007 | 🟡 Large file upload       | Important | [LOCAL]           | 10MB file uploads successfully    |
| EXT-B2-008 | 🟡 List files              | Important | [LOCAL]           | Files listable with pagination    |
| EXT-B2-009 | 🔴 Content-Type preserved  | Critical  | [LOCAL]           | Uploaded content-type matches     |
| EXT-B2-010 | 🟡 Concurrent uploads      | Important | [LOCAL]           | Multiple parallel uploads succeed |

### 4.3 Upstash Redis Integration

| ID          | Test Name                | Priority  | Environment       | Description                         |
| ----------- | ------------------------ | --------- | ----------------- | ----------------------------------- |
| EXT-RED-001 | 🔴 SET and GET           | Critical  | [LOCAL] [STAGING] | Basic operations work               |
| EXT-RED-002 | 🔴 MSET and MGET         | Critical  | [LOCAL]           | Batch operations work               |
| EXT-RED-003 | 🔴 EXPIRE                | Critical  | [LOCAL]           | TTL set correctly                   |
| EXT-RED-004 | 🔴 INCRBY                | Critical  | [LOCAL]           | Counter increment works             |
| EXT-RED-005 | 🔴 LPUSH and LRANGE      | Critical  | [LOCAL]           | List operations work                |
| EXT-RED-006 | 🟡 JSON object storage   | Important | [LOCAL]           | Complex objects serialize correctly |
| EXT-RED-007 | 🟡 Concurrent access     | Important | [LOCAL]           | Multiple parallel writes succeed    |
| EXT-RED-008 | 🔴 Connection under load | Critical  | [STAGING]         | High request rate doesn't fail      |

### 4.4 Upstash QStash Integration

| ID          | Test Name                     | Priority  | Environment | Description                         |
| ----------- | ----------------------------- | --------- | ----------- | ----------------------------------- |
| EXT-QST-001 | 🔴 Publish message            | Critical  | [STAGING]   | Message published successfully      |
| EXT-QST-002 | 🔴 Message delivered          | Critical  | [STAGING]   | Endpoint receives message           |
| EXT-QST-003 | 🔴 Retry on failure           | Critical  | [STAGING]   | 500 response triggers retry         |
| EXT-QST-004 | 🔴 Signature verification     | Critical  | [STAGING]   | Valid signature passes verification |
| EXT-QST-005 | 🟡 Invalid signature rejected | Important | [STAGING]   | Tampered request rejected           |
| EXT-QST-006 | 🟡 Message ordering           | Important | [STAGING]   | Sequential messages maintain order  |

### 4.5 Modal PDF Service Integration

| ID          | Test Name                  | Priority  | Environment       | Description                        |
| ----------- | -------------------------- | --------- | ----------------- | ---------------------------------- |
| EXT-MOD-001 | 🔴 Simple HTML to PDF      | Critical  | [LOCAL] [STAGING] | Basic HTML renders to valid PDF    |
| EXT-MOD-002 | 🔴 KaTeX rendering         | Critical  | [LOCAL]           | Math formulas render in PDF        |
| EXT-MOD-003 | 🟡 Complex tables          | Important | [LOCAL]           | Multi-column tables render         |
| EXT-MOD-004 | 🟡 CSS styling applied     | Important | [LOCAL]           | Academic CSS visible in PDF        |
| EXT-MOD-005 | 🔴 B2 direct upload        | Critical  | [STAGING]         | Modal uploads directly to B2       |
| EXT-MOD-006 | 🟡 Large HTML handling     | Important | [LOCAL]           | 100KB HTML renders                 |
| EXT-MOD-007 | 🔴 Response within timeout | Critical  | [STAGING]         | Response in < 25 seconds           |
| EXT-MOD-008 | 🟡 Error response format   | Important | [LOCAL]           | Error returns { error: "message" } |

### 4.6 Resend Email Integration

| ID          | Test Name                  | Priority  | Environment | Description                     |
| ----------- | -------------------------- | --------- | ----------- | ------------------------------- |
| EXT-RSN-001 | 🔴 Send basic email        | Critical  | [STAGING]   | Email delivered to inbox        |
| EXT-RSN-002 | 🟡 HTML email rendering    | Important | [STAGING]   | HTML content displays correctly |
| EXT-RSN-003 | 🔴 Download link clickable | Critical  | [STAGING]   | PDF URL in email works          |
| EXT-RSN-004 | 🟡 Sender address correct  | Important | [STAGING]   | From address matches EMAIL_FROM |
| EXT-RSN-005 | 🟡 Email ID returned       | Important | [LOCAL]     | Response includes email ID      |
| EXT-RSN-006 | 🟡 Rate limiting handled   | Important | [LOCAL]     | 429 response handled            |

---

## 5. End-to-End Workflow Tests

### 5.1 Happy Path - Complete Workflow

| ID      | Test Name                       | Priority  | Environment       | Description                             |
| ------- | ------------------------------- | --------- | ----------------- | --------------------------------------- |
| E2E-001 | 🔴 Single page PDF conversion   | Critical  | [LOCAL] [STAGING] | 1-page PDF → processed → email received |
| E2E-002 | 🔴 Multi-page PDF (5 pages)     | Critical  | [LOCAL] [STAGING] | 5-page PDF → single batch → complete    |
| E2E-003 | 🔴 Multi-batch PDF (15 pages)   | Critical  | [STAGING]         | 15-page PDF → 3 batches → complete      |
| E2E-004 | 🔴 Maximum pages (200)          | Critical  | [STAGING]         | 200-page PDF → 40 batches → complete    |
| E2E-005 | 🔴 PDF download works           | Critical  | [LOCAL] [STAGING] | Downloaded PDF is valid                 |
| E2E-006 | 🔴 Email delivery confirmed     | Critical  | [STAGING]         | Email received in inbox                 |
| E2E-007 | 🟡 Progress updates accurate    | Important | [LOCAL] [STAGING] | Status endpoint shows correct progress  |
| E2E-008 | 🟡 Job completes within timeout | Important | [STAGING]         | 10-page PDF completes in < 5 minutes    |

**Test Procedures:**

**E2E-001: Single page PDF conversion**

```
Preconditions: 1-page test PDF with handwritten notes
Steps:
1. Convert PDF to PNG in browser (or use pdftoppm)
2. POST /api/get-upload-url, upload image to B2
3. POST /api/jobs with pageManifest
4. Poll GET /api/jobs/{id}/status every 2s
5. When status === 'complete', fetch finalPdfUrl
6. Download and verify PDF is valid
7. Check email inbox for delivery
Expected:
- Status transitions: processing → complete
- PDF contains transcribed content
- Email arrives within 2 minutes
Total time: < 3 minutes
```

**E2E-003: Multi-batch PDF (15 pages)**

```
Preconditions: 15-page test PDF
Steps:
1. Upload all 15 images to B2
2. Create job with 15-item manifest
3. Monitor status - expect 3 batches (5+5+5)
4. Verify completedPages increases: 0 → 5 → 10 → 15
5. Final PDF has 15 pages
Expected:
- Batch processing visible in logs
- No timeouts during processing
- Complete within 8 minutes
```

### 5.2 Workflow Without Email

| ID      | Test Name                        | Priority  | Environment       | Description                                |
| ------- | -------------------------------- | --------- | ----------------- | ------------------------------------------ |
| E2E-010 | 🔴 No email provided             | Critical  | [LOCAL] [STAGING] | Job completes without email field          |
| E2E-011 | 🔴 Status polling until complete | Critical  | [LOCAL]           | Client can poll and download without email |
| E2E-012 | 🟡 No email queued               | Important | [LOCAL]           | QStash not called for send-email           |

### 5.3 Client-Side Workflow

| ID      | Test Name                   | Priority  | Environment       | Description                              |
| ------- | --------------------------- | --------- | ----------------- | ---------------------------------------- |
| E2E-020 | 🔴 Browser PDF upload       | Critical  | [LOCAL] [STAGING] | Upload.tsx accepts PDF file              |
| E2E-021 | 🔴 Progress bar updates     | Critical  | [LOCAL]           | Upload progress shown correctly          |
| E2E-022 | 🔴 Email validation         | Critical  | [LOCAL]           | Invalid email shows error                |
| E2E-023 | 🔴 Confirmation message     | Critical  | [LOCAL]           | "You're All Set" shown after job created |
| E2E-024 | 🔴 Download button works    | Critical  | [LOCAL] [STAGING] | Download link triggers file save         |
| E2E-025 | 🟡 "Convert Another" resets | Important | [LOCAL]           | Button returns to upload state           |

---

## 6. Error Handling & Recovery Tests

### 6.1 Network Failure Tests

| ID          | Test Name                    | Priority  | Environment | Description                       |
| ----------- | ---------------------------- | --------- | ----------- | --------------------------------- |
| ERR-NET-001 | 🔴 Redis connection failure  | Critical  | [LOCAL]     | Redis unreachable returns 500     |
| ERR-NET-002 | 🔴 B2 upload failure         | Critical  | [LOCAL]     | B2 unreachable returns 500        |
| ERR-NET-003 | 🔴 Gemini API unreachable    | Critical  | [LOCAL]     | Batch returns 500, triggers retry |
| ERR-NET-004 | 🔴 Modal service unreachable | Critical  | [LOCAL]     | Finalize uses fallback PDF        |
| ERR-NET-005 | 🟡 QStash publish failure    | Important | [LOCAL]     | Job created but marked for retry  |
| ERR-NET-006 | 🟡 Resend API unreachable    | Important | [LOCAL]     | Email marked as failed            |

### 6.2 Timeout Tests

| ID          | Test Name                  | Priority  | Environment | Description                       |
| ----------- | -------------------------- | --------- | ----------- | --------------------------------- |
| ERR-TMO-001 | 🔴 Gemini timeout (>25s)   | Critical  | [LOCAL]     | Long Gemini call fails gracefully |
| ERR-TMO-002 | 🔴 Modal timeout (>30s)    | Critical  | [LOCAL]     | Long render falls back            |
| ERR-TMO-003 | 🔴 Vercel function timeout | Critical  | [STAGING]   | 10s limit doesn't crash           |
| ERR-TMO-004 | 🟡 Redis operation timeout | Important | [LOCAL]     | Slow Redis handled                |
| ERR-TMO-005 | 🟡 B2 signed URL expired   | Important | [LOCAL]     | Expired URL detected and reported |

### 6.3 Data Validation Failures

| ID          | Test Name                  | Priority  | Environment | Description                    |
| ----------- | -------------------------- | --------- | ----------- | ------------------------------ |
| ERR-VAL-001 | 🔴 Malformed job request   | Critical  | [LOCAL]     | Zod validation error returned  |
| ERR-VAL-002 | 🔴 Invalid batch payload   | Critical  | [LOCAL]     | process-batch rejects bad data |
| ERR-VAL-003 | 🔴 Corrupt Gemini response | Critical  | [LOCAL]     | Schema validation fails safely |
| ERR-VAL-004 | 🟡 Missing Redis data      | Important | [LOCAL]     | Missing pages use placeholder  |
| ERR-VAL-005 | 🟡 Invalid PDF from Modal  | Important | [LOCAL]     | Corrupt PDF triggers fallback  |

### 6.4 Resource Exhaustion

| ID          | Test Name                   | Priority  | Environment | Description                       |
| ----------- | --------------------------- | --------- | ----------- | --------------------------------- |
| ERR-RES-001 | 🟡 Memory limit (large PDF) | Important | [STAGING]   | 200-page PDF doesn't OOM          |
| ERR-RES-002 | 🟡 Redis rate limiting      | Important | [STAGING]   | High-frequency operations handled |
| ERR-RES-003 | 🟡 Gemini quota exceeded    | Important | [STAGING]   | Quota error identified            |
| ERR-RES-004 | 🟡 B2 storage quota         | Important | [STAGING]   | Upload failure on full bucket     |

### 6.5 Retry Logic Tests

| ID          | Test Name                      | Priority  | Environment | Description                            |
| ----------- | ------------------------------ | --------- | ----------- | -------------------------------------- |
| ERR-RTY-001 | 🔴 QStash retries on 500       | Critical  | [STAGING]   | Failed batch retried automatically     |
| ERR-RTY-002 | 🔴 Max retry limit             | Critical  | [STAGING]   | After 3 retries, error email sent      |
| ERR-RTY-003 | 🟡 Retry count header read     | Important | [LOCAL]     | Upstash-Retried header parsed          |
| ERR-RTY-004 | 🟡 Job marked failed after max | Important | [LOCAL]     | Job status = 'failed' after exhaustion |

### 6.6 Partial Failure Recovery

| ID          | Test Name                         | Priority  | Environment | Description                     |
| ----------- | --------------------------------- | --------- | ----------- | ------------------------------- |
| ERR-PAR-001 | 🔴 One page fails, others succeed | Critical  | [LOCAL]     | 4/5 pages in batch still saved  |
| ERR-PAR-002 | 🔴 One batch fails mid-job        | Critical  | [LOCAL]     | Previous batches preserved      |
| ERR-PAR-003 | 🔴 Finalize with missing pages    | Critical  | [LOCAL]     | PDF generated with placeholders |
| ERR-PAR-004 | 🟡 Modal fails for one page       | Important | [LOCAL]     | Other pages still rendered      |

---

## 7. Edge Cases & Boundary Tests

### 7.1 Input Boundaries

| ID       | Test Name                        | Priority     | Environment | Description             |
| -------- | -------------------------------- | ------------ | ----------- | ----------------------- |
| EDGE-001 | 🔴 Minimum: 1 page               | Critical     | [LOCAL]     | Single page works       |
| EDGE-002 | 🔴 Maximum: 200 pages            | Critical     | [STAGING]   | 200 pages works         |
| EDGE-003 | 🔴 Over maximum: 201 pages       | Critical     | [LOCAL]     | 201 pages rejected      |
| EDGE-004 | 🟡 Zero pages                    | Important    | [LOCAL]     | Empty manifest rejected |
| EDGE-005 | 🟡 Exact batch boundary: 5 pages | Important    | [LOCAL]     | Exactly 1 batch         |
| EDGE-006 | 🟡 Batch boundary + 1: 6 pages   | Important    | [LOCAL]     | 2 batches (5+1)         |
| EDGE-007 | 🟡 Large image (10MB PNG)        | Important    | [LOCAL]     | Handled correctly       |
| EDGE-008 | 🟡 Tiny image (100x100 px)       | Important    | [LOCAL]     | Still processed         |
| EDGE-009 | 🟢 Non-PNG image (JPEG)          | Nice-to-have | [LOCAL]     | Content-type handled    |

### 7.2 Content Edge Cases

| ID       | Test Name                      | Priority     | Environment | Description                |
| -------- | ------------------------------ | ------------ | ----------- | -------------------------- |
| EDGE-020 | 🟡 Blank/white page            | Important    | [LOCAL]     | Produces minimal content   |
| EDGE-021 | 🟡 Full black page             | Important    | [LOCAL]     | Handled gracefully         |
| EDGE-022 | 🟡 Only mathematical equations | Important    | [LOCAL]     | All math blocks            |
| EDGE-023 | 🟡 Only text, no math          | Important    | [LOCAL]     | All paragraph blocks       |
| EDGE-024 | 🟡 Mixed content dense         | Important    | [LOCAL]     | Complex layout transcribed |
| EDGE-025 | 🟡 Non-English text            | Important    | [LOCAL]     | Unicode preserved          |
| EDGE-026 | 🟡 Rotated page                | Important    | [LOCAL]     | Content still extracted    |
| EDGE-027 | 🟢 Very small handwriting      | Nice-to-have | [LOCAL]     | Legible content extracted  |
| EDGE-028 | 🟢 Very messy handwriting      | Nice-to-have | [LOCAL]     | [UNCLEAR] markers used     |

### 7.3 Email Edge Cases

| ID       | Test Name                     | Priority  | Environment | Description               |
| -------- | ----------------------------- | --------- | ----------- | ------------------------- |
| EDGE-040 | 🟡 Very long email address    | Important | [LOCAL]     | 254 char email accepted   |
| EDGE-041 | 🟡 Email with + addressing    | Important | [LOCAL]     | user+tag@domain.com works |
| EDGE-042 | 🟡 International domain email | Important | [LOCAL]     | user@例え.jp handled      |
| EDGE-043 | 🔴 Email without @ rejected   | Critical  | [LOCAL]     | Validation catches        |
| EDGE-044 | 🔴 Email without domain       | Critical  | [LOCAL]     | Validation catches        |

### 7.4 Concurrent Operations

| ID       | Test Name                    | Priority  | Environment | Description                       |
| -------- | ---------------------------- | --------- | ----------- | --------------------------------- |
| EDGE-050 | 🟡 Two jobs same user        | Important | [STAGING]   | Both complete independently       |
| EDGE-051 | 🟡 Rapid job creation        | Important | [STAGING]   | 5 jobs in 10 seconds handled      |
| EDGE-052 | 🟡 Concurrent status polling | Important | [LOCAL]     | Multiple clients polling same job |
| EDGE-053 | 🟡 Parallel batch processing | Important | [LOCAL]     | Multiple batches in flight        |

### 7.5 State Transitions

| ID       | Test Name                        | Priority  | Environment | Description              |
| -------- | -------------------------------- | --------- | ----------- | ------------------------ |
| EDGE-060 | 🔴 Job: processing → complete    | Critical  | [LOCAL]     | Normal completion        |
| EDGE-061 | 🔴 Job: processing → failed      | Critical  | [LOCAL]     | Error path               |
| EDGE-062 | 🟡 Job: stuck in processing      | Important | [LOCAL]     | Timeout detection        |
| EDGE-063 | 🟡 Double finalize call          | Important | [LOCAL]     | Second call idempotent   |
| EDGE-064 | 🟡 Status poll before processing | Important | [LOCAL]     | Returns processing state |

---

## 8. Performance & Load Tests

### 8.1 Latency Tests

| ID       | Test Name                        | Priority  | Environment | Description                   |
| -------- | -------------------------------- | --------- | ----------- | ----------------------------- |
| PERF-001 | 🔴 Upload URL generation < 500ms | Critical  | [STAGING]   | /api/get-upload-url latency   |
| PERF-002 | 🔴 Job creation < 2s             | Critical  | [STAGING]   | /api/jobs latency             |
| PERF-003 | 🔴 Status check < 200ms          | Critical  | [STAGING]   | /api/jobs/{id}/status latency |
| PERF-004 | 🔴 Gemini batch < 30s            | Critical  | [STAGING]   | 5-image batch processing      |
| PERF-005 | 🟡 Single page render < 5s       | Important | [STAGING]   | Modal HTML→PDF                |
| PERF-006 | 🟡 Email send < 3s               | Important | [STAGING]   | Resend API call               |

### 8.2 Throughput Tests

| ID       | Test Name                  | Priority     | Environment | Description           |
| -------- | -------------------------- | ------------ | ----------- | --------------------- |
| PERF-010 | 🟡 10 concurrent uploads   | Important    | [STAGING]   | All uploads succeed   |
| PERF-011 | 🟡 5 concurrent jobs       | Important    | [STAGING]   | All jobs complete     |
| PERF-012 | 🟡 100 status polls/minute | Important    | [STAGING]   | All respond quickly   |
| PERF-013 | 🟢 Sustained processing    | Nice-to-have | [STAGING]   | 30 minutes continuous |

### 8.3 Scalability Tests

| ID       | Test Name                       | Priority     | Environment | Description                  |
| -------- | ------------------------------- | ------------ | ----------- | ---------------------------- |
| PERF-020 | 🟡 200-page PDF completion time | Important    | [STAGING]   | Completes in reasonable time |
| PERF-021 | 🟡 Memory under large PDF       | Important    | [STAGING]   | No OOM errors                |
| PERF-022 | 🟢 Redis key count growth       | Nice-to-have | [STAGING]   | Keys cleaned up              |

---

## 9. Security Tests

### 9.1 Authentication & Authorization

| ID      | Test Name                              | Priority | Environment      | Description                    |
| ------- | -------------------------------------- | -------- | ---------------- | ------------------------------ |
| SEC-001 | 🔴 QStash signature required           | Critical | [STAGING] [PROD] | process-batch rejects unsigned |
| SEC-002 | 🔴 Cron secret required                | Critical | [STAGING] [PROD] | cleanup rejects wrong auth     |
| SEC-003 | 🔴 send-email signature required       | Critical | [STAGING] [PROD] | Rejects unsigned requests      |
| SEC-004 | 🔴 send-error-email signature required | Critical | [STAGING] [PROD] | Rejects unsigned requests      |

### 9.2 Input Validation

| ID      | Test Name                     | Priority  | Environment | Description                  |
| ------- | ----------------------------- | --------- | ----------- | ---------------------------- |
| SEC-010 | 🔴 SQL injection in email     | Critical  | [LOCAL]     | Not vulnerable               |
| SEC-011 | 🔴 XSS in transcribed content | Critical  | [LOCAL]     | HTML escaped in PDF          |
| SEC-012 | 🔴 Path traversal in key      | Critical  | [LOCAL]     | ../../../etc/passwd rejected |
| SEC-013 | 🔴 Oversized request body     | Critical  | [LOCAL]     | Large body rejected          |
| SEC-014 | 🟡 Job ID enumeration         | Important | [LOCAL]     | Can't guess other job IDs    |

### 9.3 Data Protection

| ID      | Test Name                | Priority  | Environment | Description                        |
| ------- | ------------------------ | --------- | ----------- | ---------------------------------- |
| SEC-020 | 🔴 Signed URLs expire    | Critical  | [LOCAL]     | Old URLs become invalid            |
| SEC-021 | 🔴 No credential logging | Critical  | [LOCAL]     | API keys not in logs               |
| SEC-022 | 🟡 Redis data encrypted  | Important | [STAGING]   | TLS connection used                |
| SEC-023 | 🟡 B2 bucket not public  | Important | [STAGING]   | Direct URLs fail without signature |

---

## 10. Production Smoke Tests

These tests should be run after every production deployment.

### 10.1 Critical Path Verification

| ID        | Test Name                | Priority | Environment | Time Limit | Description                   |
| --------- | ------------------------ | -------- | ----------- | ---------- | ----------------------------- |
| SMOKE-001 | 🔴 Homepage loads        | Critical | [PROD]      | 3s         | / returns 200 with content    |
| SMOKE-002 | 🔴 Upload URL endpoint   | Critical | [PROD]      | 1s         | /api/get-upload-url works     |
| SMOKE-003 | 🔴 Job creation works    | Critical | [PROD]      | 5s         | /api/jobs returns jobId       |
| SMOKE-004 | 🔴 Status endpoint works | Critical | [PROD]      | 1s         | /api/jobs/{id}/status returns |
| SMOKE-005 | 🔴 Redis connected       | Critical | [PROD]      | 2s         | Can read/write test key       |
| SMOKE-006 | 🔴 B2 accessible         | Critical | [PROD]      | 5s         | Can generate signed URL       |

### 10.2 End-to-End Smoke Test

| ID        | Test Name                   | Priority | Environment | Time Limit | Description                         |
| --------- | --------------------------- | -------- | ----------- | ---------- | ----------------------------------- |
| SMOKE-010 | 🔴 3-page PDF complete flow | Critical | [PROD]      | 5m         | Upload → Process → Download → Email |

**Smoke Test Procedure:**

```
1. Upload 3 test images
2. Create job with test email
3. Poll status until complete or 5 minute timeout
4. Verify PDF downloadable
5. Verify email received
6. Cleanup test data

Pass Criteria: All steps complete without error
Rollback Trigger: Any step fails
```

### 10.3 Health Check Endpoints

| ID        | Test Name              | Priority  | Environment | Description              |
| --------- | ---------------------- | --------- | ----------- | ------------------------ |
| SMOKE-020 | 🟡 All routes respond  | Important | [PROD]      | No 500 on any route      |
| SMOKE-021 | 🟡 Static assets load  | Important | [PROD]      | CSS, JS, fonts load      |
| SMOKE-022 | 🟡 PDF.js worker loads | Important | [PROD]      | Worker script accessible |

---

## 11. Chaos Engineering Tests

These tests intentionally introduce failures to verify resilience.

### 11.1 Service Disruption

| ID        | Test Name                      | Priority  | Environment | Description               |
| --------- | ------------------------------ | --------- | ----------- | ------------------------- |
| CHAOS-001 | 🟡 Redis unavailable mid-batch | Important | [LOCAL]     | Batch fails, retry works  |
| CHAOS-002 | 🟡 Gemini returns 503          | Important | [LOCAL]     | Retry mechanism activates |
| CHAOS-003 | 🟡 Modal returns timeout       | Important | [LOCAL]     | Fallback PDF used         |
| CHAOS-004 | 🟡 B2 temporarily unavailable  | Important | [LOCAL]     | Upload retry or failure   |
| CHAOS-005 | 🟡 QStash delivery delayed     | Important | [STAGING]   | Job eventually completes  |

### 11.2 Data Corruption

| ID        | Test Name                      | Priority  | Environment | Description                 |
| --------- | ------------------------------ | --------- | ----------- | --------------------------- |
| CHAOS-010 | 🟡 Redis key deleted mid-job   | Important | [LOCAL]     | Job fails gracefully        |
| CHAOS-011 | 🟡 Page data corrupted         | Important | [LOCAL]     | Placeholder used            |
| CHAOS-012 | 🟡 B2 file deleted mid-process | Important | [LOCAL]     | Error detected and reported |

### 11.3 Load Spikes

| ID        | Test Name                    | Priority     | Environment | Description                |
| --------- | ---------------------------- | ------------ | ----------- | -------------------------- |
| CHAOS-020 | 🟢 10x normal traffic        | Nice-to-have | [STAGING]   | System degrades gracefully |
| CHAOS-021 | 🟢 Thundering herd on status | Nice-to-have | [STAGING]   | Rate limiting works        |

---

## 12. Regression Tests

Run these tests when making changes to ensure existing functionality isn't broken.

### 12.1 Core Functionality Regression

| ID      | Test Name              | Affected Files                 | Description                       |
| ------- | ---------------------- | ------------------------------ | --------------------------------- |
| REG-001 | 🔴 Basic transcription | lib/gemini.ts                  | Gemini still returns valid schema |
| REG-002 | 🔴 HTML rendering      | lib/formatting.ts              | All block types render            |
| REG-003 | 🔴 PDF generation      | finalize/route.ts              | PDFs generated correctly          |
| REG-004 | 🔴 Email delivery      | send-email/route.ts            | Emails sent successfully          |
| REG-005 | 🔴 Job state machine   | jobs/route.ts, status/route.ts | State transitions correct         |

### 12.2 Integration Regression

| ID      | Test Name                   | Description                         |
| ------- | --------------------------- | ----------------------------------- |
| REG-010 | 🔴 QStash chain unbroken    | Batches chain to finalize correctly |
| REG-011 | 🔴 Redis schema compatible  | Job objects serialize/deserialize   |
| REG-012 | 🔴 B2 URLs work with Gemini | Signed URLs fetchable by Gemini     |

### 12.3 UI Regression

| ID      | Test Name                 | Description                |
| ------- | ------------------------- | -------------------------- |
| REG-020 | 🔴 Upload component works | File selection and upload  |
| REG-021 | 🔴 Progress display       | Progress bar updates       |
| REG-022 | 🔴 Download button        | PDF download works         |
| REG-023 | 🔴 Email confirmation     | Confirmation message shown |

---

## Appendix A: Test Data Requirements

### A.1 Test PDF Files

| File              | Pages | Content         | Purpose          |
| ----------------- | ----- | --------------- | ---------------- |
| test-1page.pdf    | 1     | Simple text     | Basic flow       |
| test-5page.pdf    | 5     | Mixed content   | Single batch     |
| test-15page.pdf   | 15    | Various layouts | Multi-batch      |
| test-200page.pdf  | 200   | Generated       | Maximum load     |
| test-math.pdf     | 3     | Equations only  | Math rendering   |
| test-diagrams.pdf | 3     | Diagrams        | Diagram handling |
| test-blank.pdf    | 1     | Blank page      | Edge case        |
| test-corrupt.pdf  | N/A   | Invalid file    | Error handling   |

### A.2 Test Email Addresses

| Email                              | Purpose         |
| ---------------------------------- | --------------- |
| test-success@example.com           | Normal flow     |
| test-bounce@example.com            | Bounce handling |
| long-email-address-...@example.com | Length limits   |

### A.3 Test Images

| Image          | Size      | Content           | Purpose        |
| -------------- | --------- | ----------------- | -------------- |
| test-clear.png | 1920x1080 | Clear handwriting | Normal case    |
| test-messy.png | 1920x1080 | Messy handwriting | [UNCLEAR] test |
| test-blank.png | 1920x1080 | White             | Empty page     |
| test-huge.png  | 4000x6000 | Dense content     | Large image    |
| test-tiny.png  | 100x100   | Minimal           | Small image    |

---

## Appendix B: Test Environment Setup

### B.1 Local Testing

```bash
# Required environment variables for local tests
GEMINI_API_KEY=test-key
UPSTASH_REDIS_REST_URL=https://test-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=test-token
B2_ENDPOINT=s3.test.backblazeb2.com
B2_REGION=test-region
B2_KEY_ID=test-key
B2_APPLICATION_KEY=test-secret
B2_BUCKET_NAME=test-bucket
# QSTASH_TOKEN=omit for local bypass
# RESEND_API_KEY=omit for mock
# MODAL_PDF_ENDPOINT=optional
```

### B.2 Staging Testing

```bash
# Same as production but with:
VERCEL_URL=staging.handscriptnotes.vercel.app
# Use separate Redis database
# Use separate B2 bucket
# Use test Resend domain
```

### B.3 Production Testing

```bash
# Smoke tests only
# Use real credentials
# Minimal test data
# Cleanup immediately
```

---

## Appendix C: Test Execution Checklist

### Pre-Deployment Checklist

- [ ] All ENV-\* tests pass
- [ ] All _-001, _-002, \*-003 tests pass (core functionality)
- [ ] All E2E-001 through E2E-008 pass
- [ ] All ERR-\* tests pass (error handling)
- [ ] All SEC-\* tests pass (security)
- [ ] Build succeeds without warnings

### Post-Deployment Checklist

- [ ] All SMOKE-\* tests pass
- [ ] E2E-001 complete flow works
- [ ] Email received in test inbox
- [ ] PDF downloadable and valid
- [ ] No errors in Vercel logs

### Rollback Triggers

- Any SMOKE test fails
- E2E-001 fails
- Security vulnerability detected
- Error rate > 5%

---

_Test Plan Version: 1.0_
_Created: January 15, 2026_
_Based on: HandScript codebase analysis in fixed.md_
