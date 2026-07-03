# Medical Data & Authorization Lookup Tools

A lightweight, serverless suite of web tools that allows users to securely query medical records, look up drug information, and verify user credentials using their unique RESET ID.

This project uses a serverless architecture, combining a static frontend with a scalable cloud backend to ensure fast, cost-effective performance.

## Live Website
* **Data Viewer:** [https://reset_tools/medical_query](https://dsyyoung.github.io/reset_tools/)
* **Authorization Tool:** [https://reset_tools/garmin_auth](https://dsyyoung.github.io/reset_tools/auth.html)

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

---

## Architecture & API Overview

This application is built using a modern decoupled architecture:

* **Frontend:** Vanilla HTML, CSS (including a glassmorphic dark theme for authorization), and JavaScript.
* **Hosting:** GitHub Pages.
* **Backend:** Node.js (Express) wrapped in `serverless-http`.
* **Compute:** AWS Lambda.
* **Database:** MongoDB (Connected securely with TLS).

### API Endpoints

#### 1. `GET /api/data`
* **Query Params**: `res_id` (string), `field` (`drug_info` | `medical_history`)
* **Database Target**: `Visit1A` database, `GoldenForm` collection.
* **Behavior**: Returns specific fields projection for the given resource ID.

#### 2. `GET /api/authorize`
* **Query Params**: `res_id` (string)
* **Database Target**: `CRF_data` database, `Wearables` collection.
* **Behavior**: Locates the wearable registration for the RESET ID and returns the corresponding `user_id` along with wearable type and serial number.

### The Data Flow
1. The user loads the static UI from GitHub Pages.
2. The frontend scripts read the backend API destination from `config.js`.
3. Browser makes HTTP requests to the AWS Lambda Function URL (`/api/data` or `/api/authorize`).
4. AWS Lambda connects to the MongoDB server, runs the query on the respective database, and returns JSON.
5. The frontend handles success and failure states, rendering them with clean typography and transition animations.