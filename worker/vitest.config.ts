import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: '2026-08-08',
        bindings: {
          GITHUB_TOKEN: 'test-github-token',
          ERP_CLIENT_SECRET: 'test-erp-secret',
          ADMIN_LOGIN_PASSWORD: 'test-admin-password',
          NAS_WATCHER_API_KEY: 'test-nas-watcher-key',
          DATABASE_BACKUP_API_KEY: 'test-database-backup-key',
          GMAIL_OAUTH_CLIENT_SECRET: 'test-gmail-oauth-secret'
        }
      }
    })
  ],
  test: {
    sequence: { concurrent: false }
  }
});
