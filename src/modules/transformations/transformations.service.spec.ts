import { Readable } from 'node:stream';

import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';

import {
  TransformationHistory,
  TransformationStatus,
  TransformationType,
} from '@/modules/conversions/entities/transformation-history.entity';
import { FileStorage } from '@/modules/storage/file-storage';

import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { TransformationsService } from './transformations.service';

const FILE_ID = '11111111-1111-4111-8111-111111111111';

function record(
  over: Partial<TransformationHistory> = {},
): TransformationHistory {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'owner-1',
    type: TransformationType.FILE,
    sourceFormat: 'json',
    targetFormat: 'yaml',
    status: TransformationStatus.SUCCESS,
    errorCode: null,
    fileSize: 40,
    durationMs: 1,
    fileId: FILE_ID,
    resultSize: 30,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function setup() {
  const repo = {
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<
      Repository<TransformationHistory>,
      'findOne' | 'find' | 'delete' | 'createQueryBuilder'
    >
  >;

  const storage = {
    save: jest.fn(),
    createReadStream: jest.fn().mockReturnValue(Readable.from('name: Ann')),
    exists: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<FileStorage>;

  const service = new TransformationsService(
    repo as unknown as Repository<TransformationHistory>,
    storage,
  );
  return { service, repo, storage };
}

describe('TransformationsService', () => {
  describe('getOwnDownload', () => {
    it('throws 404 when the item does not exist', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.getOwnDownload('owner-1', FILE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 403 when the item belongs to another user', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(record({ userId: 'someone-else' }));
      await expect(
        service.getOwnDownload('owner-1', FILE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 404 when there is no saved file', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(record({ fileId: null }));
      await expect(
        service.getOwnDownload('owner-1', FILE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 410 when the saved file has expired', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(
        record({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.getOwnDownload('owner-1', FILE_ID),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('returns a stream with derived content-type and filename', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(record());
      const result = await service.getOwnDownload('owner-1', FILE_ID);
      expect(result.contentType).toContain('application/yaml');
      expect(result.filename).toBe('converted.yaml');
    });
  });

  describe('getUserDownload', () => {
    it('throws 404 when the item is not found for that user', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.getUserDownload('owner-1', FILE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('purgeExpired', () => {
    it('removes files for expired records then deletes the rows', async () => {
      const { service, repo, storage } = setup();
      repo.find.mockResolvedValue([
        { id: 'r1', fileId: FILE_ID } as TransformationHistory,
        { id: 'r2', fileId: null } as TransformationHistory,
      ]);
      const removed = await service.purgeExpired();
      expect(removed).toBe(2);
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith(FILE_ID);
      expect(repo.delete).toHaveBeenCalledWith(['r1', 'r2']);
    });

    it('does nothing when there are no expired records', async () => {
      const { service, repo, storage } = setup();
      repo.find.mockResolvedValue([]);
      expect(await service.purgeExpired()).toBe(0);
      expect(storage.remove).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('listHistory', () => {
    it('maps rows, hides PII, and emits a nextCursor when there is more', async () => {
      const { service, repo } = setup();
      const rows = [record({ id: 'a' }), record({ id: 'b' })];
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const query = Object.assign(new ListHistoryQueryDto(), { limit: 1 });
      const page = await service.listHistory('owner-1', query);

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toEqual(expect.any(String));
      // No owner PII leaks into the item.
      expect(page.items[0]).not.toHaveProperty('userId');
      expect(page.items[0].hasFile).toBe(true);
    });
  });
});
