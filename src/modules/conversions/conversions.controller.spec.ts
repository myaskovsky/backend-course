import { Readable } from 'node:stream';

import {
  PayloadTooLargeException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/modules/auth/auth.constants';

import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';

const actor: RequestUser = { userId: 'u1', email: 'u@x.io', roles: [] };

interface FakePart {
  type: 'file' | 'field';
  fieldname?: string;
  filename?: string;
  value?: unknown;
  toBuffer?: () => Promise<Buffer>;
}

function fakeReq(
  parts: FakePart[],
  opts: { multipart?: boolean; readError?: Error } = {},
): FastifyRequest {
  const multipart = opts.multipart ?? true;
  return {
    isMultipart: () => multipart,
    parts: async function* () {
      await Promise.resolve();
      for (const part of parts) {
        if (part.type === 'file' && opts.readError) {
          part.toBuffer = () => Promise.reject(opts.readError!);
        }
        yield part;
      }
    },
  } as unknown as FastifyRequest;
}

describe('ConversionsController', () => {
  let service: jest.Mocked<Pick<ConversionsService, 'convert' | 'listFormats'>>;
  let controller: ConversionsController;

  beforeEach(() => {
    service = {
      convert: jest.fn().mockResolvedValue({
        stream: Readable.from(Buffer.from('name: Ann')),
        contentType: 'application/yaml; charset=utf-8',
        filename: 'converted.yaml',
      }),
      listFormats: jest
        .fn()
        .mockReturnValue([{ source: 'json', target: ['csv', 'xml', 'yaml'] }]),
    };
    controller = new ConversionsController(
      service as unknown as ConversionsService,
    );
  });

  it('reads the file + targetFormat and delegates to the service', async () => {
    const req = fakeReq([
      {
        type: 'file',
        filename: 'data.json',
        toBuffer: () => Promise.resolve(Buffer.from('{"name":"Ann"}')),
      },
      { type: 'field', fieldname: 'targetFormat', value: 'yaml' },
    ]);

    const result = await controller.convert(req, actor);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(service.convert).toHaveBeenCalledWith({
      userId: 'u1',
      filename: 'data.json',
      targetFormatRaw: 'yaml',
      buffer: Buffer.from('{"name":"Ann"}'),
      save: false,
    });
  });

  it('passes save=true when the save field is "true"', async () => {
    const req = fakeReq([
      {
        type: 'file',
        filename: 'data.json',
        toBuffer: () => Promise.resolve(Buffer.from('{}')),
      },
      { type: 'field', fieldname: 'targetFormat', value: 'yaml' },
      { type: 'field', fieldname: 'save', value: 'true' },
    ]);

    await controller.convert(req, actor);

    expect(service.convert).toHaveBeenCalledWith(
      expect.objectContaining({ save: true }),
    );
  });

  it('rejects a non-multipart request with 415', async () => {
    const req = fakeReq([], { multipart: false });
    await expect(controller.convert(req, actor)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.convert).not.toHaveBeenCalled();
  });

  it('maps a multipart file-size-limit error to 413', async () => {
    const req = fakeReq([{ type: 'file', filename: 'data.json' }], {
      readError: Object.assign(new Error('too large'), {
        code: 'FST_REQ_FILE_TOO_LARGE',
      }),
    });
    await expect(controller.convert(req, actor)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('lists supported formats', () => {
    expect(controller.listFormats()).toEqual([
      { source: 'json', target: ['csv', 'xml', 'yaml'] },
    ]);
  });
});
