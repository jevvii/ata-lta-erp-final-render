# Secret Rotation Runbook

**Last updated**: 2026-07-17

## Supabase Service Key Rotation

1. Generate a new service role key in Supabase dashboard → Settings → API.
2. Update the key in Render environment group (`erp-uat-secrets` or `erp-prod-secrets`).
3. Redeploy the affected Web Service.
4. Verify `/health` returns `supabase: true`.
5. Revoke the old key in Supabase.

## AWS Access Key Rotation

1. Create a new IAM access key in AWS Console → IAM → Users.
2. Update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the Render environment group.
3. Redeploy the affected Web Service.
4. Verify `/health` returns `s3: true`.
5. Deactivate and delete the old access key in AWS.

## CloudFront Key Pair Rotation

1. Generate a new CloudFront key pair in AWS Console → CloudFront → Key Management → Public Keys.
2. Create a new key group with the new public key.
3. Update `CLOUDFRONT_KEY_ID` and `CLOUDFRONT_PRIVATE_KEY` in the Render environment group.
4. Redeploy the Web Service.
5. Test document download URLs.
6. Remove the old public key from the key group and delete it.

## GitHub Repository Secrets

1. Go to GitHub → Settings → Secrets and variables → Actions.
2. Update the affected secret.
3. Re-run the latest workflow to verify.

## Post-Rotation Checklist

- [ ] Health check passes.
- [ ] Smoke tests pass.
- [ ] No errors in Render logs.
- [ ] Old credentials are revoked/deleted.
