# RESET Tools

A small Node.js app that serves a static frontend and queries MongoDB for `res_id` records. The frontend lets users select a target field and load data from the database.

## Usage

1. Enter a `res_id` value.
2. Select either `Drug Information` or `Medical History`.
3. Click `Load Data`.
4. The app will query MongoDB and show the matching result.

## Notes

- The frontend normalizes `res_id` to uppercase, so `res0001` and `RES0001` both work.

## GitHub Actions CI

The repo includes `.github/workflows/nodejs.yml`, which:

- checks out the repository
- installs dependencies
- runs `npm test`
- validates that `server.js` starts and responds on `http://127.0.0.1:3000`

## AWS Lambda deployment

This app can use AWS Lambda as the backend and GitHub Pages for the static frontend.

### Backend

1. Create a Lambda function in AWS.
2. Deploy the application code and dependencies.
3. Set environment variables in Lambda:

```text
MONGO_URI
MONGO_DB
MONGO_COLL
CA_PATH (optional)
```

4. Enable a Lambda Function URL.
5. Allow CORS from your GitHub Pages origin.

### Frontend

Update `public/app.js` and replace the placeholder:

```js
const apiBaseUrl = 'https://YOUR_LAMBDA_FUNCTION_URL.on.aws';
```

When your site is hosted on GitHub Pages, the frontend will use that external URL.

### GitHub Pages

GitHub Pages can host the static frontend, but not the backend. Copy `public/index.html`, `public/app.js`, and `public/styles.css` into the Pages source (`docs/` or root) or configure Pages to serve from a branch.

### Run locally

For local development, the app still works with `npm start` and uses the local backend at `/api/data`.
