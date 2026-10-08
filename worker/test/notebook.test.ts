import { describe, expect, it } from 'vitest';
import { parseColumnLayout, parseCsv, parseVendorLayout, trimGrid } from '../src/notebook';

describe('notebook csv helpers', () => {
  it('parses quoted cells, escaped quotes and embedded newlines', () => {
    expect(parseCsv('"a","b ""q"""\n"line1\nline2",""\r\n"x","y"')).toEqual([['a', 'b "q"'], ['line1\nline2', ''], ['x', 'y']]);
  });

  it('trims trailing empty rows and columns and pads rows to one width', () => {
    expect(trimGrid(parseCsv('"A","","",""\n"b","c","",""\n"","","",""'))).toEqual([['A', ''], ['b', 'c']]);
  });
});

describe('notebook seed layouts', () => {
  it('column layout: section row, name row, then label/value rows become one card per column', () => {
    const rows = [
      ['AI 工具', '', ''],
      ['', 'Tool A', 'Tool B'],
      ['網址', 'https://a.example', ''],
      ['帳號', 'user@a', 'user@b'],
      ['密碼', 'secretA', 'secretB'],
      ['備註', '訂閱中', ''],
      ['備用', '', ''],
      ['', 'Tool C', ''],
      ['帳號', 'c@x', '']
    ];
    const items = parseColumnLayout(rows, 'AI');
    expect(items.map(i => [i.section, i.title, i.fields.length])).toEqual([['AI 工具', 'Tool A', 4], ['AI 工具', 'Tool B', 2], ['備用', 'Tool C', 1]]);
    expect(items[0].fields.find(f => f.label === '密碼')?.secret).toBe(true);
    expect(items[0].fields.find(f => f.label === '帳號')?.secret).toBe(false);
  });

  it('vendor layout: printing row, vertical vendors and the right-hand rental blocks', () => {
    const rows: string[][] = [
      ['印刷資訊 廠商甲 網址 所屬公司 帳號', 'https://a.example 公司甲 A1', '廠商乙 B2', '廠商丙 C3', '', '影像器材租借資訊 租借行 網址 所屬公司 會員', 'Line：租借行 公司甲 會員甲'],
      ['密碼', 'p1', 'p2', 'p3', '', '帳號', 'acc'],
      ['使用信箱', 'm1@x', 'm2@x', 'm3@x', '', '密碼', 'rp'],
      ['項目', '名片', '名片', '名片', '', '預約方式', '電話預約\n或 Line'],
      ['', '', '', '', '', '預約格式', '姓名：\n手機：'],
      ['捷可印', '', '', '', '', '', ''],
      ['網址', 'https://j.example', '', '', '', '', ''],
      ['帳號', 'j@x', '', '', '', '備註', '押證件'],
      ['密碼', 'jp', '', '', '', '', ''],
      ['小咪哥', '', '', '', '', '旋轉木馬', ''],
      ['姓名', '張三', '', '', '', '網址', ''],
      ['手機', '0900', '', '', '', '帳號', 'ca'],
      ['備註', '可趕急件', '', '', '', '密碼', 'cp']
    ];
    const items = parseVendorLayout(rows, '廠商資訊');
    expect(items.map(i => [i.section, i.title])).toEqual([
      ['印刷資訊', '廠商甲'], ['印刷資訊', '廠商乙'], ['印刷資訊', '廠商丙'], ['印刷資訊', '捷可印'], ['印刷資訊', '小咪哥'],
      ['影像器材租借', '租借行'], ['影像器材租借', '旋轉木馬']
    ]);
    const first = items[0].fields.map(f => `${f.label}=${f.value}`);
    expect(first).toEqual(['網址=https://a.example', '所屬公司=公司甲', '帳號=A1', '密碼=p1', '使用信箱=m1@x', '項目=名片']);
    const rental = items.find(i => i.title === '租借行');
    expect(rental?.fields.map(f => f.label)).toEqual(['網址', '所屬公司', '會員', '帳號', '密碼', '預約方式', '預約格式', '備註']);
    expect(items.find(i => i.title === '旋轉木馬')?.fields.map(f => f.label)).toEqual(['帳號', '密碼']);
    expect(items.every(i => i.fields.filter(f => f.secret).every(f => f.label === '密碼'))).toBe(true);
  });
});
