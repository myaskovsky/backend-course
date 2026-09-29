import { Readable } from 'node:stream';

import { ForbiddenException, StreamableFile } from '@nestjs/common';

import { RequestUser } from '@/modules/auth/auth.constants';

import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { TransformationsController } from './transformations.controller';
import { TransformationsService } from './transformations.service';

describe('TransformationsController', () => {
  const actor: RequestUser = {
    userId: 'user-1',
    email: 'u@example.com',
    roles: ['user'],
  };
  const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  let service: jest.Mocked<
    Pick<TransformationsService, 'listHistory' | 'getOwnDownload'>
  >;
  let controller: TransformationsController;

  beforeEach(() => {
    service = {
      listHistory: jest.fn(),
      getOwnDownload: jest.fn(),
    };
    controller = new TransformationsController(
      service as unknown as TransformationsService,
    );
  });

  describe('history', () => {
    it("lists the actor's own history and returns the page", async () => {
      const page = { items: [], nextCursor: null };
      service.listHistory.mockResolvedValue(page);
      const query = Object.assign(new ListHistoryQueryDto(), { limit: 5 });

      await expect(controller.history(actor, query)).resolves.toBe(page);
      expect(service.listHistory).toHaveBeenCalledWith('user-1', query);
    });
  });

  describe('download', () => {
    it('streams the file with content type and attachment disposition', async () => {
      const stream = Readable.from('a: 1');
      service.getOwnDownload.mockResolvedValue({
        stream,
        contentType: 'application/yaml; charset=utf-8',
        filename: 'converted.yaml',
      });

      const file = await controller.download(actor, ITEM_ID);

      expect(service.getOwnDownload).toHaveBeenCalledWith('user-1', ITEM_ID);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getStream()).toBe(stream);
      expect(file.getHeaders()).toMatchObject({
        type: 'application/yaml; charset=utf-8',
        disposition: 'attachment; filename="converted.yaml"',
      });
    });

    it('propagates service errors (e.g. 403 for foreign items)', async () => {
      service.getOwnDownload.mockRejectedValue(new ForbiddenException());
      await expect(controller.download(actor, ITEM_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
