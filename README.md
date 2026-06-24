# Medical Data Lookup App

A lightweight, serverless web application that allows users to securely query specific medical records and drug information from a cloud database. 

This project uses a fully serverless architecture, combining a static frontend with a scalable cloud backend to ensure fast, cost-effective performance.

## Live Website
**Access the application here:** [https://daisyoung.com/reset_tools](https://dsyyoung.github.io/reset_tools/)

---

## User Guide: How to Use the Web Page

The interface is designed to be simple and intuitive. To look up information:

1. **Enter a Resource ID:** In the `RESET ID` input box, type the unique identifier for the record you want to query (e.g., `RES9999`). The system will automatically format it.
2. **Select a Data Field:** Use the dropdown menu to select the type of information you are looking for:
   * **Drug Info:** Displays medication records associated with the ID.
   * **Medical History:** Displays historical health records.
3. **Load Data:** Click the **Load Data** button. 
4. **View Results:** The application will fetch the data from the secure backend and display it in an easy-to-read, formatted table. If no records are found, or if an invalid ID is entered, a helpful status message will appear.

---

## Architecture Overview

This application is built using a modern decoupled architecture:

* **Frontend:** Vanilla HTML, CSS, and JavaScript.
* **Hosting:** GitHub Pages (Static hosting with custom DNS routing).
* **Backend:** Node.js (Express) wrapped in `serverless-http`.
* **Compute:** AWS Lambda (Triggered via Function URLs).
* **Database:** MongoDB (Connected securely with TLS).

### The Data Flow
1. The user's browser loads the static UI from GitHub Pages.
2. The `app.js` script reads the backend API destination from `config.js`.
3. The browser sends a `fetch` request with query parameters (`?res_id=...&field=...`) to the AWS Lambda Function URL.
4. AWS Lambda spins up the Express server, connects to MongoDB (using cached connections for speed), retrieves the specific projection, and returns JSON.
5. The frontend parses the JSON and dynamically generates the HTML table.