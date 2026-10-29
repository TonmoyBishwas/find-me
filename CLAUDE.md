# Find me in the study room

## Workflow
- After every change: commit, push to `main`, and confirm the deploy is live. Don't wait to be asked.
  - Pushing to `main` auto-deploys on Vercel: https://find-me-black-two.vercel.app
  - Confirm by fetching the changed file from the live site (add a cache-busting query).
- This is a PUBLIC repo. Never commit, push or deploy the Gemini API key. It lives only in the git-ignored `.env`. Scan the diff for it before every commit.
