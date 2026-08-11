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
          ADMIN_LOGIN_PASSWORD: 'test-admin-password'
        }
      }
    })
  ],
  test: {
    sequence: { concurrent: false }
  }
});
