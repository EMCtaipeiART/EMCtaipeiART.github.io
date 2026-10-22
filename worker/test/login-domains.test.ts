import { describe, expect, it } from 'vitest';
import { isAllowedLoginAccount, PROJECT_LIKE_DEPARTMENTS } from '../src/model';

describe('login domains and project-like departments', () => {
  it('allows the company domain and the 呈鈺顧問 domain only', () => {
    expect(isAllowedLoginAccount('machi.chen@emctaipei.com')).toBe(true);
    expect(isAllowedLoginAccount('CarrieYeh@jadeit.cc')).toBe(true);
    expect(isAllowedLoginAccount('someone@gmail.com')).toBe(false);
    expect(isAllowedLoginAccount('evil@jadeit.cc.example.com')).toBe(false);
    expect(isAllowedLoginAccount('')).toBe(false);
  });
  it('treats 呈鈺顧問 like 專案部', () => {
    expect(PROJECT_LIKE_DEPARTMENTS).toEqual(['專案部', '呈鈺顧問']);
  });
});
