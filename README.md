# Medical Data & Authorization Lookup Tools

A lightweight, serverless suite of web tools that allows users to securely query medical records, look up drug information, and verify user credentials using their unique RESET ID.

This project uses a serverless architecture, combining a static frontend with a scalable cloud backend to ensure fast, cost-effective performance.

## Live Website
* **Data Viewer:** [https://dsyyoung.github.io/reset_tools/index.html](https://dsyyoung.github.io/reset_tools/)
* **Authorization Tool:** [https://dsyyoung.github.io/reset_tools/auth.html](https://dsyyoung.github.io/reset_tools/auth.html)
* **Latest Entry Finder:** [https://dsyyoung.github.io/reset_tools/latest.html](https://dsyyoung.github.io/reset_tools/latest.html)

---

## User Guide: How to Use the Tools

### 1. Medical Data Viewer (`index.html`)
The interface allows you to query specific health parameters:
1. **Enter a RESET ID:** In the `RESET ID` input box, type the unique identifier (e.g., `RES5216`). The system will automatically format it.
2. **Select a Data Field:** Use the dropdown menu to select either **Drug Information** or **Medical History**.
3. **Load Data:** Click the **Load Data** button.
4. **View Results:** The application fetches the data from the backend and displays it in an easy-to-read, formatted card layout.

### 2. RESET ID Authorization Tool (`auth.html`)
A security verification portal to retrieve user identities:
1. **Navigate to the Page:** Click on the "Authorization Tool" link at the top of the Data Viewer.
2. **Enter a RESET ID:** Type the client's RESET ID (e.g., `RES5216`) in the glowing input box.
3. **Verify:** Click **Check Authorization** or press **Enter**.
4. **Get Credentials**:
   * **If Authorized**: The tool displays an "Authorization Successful" banner, shows the associated `user_id` (e.g. `7940c963-0b82-41e5-a5e5-c70224e38206`), and displays device details (device type, serial number). You can copy the User ID to your clipboard with the **Copy** button.
   * **If Unauthorized**: A red failure alert is shown indicating that the RESET ID was not found.

### 3. Garmin Latest Entry Finder (`latest.html`)
A tool to resolve the latest Garmin watch data upload timestamp and file path from the S3 data lakehouse:
1. **Navigate to the Page**: Click on the "Latest Entry" link in the top navigation bar.
2. **Enter a RESET ID**: Type the client's RESET ID (e.g., `RES5216`) in the input box.
3. **Find Latest Entry**: Click **Find Latest Entry** or press **Enter**.
4. **View Resolved Details**:
   * **Latest Entry Date**: Displays the most recent date parsed from the folder path (e.g., `July 14, 2026`).
   * **Associated User ID**: The resolved MongoDB mapping for the RESET ID (with a **Copy** button).
   * **Latest Document S3 Key**: The exact S3 object key of the latest file (with a **Copy** button).
   * **S3 Last Modified**: The precise last modified timestamp of the file in S3.

---

## Architecture & API Overview

This application is built using a modern decoupled architecture:

* **Frontend:** Vanilla HTML, CSS (including a glassmorphic dark theme for authorization), and JavaScript.
* **Hosting:** GitHub Pages.
* **Backend:** Node.js (Express) wrapped in `serverless-http`.
* **Compute:** AWS Lambda.
* **Database:** MongoDB (Connected securely with TLS) and AWS S3 (Garmin Watch Data Lakehouse).

### API Endpoints

#### 1. `GET /api/data`
* **Query Params**: `res_id` (string), `field` (`drug_info` | `medical_history`)
* **Database Target**: `Visit1A` database, `GoldenForm` collection.
* **Behavior**: Returns specific fields projection for the given resource ID.

#### 2. `GET /api/authorize`
* **Query Params**: `res_id` (string)
* **Database Target**: `CRF_data` database, `Wearables` collection.
* **Behavior**: Locates the wearable registration for the RESET ID and returns the corresponding `user_id` along with wearable type and serial number.

#### 3. `GET /api/latest-date`
* **Query Params**: `res_id` (string)
* **Database/Storage Target**: `CRF_data` database, `Wearables` collection $\rightarrow$ AWS S3 `garmin-watch-data-lakehouse` bucket.
* **Behavior**: Resolves the `user_id` for the RESET ID from MongoDB, and crawls the user's folders in S3 to retrieve the latest file key, date, and upload timestamp.

### The Data Flow
1. The user loads the static UI from GitHub Pages.
2. The frontend scripts read the backend API destination from `config.js`.
3. Browser makes HTTP requests to the AWS Lambda Function URL (`/api/data`, `/api/authorize`, or `/api/latest-date`).
4. AWS Lambda connects to MongoDB (and queries AWS S3 if requested), runs the query/traversal, and returns JSON.
5. The frontend handles success and failure states, rendering them with clean typography, clipboard interactions, and transitions.
## Mobile report completeness

Open `completeness.html` (also linked from the Data Viewer). The page lists 18 reports and collections across five visits, grouped by study year. It provides expandable cards, a missing-only filter, a last-checked time, and an explicitly labelled sample preview. The preview never calls the API.

`GET /api/completeness?res_id=RES5216` returns availability only, without report contents or S3 object paths. It uses S3 and PostgreSQL independently of the MongoDB connection middleware. The existing server still requires `MONGO_URI` at startup. Authentication is deferred, as requested.

### Configure real sources

The confirmed bucket is `reset-clinical-data`; `CLINICAL_DATA_BUCKET` can override it. The following mappings are configured in `completeness-config.json`:

| Report | S3 key or pattern |
| --- | --- |
| Biochem 1B | Participant PDF in `Biochemistry_1B/`, including `{res_id}.pdf` and filenames with underscore or hyphen separators |
| Biochem 2A | Participant PDF in `Biochemistry_2A/`, with underscore or hyphen filename separators |
| CTCA 2B | Any nonempty PDF under `CTCA/{res_id}/Report/` |
| DEXA 1B | `DEXA/*/{res_id}/*.pdf` |
| Echo 1C | `ECHO/{res_id}_E.pdf` |
| Liver 1B | `Liver Fibroscan/1B/{res_id}.pdf` |
| Liver 2A | `Liver Fibroscan/2A/{res_id}.pdf` |
| MoCA 1A | Participant PDF in `MoCA_1A/0. MoCA/`, with or without a leading filename space |
| MoCA 2A | Participant PDF in `MoCA_2A/V2A MoCA/`, regardless of suffix spelling/order |
| Vascular 1C | Participant PDF in `Vascular scans/` (including `{res_id}.pdf` and `{res_id}_V.pdf`) |

A `key` uses exact metadata lookup. A `prefix` must contain `{res_id}` and end in `/`. A `pattern` supports `*` within one path segment, with all other characters treated literally. DEXA scans the `DEXA/` prefix to find the participant under any date folder. Finding one nonempty PDF counts as availability; this does not assert that every DEXA component is present. Year 3 and ECG are excluded for now.

### PostgreSQL questionnaires and biobank collection

Mappings were taken from `report_extraction/Lambda/mongo_psql_sync/lambda_function.py` and its schema metadata. The database is `reset_clinical_test`, schema `public`, with `res_id` and `visit` columns:

- Golden Form: `golden_form`, visit 1A.
- SelfQ: `selfq`, visits 1A, 2A.
- PE: `pe_test`, visits 1B, 2A.
- Medical History: `medical_history`, visit 2A.

Queries return only a boolean using parameterized participant and visit values. Visit labels such as `1A`, `Visit 1A`, and `Visit1A` are normalized. Presence means a database row exists, not that every answer is populated. Missing rows may reflect sync coverage or delay, not a missing source questionnaire.

Configure `PGHOST`, `PGPORT` (default 5432), `PGDATABASE` (default `reset_clinical_test`), `PGUSER`, and `PGPASSWORD` in the backend environment. Host aliases `PG_HOST`/`RDSHOST` and credential aliases `USERNAME`/`PASSWORD` match the extraction code. Do not use `PORT` for PostgreSQL; it controls the HTTP server here. TLS certificate verification is enabled; set `PGSSLROOTCERT` to a readable CA file if needed. Use a database role with read access to these tables. Connections and queries have time limits, and sessions are read-only. Without a configured host, PostgreSQL checks remain unknown. No credentials are stored in source files.

Biobank collection uses `public.biobank_tube_observations`, matching `res_id` and normalized `visit_code` for visits 1B and 2A. “Found” means at least one matching tube observation exists; it does not require a collection date or prove that every sample type was collected. Duplicate observations do not affect availability. The table also contains visit 3A, which remains outside the page’s current Year 1–2 scope.

Supported mapping keys:
- `1a.golden_form`, `1a.selfq`, `1a.moca`
- `1b.biochem`, `1b.liver`, `1b.dexa`, `1b.pe`, `1b.biobank`
- `1c.echo`, `1c.vascular`
- `2a.medical_history`, `2a.selfq`, `2a.moca`, `2a.biochem`, `2a.liver`, `2a.pe`, `2a.biobank`
- `2b.ctca`

The backend AWS role needs `s3:GetObject` for exact-key metadata checks and `s3:ListBucket` for prefix scans and to distinguish nonexistent keys from access-denied responses. A 403 remains unknown, not missing. It does not download reports. A nonempty matching file means “Found”; a fully checked prefix without a matching file means “Missing.” Missing mappings, access failures, and incomplete scans remain “Unable to check.” Each report scan is capped at 20 pages of 1,000 objects. This checks availability, not report content completeness, scheduling, exemptions, or participant registration.

Run `npm test` for offline status, validation, and pagination tests. The Lambda deployment archive includes the new service and mapping configuration.

For Lambda, set the PostgreSQL variables under Configuration → Environment variables. For local development, add them to the ignored `.env` file; `.env.example` contains placeholders only. The Lambda network must be able to reach the PostgreSQL host and port (including VPC routing and database security-group access when applicable). Never put database credentials in frontend `config.js`.

For AWS RDS in Lambda, the PostgreSQL adapter automatically loads `/var/runtime/ca-cert.pem` with certificate verification enabled. `PGSSLROOTCERT` overrides this path. `completeness-s3-policy.json` documents the scoped read policy; applying IAM permissions requires explicit approval.

MoCA and Biochem 1B/2A availability uses their report-specific folder plus an exact participant ID followed by a separator or extension. Label case, suffix order, and Unicode MoCA labels do not affect matching. Only nonempty PDFs directly inside the configured folder count; neighboring IDs and nested unrelated files are excluded. MoCA 1A checks both known leading-space variants.

Echo and Vascular fall back to `public.echo_test` and `public.vascular_test` when a PDF is absent or cannot be checked. The fallback matches `res_id` and normalized visit `1C`. A database match is labelled as such in the page. “Missing” requires both sources to confirm absence; errors remain unknown unless the other source confirms presence.
