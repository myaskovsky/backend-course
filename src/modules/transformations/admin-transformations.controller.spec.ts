import { Readable } from 'node:stream';

import { NotFoundException, StreamableFile } from '@nestjs/common';

import { RequestUser } from '@/modules/auth/auth.constants';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { AdminTransformationsController } from './admin-transformations.controller';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { TransformationsService } from './transformations.service';

describe('AdminTransformationsController', () => {
  const admin: RequestUser = {
    userId: 'admin-1',
    email: 'admin@example.com',
    roles: ['admin'],
  };
  const TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  let transformations: jest.Mocked<
    Pick<TransformationsService, 'listHistory' | 'getUserDownload'>
  >;
  let users: jest.Mocked<Pick<UsersService, 'findById'>>;
  let controller: AdminTransformationsController;

  beforeEach(() => {
    transformations = {
      listHistory: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getUserDownload: jest.fn(),
    };
    users = {
      findById: jest.fn().mockResolvedValue({ id: TARGET_ID } as User),
    };
    controller = new AdminTransformationsController(
      transformations as unknown as TransformationsService,
      users as unknown as UsersService,
    );
  });

  describe('history', () => {
    it("lists the target user's history when the user exists", async () => {
      const query = Object.assign(new ListHistoryQueryDto(), { limit: 10 });
      const page = await controller.history(admin, TARGET_ID, query);
      expect(users.findById).toHaveBeenCalledWith(TARGET_ID);
      expect(transformations.listHistory).toHaveBeenCalledWith(
        TARGET_ID,
        query,
      );
      expect(page).toEqual({ items: [], nextCursor: null });
    });

    it('404 when the target user does not exist', async () => {
      users.findById.mockResolvedValue(null);
      await expect(
        controller.history(admin, TARGET_ID, new ListHistoryQueryDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transformations.listHistory).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it("streams the target user's file with attachment headers", async () => {
      const stream = Readable.from('{"a":1}');
      transformations.getUserDownload.mockResolvedValue({
        stream,
        contentType: 'application/json; charset=utf-8',
        filename: 'converted.json',
      });

      const file = await controller.download(admin, TARGET_ID, ITEM_ID);

      expect(transformations.getUserDownload).toHaveBeenCalledWith(
        TARGET_ID,
        ITEM_ID,
      );
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getStream()).toBe(stream);
      expect(file.getHeaders()).toMatchObject({
        type: 'application/json; charset=utf-8',
        disposition: 'attachment; filename="converted.json"',
      });
    });

    it('404 when the target user does not exist', async () => {
      users.findById.mockResolvedValue(null);
      await expect(
        controller.download(admin, TARGET_ID, ITEM_ID),
      ).rejects.toThrow('User not found');
      expect(transformations.getUserDownload).not.toHaveBeenCalled();
    });
  });
});
