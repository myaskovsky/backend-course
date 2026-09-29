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
  describe('listHistory (filters & cursor)', () => {
    const makeQb = (rows: TransformationHistory[] = []) => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });
    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

    it('scopes by owner, orders by (createdAt, id) desc and fetches limit+1', async () => {
      const { service, repo } = setup();
      const qb = makeQb();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const page = await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), { limit: 20 }),
      );

      expect(qb.where).toHaveBeenCalledWith('h.userId = :userId', {
        userId: 'owner-1',
      });
      expect(qb.orderBy).toHaveBeenCalledWith('h.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('h.id', 'DESC');
      expect(qb.limit).toHaveBeenCalledWith(21);
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(page).toEqual({ items: [], nextCursor: null });
    });

    it('applies every optional filter', async () => {
      const { service, repo } = setup();
      const qb = makeQb();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), {
          limit: 10,
          type: TransformationType.FILE,
          status: TransformationStatus.SUCCESS,
          sourceFormat: 'json',
          targetFormat: 'yaml',
          createdAtFrom: '2026-01-01T00:00:00Z',
          createdAtTo: '2026-02-01T00:00:00Z',
        }),
      );

      expect(qb.andWhere).toHaveBeenCalledWith('h.type = :type', {
        type: TransformationType.FILE,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('h.status = :status', {
        status: TransformationStatus.SUCCESS,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'h.sourceFormat = :sourceFormat',
        { sourceFormat: 'json' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'h.targetFormat = :targetFormat',
        { targetFormat: 'yaml' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('h.createdAt >= :from', {
        from: '2026-01-01T00:00:00Z',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('h.createdAt <= :to', {
        to: '2026-02-01T00:00:00Z',
      });
      expect(qb.andWhere).toHaveBeenCalledTimes(6);
    });

    it('applies a keyset condition for a valid cursor', async () => {
      const { service, repo } = setup();
      const qb = makeQb();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      const cursor = encode({
        createdAt: '2026-01-01T00:00:00.000Z',
        id: '00000000-0000-4000-8000-00000000000a',
      });

      await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), { limit: 5, cursor }),
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(h.createdAt, h.id) < (:cursorCreatedAt, :cursorId)',
        {
          cursorCreatedAt: '2026-01-01T00:00:00.000Z',
          cursorId: '00000000-0000-4000-8000-00000000000a',
        },
      );
    });

    it('round-trips the nextCursor it emits', async () => {
      const { service, repo } = setup();
      const rows = [
        record({
          id: '00000000-0000-4000-8000-00000000000a',
          createdAt: new Date('2026-03-02T00:00:00Z'),
        }),
        record({ id: 'b', createdAt: new Date('2026-03-01T00:00:00Z') }),
      ];
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(makeQb(rows));
      const first = await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), { limit: 1 }),
      );

      const qb = makeQb();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), {
          limit: 1,
          cursor: first.nextCursor!,
        }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        cursorCreatedAt: '2026-03-02T00:00:00.000Z',
        cursorId: '00000000-0000-4000-8000-00000000000a',
      });
    });

    it.each([
      ['not base64 JSON', '%%%not-a-cursor%%%'],
      ['JSON with wrong shape', encode({ createdAt: 123, id: 'x' })],
      ['JSON missing id', encode({ createdAt: '2026-01-01T00:00:00Z' })],
      [
        'an invalid timestamp',
        encode({
          createdAt: 'garbage',
          id: '00000000-0000-4000-8000-00000000000a',
        }),
      ],
      ['a non-UUID id', encode({ createdAt: '2026-01-01T00:00:00Z', id: 'x' })],
    ])('ignores a malformed cursor (%s)', async (_label, cursor) => {
      const { service, repo } = setup();
      const qb = makeQb();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await expect(
        service.listHistory(
          'owner-1',
          Object.assign(new ListHistoryQueryDto(), { limit: 5, cursor }),
        ),
      ).resolves.toEqual({ items: [], nextCursor: null });
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('returns no nextCursor when the page is not full', async () => {
      const { service, repo } = setup();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQb([record({ id: 'a' })]),
      );
      const page = await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), { limit: 5 }),
      );
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('computes hasFile from fileId and expiry', async () => {
      const { service, repo } = setup();
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQb([
          record({ id: 'no-file', fileId: null }),
          record({ id: 'expired', expiresAt: new Date(Date.now() - 1000) }),
          record({ id: 'no-expiry', expiresAt: null }),
        ]),
      );
      const page = await service.listHistory(
        'owner-1',
        Object.assign(new ListHistoryQueryDto(), { limit: 10 }),
      );
      expect(page.items.map((i) => [i.id, i.hasFile])).toEqual([
        ['no-file', false],
        ['expired', false],
        ['no-expiry', true],
      ]);
    });
  });

  describe('downloads (more)', () => {
    it('getUserDownload scopes the lookup to the target user and streams', async () => {
      const { service, repo, storage } = setup();
      repo.findOne.mockResolvedValue(record({ targetFormat: 'json' }));
      const result = await service.getUserDownload('owner-1', 'item-1');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'item-1', userId: 'owner-1' },
      });
      expect(storage.createReadStream).toHaveBeenCalledWith(FILE_ID);
      expect(result.filename).toBe('converted.json');
      expect(result.contentType).toContain('application/json');
    });

    it('throws 404 when the saved file is missing on disk', async () => {
      const { service, repo, storage } = setup();
      repo.findOne.mockResolvedValue(record());
      (storage.exists as jest.Mock).mockResolvedValue(false);
      await expect(service.getOwnDownload('owner-1', FILE_ID)).rejects.toThrow(
        'Saved file is no longer available',
      );
      expect(storage.createReadStream).not.toHaveBeenCalled();
    });

    it('streams a file that has no expiry set', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(record({ expiresAt: null }));
      await expect(
        service.getOwnDownload('owner-1', FILE_ID),
      ).resolves.toMatchObject({ filename: 'converted.yaml' });
    });

    it('falls back to .dat / octet-stream for an unknown target format', async () => {
      const { service, repo } = setup();
      repo.findOne.mockResolvedValue(record({ targetFormat: 'weird' }));
      const result = await service.getOwnDownload('owner-1', FILE_ID);
      expect(result.filename).toBe('converted.dat');
      expect(result.contentType).toBe('application/octet-stream');
    });
  });
});
