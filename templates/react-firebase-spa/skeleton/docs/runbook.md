# Operations Runbook — ${{ values.name }}

## Rollback Procedure
1. Run `git revert <bad-sha> && git push origin main`.
2. Approve the resulting `github-pages` deployment in GitHub Actions.
3. If Firestore rules changed, redeploy the previous version via `firebase deploy --only firestore:rules`.
