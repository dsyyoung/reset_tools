# RESET Tools

A small Node.js app that serves a static frontend and queries MongoDB for `res_id` records. The frontend lets users select a target field and load data from the database.

## Files

- `server.js` - Express backend and MongoDB query endpoint
- `public/index.html` - Static page with the form and results area
- `public/app.js` - Frontend JavaScript for fetching and rendering data
- `public/styles.css` - Mobile-friendly and senior-friendly styling
- `.env` - Environment variables for MongoDB connection
- `.github/workflows/nodejs.yml` - GitHub Actions CI workflow

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create or update `.env` with your MongoDB settings:

```env
MONGO_URI="mongodb://mongoadmin:password@host:27017"
MONGO_DB=your_database_name
MONGO_COLL=your_collection_name
CA_PATH=/path/to/mongodb-ca.pem
```

3. Start the server:

```bash
npm start
```

4. Open the app in a browser:

```text
http://localhost:3000
```

## Usage

1. Enter a `res_id` value.
2. Select either `Drug Information` or `Medical History`.
3. Click `Load Data`.
4. The app will query MongoDB and show the matching result.

## Notes

- The frontend normalizes `res_id` to uppercase, so `res0001` and `RES0001` both work.
- The app filters `drug_info` results and skips `drug: Yes` when rendering details.
- The status and results boxes are hidden until the user clicks `Load Data`.

## GitHub Actions CI

The repo includes `.github/workflows/nodejs.yml`, which:

- checks out the repository
- installs dependencies
- runs `npm test`
- validates that `server.js` starts and responds on `http://127.0.0.1:3000`

## Deployment

This app requires a Node.js backend, so it cannot be deployed on GitHub Pages.

Recommended deployment targets:

- Railway
- Render
- Fly.io
- Heroku
- Azure Web Apps
- AWS Elastic Beanstalk / ECS

If you want, I can also add a deployment workflow for one of these platforms.
