import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as yaml from 'js-yaml';

import {
  createTestApp,
  multipartBody,
  registerAndLogin,
} from './utils/test-app';

/**
 * End-to-end test for text-format conversion: real multipart streaming,
 * worker threads, and temp files on disk.
 */
describe('Text-format conversion (e2e)', () => {
  let app: NestFastifyApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    accessToken = (await registerAndLogin(app, 'e2e-convert')).access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  const convert = (
    fields: Parameters<typeof multipartBody>[0],
    authenticated = true,
  ) => {
    const { payload, headers } = multipartBody(fields);
    return app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      payload,
      ...(authenticated ? { cookies: { access_token: accessToken } } : {}),
    });
  };

  it('requires authentication', async () => {
    const res = await convert(
      { filename: 'data.json', content: '{"a":1}', targetFormat: 'yaml' },
      false,
    );
    expect(res.statusCode).toBe(401);
  });

  it('converts JSON to YAML', async () => {
    const res = await convert({
      filename: 'data.json',
      content: '{"name":"Ann","age":30}',
      targetFormat: 'yaml',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/yaml; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="converted.yaml"',
    );
    expect(res.body).toContain('name: Ann');
  });

  it('converts CSV to JSON', async () => {
    const res = await convert({
      filename: 'data.csv',
      content: 'name,age\nAnn,30\n',
      targetFormat: 'json',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ name: 'Ann', age: '30' }]);
  });

  it('converts a real-world YAML document to JSON', async () => {
    const content = readFileSync(join(__dirname, 'fixtures', 'invoice.yaml'));
    const res = await convert({
      filename: 'invoice.yaml',
      content,
      targetFormat: 'json',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      JSON.parse(JSON.stringify(yaml.load(content.toString('utf8')))),
    );
  });

  it('converts XML records to CSV', async () => {
    const res = await convert({
      filename: 'people.xml',
      content:
        '<people><person><name>Ann</name><age>30</age></person><person><name>Bob</name><age>25</age></person></people>',
      targetFormat: 'csv',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('name,age\nAnn,30\nBob,25\n');
  });

  it('streams a multi-megabyte CSV through the workers', async () => {
    const rows = Array.from(
      { length: 60_000 },
      (_, i) => `${i},user-${i}@example.com,"Name, ${i}"`,
    );
    const content = `id,email,name\n${rows.join('\n')}\n`;
    expect(Buffer.byteLength(content)).toBeGreaterThan(2_000_000);

    const res = await convert({
      filename: 'big.csv',
      content,
      targetFormat: 'json',
    });
    expect(res.statusCode).toBe(200);
    const json = res.json<Array<Record<string, string>>>();
    expect(json).toHaveLength(60_000);
    expect(json[59_999]).toEqual({
      id: '59999',
      email: 'user-59999@example.com',
      name: 'Name, 59999',
    });
  });

  it('accepts the target format after the file part', async () => {
    const { payload, headers } = multipartBody({
      filename: 'data.json',
      content: '{"a":1}',
    });
    const tail = Buffer.from(
      '--' +
        headers['content-type'].split('boundary=')[1] +
        '\r\nContent-Disposition: form-data; name="targetFormat"\r\n\r\nxml\r\n',
    );
    // Insert the field before the closing boundary.
    const closing = payload.lastIndexOf(
      '--' + headers['content-type'].split('boundary=')[1] + '--',
    );
    const body = Buffer.concat([
      payload.subarray(0, closing),
      tail,
      payload.subarray(closing),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      payload: body,
      cookies: { access_token: accessToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<a>1</a>');
  });

  it.each([
    ['malformed JSON', 'data.json', '{bad', 400],
    ['invalid UTF-8', 'data.json', Buffer.from([0x22, 0xff, 0x22]), 400],
    [
      'an XML DOCTYPE',
      'data.xml',
      '<!DOCTYPE x [<!ENTITY e "x">]><r>&e;</r>',
      400,
    ],
    ['an empty file', 'data.json', '', 400],
    ['an unsupported extension', 'notes.txt', 'hello', 415],
  ])('rejects %s', async (_label, filename, content, status) => {
    const res = await convert({ filename, content, targetFormat: 'yaml' });
    expect(res.statusCode).toBe(status);
  });

  it('rejects a file over the per-format size limit with 413', async () => {
    const limit = Number(process.env.CONVERT_MAX_SIZE_JSON ?? 5_242_880);
    const res = await convert({
      filename: 'data.json',
      content: Buffer.alloc(limit + 1, 0x20),
      targetFormat: 'yaml',
    });
    expect(res.statusCode).toBe(413);
  });

  it('lists 12 supported conversion directions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/convert/formats',
      cookies: { access_token: accessToken },
    });
    expect(res.statusCode).toBe(200);
    const pairs = res.json<Array<{ source: string; target: string[] }>>();
    expect(pairs).toHaveLength(4);
    expect(pairs.reduce((n, p) => n + p.target.length, 0)).toBe(12);
  });
});
