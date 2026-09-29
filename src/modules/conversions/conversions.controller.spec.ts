import { Readable } from 'node:stream';

import {
  PayloadTooLargeException,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/modules/auth/auth.constants';

import { ConversionsController } from './conversions.controller';
import { ConversionsService, StagedUpload } from './conversions.service';

const actor: RequestUser = { userId: 'u1', email: 'u@x.io', roles: [] };

interface FakePart {
  type: 'file' | 'field';
  fieldname?: string;
  filename?: string;
  value?: unknown;
  file?: Readable;
}

function fakeReq(
  parts: FakePart[],
  opts: { multipart?: boolean; iterError?: Error } = {},
): FastifyRequest {
  const multipart = opts.multipart ?? true;
  return {
    isMultipart: () => multipart,
    parts: async function* () {
      await Promise.resolve();
      for (const part of parts) {
        yield part;
      }
      if (opts.iterError) {
        throw opts.iterError;
      }
    },
  } as unknown as FastifyRequest;
}

describe('ConversionsController', () => {
  let service: jest.Mocked<
    Pick<
      ConversionsService,
      'convert' | 'listFormats' | 'stageUpload' | 'discard'
    >
  >;
  let controller: ConversionsController;
  const staged: StagedUpload = {
    filename: 'data.json',
    source: 'json' as never,
    path: '/tmp/x',
    size: 14,
  };

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
      stageUpload: jest.fn().mockResolvedValue(staged),
      discard: jest.fn().mockResolvedValue(undefined),
    };
    controller = new ConversionsController(
      service as unknown as ConversionsService,
    );
  });

  it('streams the file to staging and delegates to the service', async () => {
    const file = Readable.from(['{"name":"Ann"}']);
    const req = fakeReq([
      { type: 'file', filename: 'data.json', file },
      { type: 'field', fieldname: 'targetFormat', value: 'yaml' },
    ]);

    const result = await controller.convert(req, actor);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toMatchObject({
      type: 'application/yaml; charset=utf-8',
      disposition: 'attachment; filename="converted.yaml"',
    });
    expect(service.stageUpload).toHaveBeenCalledWith('data.json', file);
    expect(service.convert).toHaveBeenCalledWith({
      userId: 'u1',
      targetFormatRaw: 'yaml',
      upload: staged,
      save: false,
    });
  });

  it('accepts fields sent before the file and save=true', async () => {
    const req = fakeReq([
      { type: 'field', fieldname: 'targetFormat', value: 'yaml' },
      { type: 'field', fieldname: 'save', value: 'true' },
      { type: 'file', filename: 'data.json', file: Readable.from(['{}']) },
    ]);

    await controller.convert(req, actor);

    expect(service.convert).toHaveBeenCalledWith(
      expect.objectContaining({ targetFormatRaw: 'yaml', save: true }),
    );
  });

  it('passes an undefined upload when no file part was sent', async () => {
    const req = fakeReq([
      { type: 'field', fieldname: 'targetFormat', value: 'yaml' },
    ]);
    await controller.convert(req, actor);
    expect(service.convert).toHaveBeenCalledWith(
      expect.objectContaining({ upload: undefined }),
    );
  });

  it('rejects a non-multipart request with 415', async () => {
    const req = fakeReq([], { multipart: false });
    await expect(controller.convert(req, actor)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.convert).not.toHaveBeenCalled();
  });

  it('maps a multipart file-size-limit error to 413 and discards the upload', async () => {
    service.stageUpload.mockRejectedValue(
      Object.assign(new Error('too large'), { code: 'FST_REQ_FILE_TOO_LARGE' }),
    );
    const req = fakeReq([
      { type: 'file', filename: 'data.json', file: Readable.from(['x']) },
    ]);
    await expect(controller.convert(req, actor)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(service.convert).not.toHaveBeenCalled();
  });

  it('discards an already staged upload when the body fails later', async () => {
    const req = fakeReq(
      [{ type: 'file', filename: 'data.json', file: Readable.from(['{}']) }],
      { iterError: new Error('connection reset') },
    );
    await expect(controller.convert(req, actor)).rejects.toThrow(
      'connection reset',
    );
    expect(service.discard).toHaveBeenCalledWith(staged);
  });

  it('lists supported formats', () => {
    expect(controller.listFormats()).toEqual([
      { source: 'json', target: ['csv', 'xml', 'yaml'] },
    ]);
  });
});
